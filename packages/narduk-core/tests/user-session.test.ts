import { describe, expect, it } from 'vitest'

import { resolveSessionConfig } from '../runtime/server/utils/user-session'

import type { H3Event } from 'h3'

function createEvent(headers: Record<string, string> = {}): H3Event {
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

describe('user session cookie defaults', () => {
  it('allows local HTTP clients to return the session cookie', () => {
    const config = resolveSessionConfig(createEvent({ host: '127.0.0.1:3011' }))

    expect(config.cookie).toMatchObject({ sameSite: 'lax', secure: false })
  })

  it('keeps cookies secure for HTTPS requests behind Cloudflare', () => {
    const config = resolveSessionConfig(
      createEvent({ host: 'example.com', 'x-forwarded-proto': 'https' }),
    )

    expect(config.cookie).toMatchObject({ sameSite: 'lax', secure: true })
  })

  it('preserves an explicit caller cookie override', () => {
    const config = resolveSessionConfig(
      createEvent({ host: 'example.com', 'x-forwarded-proto': 'https' }),
      { cookie: { sameSite: 'strict', secure: false } },
    )

    expect(config.cookie).toMatchObject({ sameSite: 'strict', secure: false })
  })
})
