import { createEvent } from 'h3'
import { describe, expect, it } from 'vitest'

import {
  DEFAULT_USER_SESSION_MAX_AGE_SECONDS,
  resolveSessionConfig,
  setLayerUserSession,
} from '../runtime/server/utils/user-session'

import type { H3Event } from 'h3'
import type { IncomingMessage, ServerResponse } from 'node:http'

const EXAMPLE_HOST = 'example.com'

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

function createSessionEvent(): H3Event {
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
    headers: { host: EXAMPLE_HOST, 'x-forwarded-proto': 'https' },
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
