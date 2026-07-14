import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

interface CanonicalHostMockEvent {
  headers?: Record<string, string | undefined>
  method: string
  url: string
}

type CanonicalHostHandler = (event: CanonicalHostMockEvent) => unknown

interface CanonicalHostHandlerModule {
  default: CanonicalHostHandler
}

type LoadCanonicalHostHandler = () =>
  Promise<CanonicalHostHandlerModule> | CanonicalHostHandlerModule

interface CanonicalHostKitOptions {
  canonicalAppUrl?: string
  describeName?: string
  nonCanonicalHost?: string
}

/**
 * Register vitest coverage for the fleet's shared `00-canonical-host`
 * middleware. Prefer the owning shared package export; point at an app-local
 * module only while covering a legacy downstream migration. Example wiring:
 *
 *   import { registerCanonicalHostMiddlewareTests } from '@narduk-enterprises/narduk-testkit/server/kit/canonical-host'
 *   registerCanonicalHostMiddlewareTests(() => import('@narduk-enterprises/narduk-core/server/middleware/00-canonical-host'))
 *
 * The factory owns the h3 mocks, runtime-config stubbing, and the assertion
 * matrix so apps stop maintaining 90-line copies per repo.
 */
export function registerCanonicalHostMiddlewareTests(
  loadHandler: LoadCanonicalHostHandler,
  options: CanonicalHostKitOptions = {},
) {
  const {
    describeName = 'canonical-host middleware',
    canonicalAppUrl = 'https://www.example.com',
    nonCanonicalHost = 'example.com',
  } = options

  const mockGetRequestHeader = vi.fn(
    (event: CanonicalHostMockEvent, name: string) => event.headers?.[name.toLowerCase()] ?? null,
  )
  const mockGetRequestURL = vi.fn((event: CanonicalHostMockEvent) => new URL(event.url))
  const mockSendRedirect = vi.fn(
    (_event: CanonicalHostMockEvent, url: string, statusCode: number) => ({
      url,
      statusCode,
    }),
  )
  const mockUseRuntimeConfig = vi.fn(() => ({
    public: {
      appUrl: canonicalAppUrl,
      enforceCanonicalHost: true,
    },
  }))

  describe(describeName, () => {
    let handler: CanonicalHostHandler

    beforeEach(async () => {
      vi.resetModules()
      vi.clearAllMocks()
      mockUseRuntimeConfig.mockReturnValue({
        public: {
          appUrl: canonicalAppUrl,
          enforceCanonicalHost: true,
        },
      })

      vi.doMock('h3', () => ({
        getRequestHeader: mockGetRequestHeader,
        getRequestURL: mockGetRequestURL,
        sendRedirect: mockSendRedirect,
      }))
      vi.stubGlobal('useRuntimeConfig', mockUseRuntimeConfig)
      vi.stubGlobal('defineEventHandler', (fn: (event: CanonicalHostMockEvent) => unknown) => fn)

      const loaded = await loadHandler()
      handler = loaded.default
    })

    afterEach(() => {
      // Factories may be imported alongside an app's broader test suite. Drop
      // every global patched in `beforeEach` so canonical-host assertions
      // can't leak into unrelated tests or create order-dependent failures.
      vi.unstubAllGlobals()
      vi.doUnmock('h3')
    })

    it('redirects safe requests to the canonical host', async () => {
      const canonicalOrigin = new URL(canonicalAppUrl).origin
      const result = await handler({
        method: 'GET',
        headers: { host: nonCanonicalHost },
        url: `https://${nonCanonicalHost}/login?next=%2Fdashboard%2F`,
      })

      expect(mockSendRedirect).toHaveBeenCalledWith(
        expect.anything(),
        `${canonicalOrigin}/login?next=%2Fdashboard%2F`,
        308,
      )
      expect(result).toEqual({
        url: `${canonicalOrigin}/login?next=%2Fdashboard%2F`,
        statusCode: 308,
      })
    })

    it('redirects HTTP requests on the canonical host to HTTPS', async () => {
      const canonical = new URL(canonicalAppUrl)
      const result = await handler({
        method: 'GET',
        headers: { host: canonical.host },
        url: `http://${canonical.host}/posts/example?utm_source=gsc`,
      })

      expect(mockSendRedirect).toHaveBeenCalledWith(
        expect.anything(),
        `${canonical.origin}/posts/example?utm_source=gsc`,
        308,
      )
      expect(result).toEqual({
        url: `${canonical.origin}/posts/example?utm_source=gsc`,
        statusCode: 308,
      })
    })

    it('skips redirects when canonical host enforcement is disabled', async () => {
      mockUseRuntimeConfig.mockReturnValue({
        public: {
          appUrl: canonicalAppUrl,
          enforceCanonicalHost: false,
        },
      })

      const result = await handler({
        method: 'GET',
        headers: { host: nonCanonicalHost },
        url: `https://${nonCanonicalHost}/login`,
      })

      expect(result).toBeUndefined()
      expect(mockSendRedirect).not.toHaveBeenCalled()
    })

    it('skips non-safe methods', async () => {
      const result = await handler({
        method: 'POST',
        headers: { host: nonCanonicalHost },
        url: `https://${nonCanonicalHost}/api/auth/oauth/start`,
      })

      expect(result).toBeUndefined()
      expect(mockSendRedirect).not.toHaveBeenCalled()
    })
  })
}
