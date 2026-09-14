import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'

import { createEvent } from 'h3'
import { describe, expect, it, vi } from 'vitest'

import { readLocalEmailSettings } from '../server/lib/app-auth/local-email-runtime'

vi.mock('nitropack/runtime', () => ({
  useRuntimeConfig: () => ({ public: { appName: 'Test app' } }),
}))
vi.mock('#layer/server/utils/logger', () => ({ useLogger: vi.fn() }))
vi.mock('../server/lib/app-auth/supabase-client', () => ({
  getAuthConfig: () => ({ appUrl: 'https://app.example.test' }),
  readRuntimeConfigString: (value: unknown, fallback = '') =>
    typeof value === 'string' ? value.trim() : fallback,
}))

function requestSettings(
  appUrl: string,
  host: string,
  selfServe = 'true',
  headers: Record<string, string> = {},
) {
  const req = new IncomingMessage(new Socket())
  req.url = '/api/auth/password-reset'
  req.headers = { host, ...headers }
  const event = createEvent(req, new ServerResponse(req))
  event.context.cloudflare = {
    env: {
      AUTH_EMAIL_APP_URL: appUrl,
      AUTH_EMAIL_SELF_SERVE_LINKS: selfServe,
    },
  }
  return readLocalEmailSettings(event)
}

describe('self-serve password links at the request boundary', () => {
  it('preserves local compiled-app E2E flows', () => {
    expect(requestSettings('http://127.0.0.1:3042', '127.0.0.1:3042').selfServeLinks).toBe(true)
  })

  it('rejects a public app with the development flag enabled', () => {
    expect(() => requestSettings('https://app.example.test', 'app.example.test')).toThrowError(
      expect.objectContaining({ statusCode: 503 }),
    )
  })

  it('rejects public requests even with a mistakenly configured loopback app URL', () => {
    expect(() => requestSettings('http://localhost:3042', 'app.example.test')).toThrowError(
      expect.objectContaining({ statusCode: 503 }),
    )
  })

  it('does not accept forwarded headers as proof of a local request', () => {
    expect(() =>
      requestSettings('http://localhost:3042', 'app.example.test', 'true', {
        'x-forwarded-host': 'localhost:3042',
        'x-forwarded-proto': 'http',
      }),
    ).toThrowError(expect.objectContaining({ statusCode: 503 }))
  })

  it('preserves normal public email delivery', () => {
    expect(requestSettings('https://app.example.test', 'app.example.test', 'false')).toMatchObject({
      appUrl: 'https://app.example.test',
      selfServeLinks: false,
    })
  })
})
