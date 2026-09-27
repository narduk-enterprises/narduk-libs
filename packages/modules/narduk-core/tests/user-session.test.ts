import { createEvent } from 'h3'
import { describe, expect, it } from 'vitest'

import {
  DEFAULT_USER_SESSION_MAX_AGE_SECONDS,
  getLayerUserSession,
  hasLayerUserSession,
  peekLayerUserSession,
  resolveSessionConfig,
  setLayerUserSession,
} from '../runtime/server/utils/user-session'

import type { H3Event } from 'h3'
import type { IncomingMessage, ServerResponse } from 'node:http'

const EXAMPLE_HOST = 'example.com'
const SIGNED_IN_USER = { email: 'parent@example.com' }

function createConfigEvent(headers: Record<string, string> = {}): H3Event {
  return {
    context: {},
    node: {
      req: {
        connection: {},
        headers,
      },
    },
  } as unknown as H3Event
}

function createSessionEvent(requestHeaders: Record<string, string> = {}): H3Event {
  const responseHeaders = new Map<string, number | string | string[]>()
  const response = {
    appendHeader(name: string, value: string) {
      const key = name.toLowerCase()
      const current = responseHeaders.get(key)
      responseHeaders.set(
        key,
        current === undefined
          ? value
          : Array.isArray(current)
            ? [...current, value]
            : [String(current), value],
      )
    },
    getHeader(name: string) {
      return responseHeaders.get(name.toLowerCase())
    },
    removeHeader(name: string) {
      responseHeaders.delete(name.toLowerCase())
    },
    setHeader(name: string, value: number | string | string[]) {
      responseHeaders.set(name.toLowerCase(), value)
    },
  } as unknown as ServerResponse
  const request = {
    headers: { host: EXAMPLE_HOST, 'x-forwarded-proto': 'https', ...requestHeaders },
    method: 'POST',
    url: '/api/auth/login',
  } as unknown as IncomingMessage
  const event = createEvent(request, response)
  event.context.cloudflare = {
    env: { NUXT_SESSION_PASSWORD: 'test-session-password-must-be-at-least-32-chars' },
  }
  return event
}

describe('user session cookie defaults', () => {
  it('persists user sessions for 30 days instead of using a browser-session cookie', () => {
    const config = resolveSessionConfig(createConfigEvent({ host: EXAMPLE_HOST }))

    expect(config.maxAge).toBe(DEFAULT_USER_SESSION_MAX_AGE_SECONDS)
  })

  it('issues a persistent cookie when a user signs in', async () => {
    const event = createSessionEvent()

    await setLayerUserSession(event, { user: { email: 'parent@example.com' } })

    expect(String(event.node.res.getHeader('set-cookie'))).toMatch(/Expires=/)
  })

  it('allows local HTTP clients to return the session cookie', () => {
    const config = resolveSessionConfig(createConfigEvent({ host: '127.0.0.1:3011' }))

    expect(config.cookie).toMatchObject({ sameSite: 'lax', secure: false })
  })

  it('keeps cookies secure for HTTPS requests behind Cloudflare', () => {
    const config = resolveSessionConfig(
      createConfigEvent({ host: EXAMPLE_HOST, 'x-forwarded-proto': 'https' }),
    )

    expect(config.cookie).toMatchObject({ sameSite: 'lax', secure: true })
  })

  it('preserves an explicit caller cookie override', () => {
    const config = resolveSessionConfig(
      createConfigEvent({ host: EXAMPLE_HOST, 'x-forwarded-proto': 'https' }),
      { cookie: { sameSite: 'strict', secure: false } },
    )

    expect(config.cookie).toMatchObject({ sameSite: 'strict', secure: false })
  })

  it('preserves an explicit caller session lifetime override', () => {
    const config = resolveSessionConfig(createConfigEvent({ host: EXAMPLE_HOST }), {
      maxAge: 3600,
    })

    expect(config.maxAge).toBe(3600)
  })
})

function setCookieHeader(event: H3Event): string | undefined {
  const header = event.node.res.getHeader('set-cookie')
  if (header === undefined) return undefined
  return Array.isArray(header) ? header.join('\n') : String(header)
}

/** A sealed session the real h3 `useSession` wrote, as a request cookie. */
async function signedInCookie(): Promise<string> {
  const event = createSessionEvent()
  await setLayerUserSession(event, { user: SIGNED_IN_USER })
  const cookie = setCookieHeader(event)?.split(';')[0]
  if (!cookie) throw new Error('sign-in wrote no cookie')
  return cookie
}

// narduk-libs#1214: h3's `useSession` seals and sets a new cookie whenever the
// request carries none, so a pure read through it gave every anonymous
// request a 30-day session cookie.
describe('peekLayerUserSession', () => {
  it('reads nothing and writes no cookie when the request has no session', async () => {
    const event = createSessionEvent()

    expect(hasLayerUserSession(event)).toBe(false)
    await expect(peekLayerUserSession(event)).resolves.toBeNull()
    expect(setCookieHeader(event)).toBeUndefined()
    expect(event.context.sessions).toBeUndefined()
  })

  it('is the non-mutating read: getLayerUserSession on the same request writes one', async () => {
    const event = createSessionEvent()

    await getLayerUserSession(event)

    expect(setCookieHeader(event)).toMatch(/^nuxt-session=Fe26\.2\*\*/)
  })

  it('reads a sealed session cookie without rewriting it', async () => {
    const event = createSessionEvent({ cookie: await signedInCookie() })

    expect(hasLayerUserSession(event)).toBe(true)
    const session = await peekLayerUserSession(event)

    expect(session?.user).toEqual(SIGNED_IN_USER)
    expect(session?.id).toEqual(expect.any(String))
    expect(setCookieHeader(event)).toBeUndefined()
  })

  it('reads the session from the h3 session header too', async () => {
    const sealed = (await signedInCookie()).slice('nuxt-session='.length)
    const event = createSessionEvent({ 'x-nuxt-session-session': sealed })

    expect(hasLayerUserSession(event)).toBe(true)
    expect((await peekLayerUserSession(event))?.user).toEqual(SIGNED_IN_USER)
    expect(setCookieHeader(event)).toBeUndefined()
  })

  it('answers null for a cookie that does not unseal, and writes nothing', async () => {
    const event = createSessionEvent({ cookie: 'nuxt-session=not-a-sealed-session' })

    expect(hasLayerUserSession(event)).toBe(true)
    await expect(peekLayerUserSession(event)).resolves.toBeNull()
    expect(setCookieHeader(event)).toBeUndefined()
  })

  it('sees a session written earlier in the same request', async () => {
    const event = createSessionEvent()
    await setLayerUserSession(event, { user: SIGNED_IN_USER })

    expect(hasLayerUserSession(event)).toBe(true)
    expect((await peekLayerUserSession(event))?.user).toEqual(SIGNED_IN_USER)
  })
})
