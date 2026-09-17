/**
 * The legacy middleware hands headers to the preset in stages. These tests are
 * the regression guard for the thing that would actually hurt: a narduk-core
 * upgrade silently removing a header a deployed app is serving today.
 */
import { createServer } from 'node:http'

import { createApp, toNodeListener } from 'h3'
import { afterEach, describe, expect, it, vi } from 'vitest'

import securityHeaders from '../runtime/server/middleware/securityHeaders'

const { runtime } = vi.hoisted(() => ({
  runtime: {
    nardukSecurityHeaders: undefined as { mode?: string } | undefined,
    public: {
      appVersion: '1.2.3',
      buildVersion: 'abc1234',
      buildTime: '2026-09-17T00:00:00.000Z',
      cspMediaSrc: '',
      cspConnectSrc: '',
    },
  },
}))
vi.mock('nitropack/runtime', () => ({ useRuntimeConfig: () => runtime }))

async function respond(): Promise<Headers> {
  const app = createApp()
    .use(securityHeaders)
    .use(() => 'ok')
  const server = createServer(toNodeListener(app))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Expected TCP listener')
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}`)
    await response.text()
    return response.headers
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
  }
}

afterEach(() => {
  runtime.nardukSecurityHeaders = undefined
})

describe('preset off -- the default', () => {
  it('serves exactly the header set deployed apps have today', async () => {
    const headers = await respond()
    expect(headers.get('content-security-policy')).toContain("default-src 'self'")
    expect(headers.get('x-content-type-options')).toBe('nosniff')
    expect(headers.get('x-frame-options')).toBe('DENY')
    expect(headers.get('x-xss-protection')).toBe('0')
    expect(headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin')
    expect(headers.get('permissions-policy')).toContain('camera=()')
    expect(headers.get('x-app-version')).toBe('1.2.3')
  })

  it('treats an unrecognised mode as off rather than silently dropping headers', async () => {
    runtime.nardukSecurityHeaders = { mode: 'something-else' }
    expect((await respond()).get('x-frame-options')).toBe('DENY')
  })
})

describe('preset in report-only', () => {
  it('keeps enforcing the legacy CSP, because the strict policy only reports', async () => {
    runtime.nardukSecurityHeaders = { mode: 'report-only' }
    const headers = await respond()
    expect(headers.get('content-security-policy')).toContain("default-src 'self'")
  })

  it('stops duplicating the headers nuxt-security now emits', async () => {
    runtime.nardukSecurityHeaders = { mode: 'report-only' }
    const headers = await respond()
    expect(headers.get('x-content-type-options')).toBeNull()
    expect(headers.get('x-frame-options')).toBeNull()
    expect(headers.get('referrer-policy')).toBeNull()
    expect(headers.get('permissions-policy')).toBeNull()
    expect(headers.get('x-xss-protection')).toBeNull()
  })

  it('keeps the build diagnostics, which nuxt-security knows nothing about', async () => {
    runtime.nardukSecurityHeaders = { mode: 'report-only' }
    const headers = await respond()
    expect(headers.get('x-app-version')).toBe('1.2.3')
    expect(headers.get('x-build-version')).toBe('abc1234')
    expect(headers.get('x-build-time')).toBe('2026-09-17T00:00:00.000Z')
  })
})

describe('preset enforcing', () => {
  it('retires the legacy CSP so the browser is not intersecting two policies', async () => {
    runtime.nardukSecurityHeaders = { mode: 'enforce' }
    const headers = await respond()
    expect(headers.get('content-security-policy')).toBeNull()
  })

  it('still serves the build diagnostics', async () => {
    runtime.nardukSecurityHeaders = { mode: 'enforce' }
    const headers = await respond()
    expect(headers.get('x-app-version')).toBe('1.2.3')
    expect(headers.get('x-build-time')).toBe('2026-09-17T00:00:00.000Z')
  })
})
