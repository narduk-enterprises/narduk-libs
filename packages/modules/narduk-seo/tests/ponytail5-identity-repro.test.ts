import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'

import { createEvent } from 'h3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Ponytail-5 repro tests for #2003 (analytics-seo-devices #15, #17, #18).
 * Regression pins for the fixed findings.
 */

vi.mock('@narduk-enterprises/narduk-core/server/utils/logger', () => {
  const log = { child: () => log, debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() }
  return { useLogger: () => log }
})

function h3Event(host: string, headers: Record<string, string> = {}) {
  const req = new IncomingMessage(new Socket())
  req.method = 'GET'
  req.url = '/sitemap.xml'
  req.headers = { host, ...headers }
  const res = new ServerResponse(req)
  return createEvent(req, res)
}

beforeEach(() => {
  vi.resetModules()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.doUnmock('#imports')
})

describe('#15 host-aware noindex middleware', () => {
  it('a client X-Forwarded-Host does not lift noindex from a workers.dev alias', async () => {
    vi.doMock('#imports', () => ({
      useRuntimeConfig: () => ({
        public: { nardukSeoHostAwareIndexing: true, siteUrl: 'https://example.com' },
      }),
    }))
    const middleware = (await import('../server/middleware/hostAwareIndexing')).default

    const plain = h3Event('app.workers.dev')
    middleware(plain)
    expect(plain.node.res.getHeader('X-Robots-Tag')).toBe('noindex, nofollow')

    const spoofed = h3Event('app.workers.dev', { 'x-forwarded-host': 'example.com' })
    middleware(spoofed)
    expect(spoofed.node.res.getHeader('X-Robots-Tag')).toBe('noindex, nofollow')
  })
})

describe('#17 OG preview resolver image check', () => {
  it('rejects a backslash path that resolves off-origin', async () => {
    expect(new URL('/\\evil.example/a.png', 'https://app.example').host).toBe('evil.example')

    vi.doMock('#layer/server/utils/auth', () => ({ requireAdmin: vi.fn() }))
    vi.doMock('#narduk-seo-server/utils/ogImagePath', () => ({
      buildSeoOgImagePreviewPath: () => '/_og/preview.png',
    }))
    vi.doMock(
      '#narduk-seo-server/utils/ogImagePreviewAccess',
      async () => import('../server/utils/ogImagePreviewAccess'),
    )
    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
    // Production shape: preview lab on, signing secret set, admin session (mocked).
    vi.stubGlobal('useRuntimeConfig', () => ({
      app: { baseURL: '/' },
      public: { ogImagePreviewLab: true },
      'nuxt-og-image': { security: { secret: 'test-secret' } },
    }))
    vi.stubGlobal('createError', (options: object) => Object.assign(new Error('x'), options))
    vi.stubGlobal('setResponseHeader', vi.fn())
    vi.stubGlobal(
      'getValidatedQuery',
      async (event: { query: unknown }, parse: (value: unknown) => unknown) => parse(event.query),
    )
    const handler = (await import('../server/api/og-image/resolve.get')).default as (
      event: unknown,
    ) => Promise<unknown>

    const query = {
      key: 'k',
      variant: 'Default',
      title: 'T',
      description: 'D',
      siteName: 'S',
    }
    // Control: an ordinary same-origin path is accepted.
    await expect(handler({ query: { ...query, image: '/img/a.png' } })).resolves.toBeTruthy()
    await expect(handler({ query: { ...query, image: '/\\evil.example/a.png' } })).rejects.toThrow()
  })
})

describe('#18 OG route preview helper', () => {
  it('never sends the caller cookie to a host other than origin', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('<html></html>', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const { resolveAdminOgImageRoutePreviewEntry } =
      await import('../server/utils/adminOgImageRoutePreview')
    const event = h3Event('app.example', { cookie: 'session=admin-secret' })

    await resolveAdminOgImageRoutePreviewEntry(
      event,
      'https://app.example',
      // `@evil.example/x` (the audit's case) is refused by real fetch (URL with
      // credentials); a leading `.` is a credential-free off-origin host.
      { label: 'x', meta: 'x', alt: 'x', routePath: '.evil.example/x' },
      '/og.png',
    )

    const leaked = fetchMock.mock.calls.filter(([url, init]) => {
      const host = new URL(String(url)).host
      const cookie = (init?.headers as Record<string, string> | undefined)?.cookie
      return host !== 'app.example' && Boolean(cookie)
    })
    expect(leaked.map(([url]) => String(url))).toEqual([])
  })
})
