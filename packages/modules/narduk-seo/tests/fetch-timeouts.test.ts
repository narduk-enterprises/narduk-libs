import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Outbound calls in this package's server code carry a timeout
 * (narduk/require-fetch-timeout), and a timeout reaches the caller through the
 * same handling a network failure already takes. The upstream is stubbed to
 * hang until its abort signal fires; the test fires it — no real waiting.
 */

const logger = vi.hoisted(() => {
  const log = {
    child: vi.fn(() => log),
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }
  return log
})

vi.mock('@narduk-enterprises/narduk-core/server/utils/logger', () => ({
  useLogger: () => logger,
}))

// The route imports through the module's Nitro alias; point it at the source.
vi.mock(
  '#narduk-seo-server/utils/nardukNetworkDirectory',
  async () => import('../server/utils/nardukNetworkDirectory'),
)

function stallUpstreamFetch() {
  const controllers: AbortController[] = []
  const timeoutSpy = vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => {
    const controller = new AbortController()
    controllers.push(controller)
    return controller.signal
  })
  const fetchMock = vi.fn(
    (_input: unknown, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal
        if (!signal) return // no signal: hangs forever, and the test times out
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      }),
  )
  vi.stubGlobal('fetch', fetchMock)
  return {
    fetchMock,
    timeoutSpy,
    fireTimeouts() {
      for (const controller of controllers) {
        controller.abort(
          new DOMException('The operation was aborted due to timeout', 'TimeoutError'),
        )
      }
    },
  }
}

async function flush() {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('GET /api/narduk-network/sites', () => {
  it('renders the directory empty when the directory endpoint stalls', async () => {
    const upstream = stallUpstreamFetch()
    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
    vi.stubGlobal('useRuntimeConfig', () => ({
      public: {
        appUrl: 'https://app.example.com',
        nardukNetworkDirectoryUrl: 'https://directory.example.com/network.json',
        publicCatalogBaseUrl: '',
      },
    }))
    vi.stubGlobal('getRequestURL', () => new URL('https://app.example.com/'))
    vi.stubGlobal('createError', (options: unknown) => Object.assign(new Error('x'), options))
    const handler = (await import('../server/api/narduk-network/sites.get')).default as (
      event: unknown,
    ) => Promise<unknown>

    const pending = handler({ context: {} })
    await flush()

    expect(upstream.timeoutSpy).toHaveBeenCalledWith(5_000)
    expect(upstream.fetchMock).toHaveBeenCalledWith(
      'https://directory.example.com/network.json',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    upstream.fireTimeouts()
    await expect(pending).resolves.toEqual({
      ok: false,
      configured: true,
      catalogUrl: null,
      directoryUrl: 'https://directory.example.com/network.json',
      updatedAt: null,
      sites: [],
    })
  })
})

describe('resolveAdminOgImageRoutePreviewEntry', () => {
  const target = {
    label: 'Home page',
    routePath: '/',
    meta: 'Resolved from live HTML',
    alt: 'Homepage share preview',
  }
  const event = { context: {}, node: { req: { headers: {} } } } as never

  it('falls back to the static image and logs through the core logger when the render stalls', async () => {
    const upstream = stallUpstreamFetch()
    const { resolveAdminOgImageRoutePreviewEntry } =
      await import('../server/utils/adminOgImageRoutePreview')
    const consoleWarn = vi.spyOn(console, 'warn')

    const pending = resolveAdminOgImageRoutePreviewEntry(
      event,
      'https://app.example.com',
      target,
      '/og.png',
    )
    await flush()

    expect(upstream.timeoutSpy).toHaveBeenCalledWith(10_000)
    expect(upstream.fetchMock).toHaveBeenCalledWith(
      'https://app.example.com/',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    upstream.fireTimeouts()
    await expect(pending).resolves.toEqual({ ...target, imageSrc: '/og.png' })
    expect(logger.child).toHaveBeenCalledWith('OgImagePreviews')
    expect(logger.warn).toHaveBeenCalledWith('Failed to resolve OG image preview', {
      routePath: '/',
      error: 'The operation was aborted due to timeout',
    })
    expect(consoleWarn).not.toHaveBeenCalled()
  })

  it('still resolves the live og:image on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            '<html><head><meta property="og:image" content="https://app.example.com/__og/home.png?v=1"></head></html>',
            { status: 200, headers: { 'content-type': 'text/html' } },
          ),
        ),
    )
    const { resolveAdminOgImageRoutePreviewEntry } =
      await import('../server/utils/adminOgImageRoutePreview')

    await expect(
      resolveAdminOgImageRoutePreviewEntry(event, 'https://app.example.com', target, '/og.png'),
    ).resolves.toEqual({ ...target, imageSrc: '/__og/home.png?v=1' })
    expect(logger.warn).not.toHaveBeenCalled()
  })
})
