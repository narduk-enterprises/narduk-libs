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
    security: undefined as { headers?: unknown } | undefined,
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

const CSP_HEADER = 'content-security-policy'

afterEach(() => {
  runtime.nardukSecurityHeaders = undefined
  runtime.security = undefined
})

// The shape nuxt-security resolves into runtimeConfig.security.headers.
const presetSecurity = {
  headers: {
    contentSecurityPolicy: {
      'default-src': ["'self'"],
      'script-src': ["'self'", "'nonce-{{nonce}}'", "'strict-dynamic'"],
    },
    permissionsPolicy: { camera: [], microphone: [], geolocation: [] },
  },
}

describe('preset off -- the default', () => {
  it('serves exactly the header set deployed apps have today', async () => {
    const headers = await respond()
    const csp = Object.fromEntries(
      (headers.get(CSP_HEADER) ?? '').split('; ').map((directive) => {
        const [name, ...sources] = directive.split(' ')
        return [name, sources]
      }),
    )
    expect(csp['default-src']).toEqual(["'self'"])
    expect(csp['object-src']).toEqual(["'none'"])
    expect(csp['frame-ancestors']).toEqual(["'none'"])
    expect(csp['frame-src']).toEqual(["'self'"])
    expect(csp['base-uri']).toEqual(["'self'"])
    // No directive may open to every origin or scheme.
    for (const sources of Object.values(csp)) {
      expect(sources).not.toContain('*')
      expect(sources).not.toContain('http:')
    }
    // The legacy policy still allows inline and eval script; it is pinned so adding either
    // to another directive, or dropping the strict-preset escape hatch, is a visible change.
    expect(csp['script-src']).toEqual(
      expect.arrayContaining(["'self'", "'unsafe-inline'", "'unsafe-eval'"]),
    )
    expect(csp['style-src']).toContain("'unsafe-inline'")
    expect(csp['connect-src']).not.toContain("'unsafe-inline'")
    expect(headers.get('x-content-type-options')).toBe('nosniff')
    expect(headers.get('x-frame-options')).toBe('DENY')
    expect(headers.get('x-xss-protection')).toBe('0')
    expect(headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin')
    expect(headers.get('permissions-policy')).toBe('camera=(), microphone=(), geolocation=()')
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
    expect(headers.get(CSP_HEADER)).toContain("default-src 'self'")
  })

  it('stops duplicating the headers nuxt-security emits on every resource', async () => {
    runtime.nardukSecurityHeaders = { mode: 'report-only' }
    const headers = await respond()
    expect(headers.get('x-content-type-options')).toBeNull()
    expect(headers.get('x-frame-options')).toBeNull()
    expect(headers.get('referrer-policy')).toBeNull()
    expect(headers.get('x-xss-protection')).toBeNull()
  })

  // nuxt-security sets Permissions-Policy in render:response only, so a Nitro
  // handler would otherwise serve none (narduk-libs#1216).
  it('serves the preset Permissions-Policy on non-document responses', async () => {
    runtime.nardukSecurityHeaders = { mode: 'report-only' }
    runtime.security = presetSecurity
    const headers = await respond()
    expect(headers.get('permissions-policy')).toBe('camera=(), microphone=(), geolocation=()')
    // The preset CSP is only being reported on; the legacy one keeps enforcing.
    expect(headers.get(CSP_HEADER)).toContain("default-src 'self'")
    expect(headers.get(CSP_HEADER)).not.toContain('strict-dynamic')
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
    expect(headers.get(CSP_HEADER)).toBeNull()
  })

  // nuxt-security sets CSP and Permissions-Policy in render:response only, so
  // API, sitemap and robots responses served none (narduk-libs#1216).
  it('serves the preset policy, without the nonce, on non-document responses', async () => {
    runtime.nardukSecurityHeaders = { mode: 'enforce' }
    runtime.security = presetSecurity
    const headers = await respond()
    expect(headers.get('permissions-policy')).toBe('camera=(), microphone=(), geolocation=()')
    expect(headers.get(CSP_HEADER)).toBe("default-src 'self'; script-src 'self' 'strict-dynamic';")
  })

  it('still serves the build diagnostics', async () => {
    runtime.nardukSecurityHeaders = { mode: 'enforce' }
    const headers = await respond()
    expect(headers.get('x-app-version')).toBe('1.2.3')
    expect(headers.get('x-build-time')).toBe('2026-09-17T00:00:00.000Z')
  })
})
