import { createEvent } from 'h3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { requireAdmin, requireAuth } from '../runtime/server/utils/auth'

import type { H3Event } from 'h3'
import type { IncomingMessage, ServerResponse } from 'node:http'

// A public, database-free app (core only, no narduk-auth) runs without a
// session password: it has no sign-in, so it never sets one. Its admin routes
// (narduk-seo's og-image-previews, core's /api/runtime/status) still call
// requireAdmin, and an anonymous request must get 401 there, not a 500 from
// sealing a session with an empty password (borderwaitstat-us#82).

vi.mock('nitropack/runtime', () => ({
  useRuntimeConfig: () => ({ databaseBackend: 'none' }),
}))
vi.mock('#narduk-core/postgres-runtime', () => ({
  createPostgresDatabase: () => {
    throw new Error('Postgres must not be reached')
  },
}))
vi.mock('#narduk-core/schema', () => ({ apiKeys: {}, sessions: {}, users: {} }))

const PASSWORD_KEYS = ['NUXT_SESSION_PASSWORD', 'SESSION_PASSWORD'] as const

function anonymousEvent(requestHeaders: Record<string, string> = {}): {
  event: H3Event
  responseHeaders: Map<string, unknown>
} {
  const responseHeaders = new Map<string, unknown>()
  const response = {
    appendHeader(name: string, value: string) {
      responseHeaders.set(name.toLowerCase(), value)
    },
    getHeader(name: string) {
      return responseHeaders.get(name.toLowerCase())
    },
    removeHeader(name: string) {
      responseHeaders.delete(name.toLowerCase())
    },
    setHeader(name: string, value: unknown) {
      responseHeaders.set(name.toLowerCase(), value)
    },
  } as unknown as ServerResponse
  const request = {
    headers: { host: 'example.com', 'x-forwarded-proto': 'https', ...requestHeaders },
    method: 'GET',
    url: '/api/admin/og-image-previews',
  } as unknown as IncomingMessage
  const event = createEvent(request, response)
  // The Worker env of an app that never bound a session password.
  event.context.cloudflare = { env: { NUXT_PUBLIC_SITE_URL: 'https://example.com' } }
  return { event, responseHeaders }
}

describe('requireAdmin on an app with no session password', () => {
  beforeEach(() => {
    for (const key of PASSWORD_KEYS) vi.stubEnv(key, undefined)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('answers an anonymous request with 401 and sets no cookie', async () => {
    const { event, responseHeaders } = anonymousEvent()

    await expect(requireAdmin(event)).rejects.toMatchObject({
      statusCode: 401,
      message: 'Unauthorized',
    })
    expect(responseHeaders.get('set-cookie')).toBeUndefined()
  })

  it('answers a request carrying a session cookie it cannot unseal with 401', async () => {
    const { event, responseHeaders } = anonymousEvent({ cookie: 'nuxt-session=Fe26.2**forged' })

    await expect(requireAuth(event)).rejects.toMatchObject({
      statusCode: 401,
      message: 'Unauthorized',
    })
    expect(responseHeaders.get('set-cookie')).toBeUndefined()
  })
})
