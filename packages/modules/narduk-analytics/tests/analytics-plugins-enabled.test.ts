// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest'

let runtimeConfigValue: Record<string, unknown> = {}
interface Route {
  fullPath?: string
  path: string
}
type AfterEach = (to: Route, from: Route, failure?: unknown) => void

let afterEach: AfterEach | undefined
let currentRoute: { value: Route } = { value: { path: '/' } }
let deferNextTicks = false
const pendingNextTicks: Array<() => unknown> = []

vi.mock('#imports', () => ({
  defineNuxtPlugin: <T>(definition: T): T => definition,
  nextTick: (callback?: () => unknown): Promise<unknown> => {
    if (!callback) return Promise.resolve()
    if (!deferNextTicks) return Promise.resolve().then(callback)

    pendingNextTicks.push(callback)
    return Promise.resolve()
  },
  useHead: vi.fn(),
  useRouter: () => ({
    afterEach: (handler: AfterEach) => {
      afterEach = handler
    },
    currentRoute,
    isReady: () => Promise.resolve(),
  }),
  useRuntimeConfig: () => runtimeConfigValue,
}))

const posthogInit = vi.fn()
const posthogRegister = vi.fn()
const posthogCapture = vi.fn()

vi.mock('posthog-js', () => ({
  posthog: {
    init: posthogInit.mockImplementation(() => ({ capture: posthogCapture })),
    register: posthogRegister,
    capture: posthogCapture,
  },
}))

function setLocation(hostname: string): void {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { hostname, href: `https://${hostname}/`, origin: `https://${hostname}` },
  })
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  document.cookie = ''
  setLocation('example.com')
  afterEach = undefined
  deferNextTicks = false
  pendingNextTicks.length = 0
  currentRoute = { value: { path: '/' } }
  runtimeConfigValue = {
    public: {
      analyticsLoadStrategy: 'off',
      previewSafeMode: true,
    },
  }
})

describe('posthog.client — enabled path', () => {
  it('does not initialize PostHog when disabled (key missing / preview-safe / off)', async () => {
    const plugin = (await import('../app/plugins/posthog.client')).default

    const result = plugin.setup?.({ provide: vi.fn() }) as { provide: { posthog: unknown } }

    expect(result.provide.posthog).toBeUndefined()
    expect(posthogInit).not.toHaveBeenCalled()
  })

  it('initializes PostHog and registers super properties on the enabled path', async () => {
    runtimeConfigValue = {
      public: {
        analyticsLoadStrategy: 'immediate',
        previewSafeMode: false,
        posthogPublicKey: 'phc_test_key',
        posthogHost: 'https://us.i.posthog.com',
        appName: 'test-app',
        appVersion: '1.2.3',
        deploymentTarget: 'production',
        posthogSessionReplayEnabled: true,
      },
    }

    const plugin = (await import('../app/plugins/posthog.client')).default
    const provide = vi.fn()

    plugin.setup?.({ provide })

    // initializePosthog() runs asynchronously (dynamic import + strategy scheduling).
    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(posthogInit).toHaveBeenCalledWith(
      'phc_test_key',
      expect.objectContaining({ api_host: 'https://us.i.posthog.com', capture_pageview: false }),
    )
    expect(posthogRegister).toHaveBeenCalledWith(
      expect.objectContaining({
        app: 'test-app',
        app_version: '1.2.3',
        environment: 'production',
        is_owner: false,
      }),
    )
    expect(provide).toHaveBeenCalledWith(
      'posthog',
      expect.objectContaining({ capture: expect.any(Function) }),
    )
  })

  it('emits one pageview per successful pathname across hydration and query-only route callbacks', async () => {
    runtimeConfigValue = {
      public: {
        analyticsLoadStrategy: 'immediate',
        previewSafeMode: false,
        posthogPublicKey: 'phc_test_key',
        posthogHost: 'https://us.i.posthog.com',
        appName: 'test-app',
        deploymentTarget: 'production',
      },
    }

    deferNextTicks = true
    const plugin = (await import('../app/plugins/posthog.client')).default
    plugin.setup?.({ provide: vi.fn() })
    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))

    // Nuxt can call afterEach for the hydrated route before its initial next tick.
    afterEach?.({ path: '/', fullPath: '/' }, { path: '/' })
    afterEach?.({ path: '/map', fullPath: '/map?layer=wind#detail' }, { path: '/' })
    afterEach?.({ path: '/map', fullPath: '/map?layer=buoys' }, { path: '/map' })
    afterEach?.({ path: '/failed', fullPath: '/failed' }, { path: '/map' }, new Error('cancelled'))

    for (const callback of pendingNextTicks.splice(0)) callback()

    expect(posthogCapture).toHaveBeenCalledTimes(2)
    expect(posthogCapture).toHaveBeenNthCalledWith(1, '$pageview', {
      $current_url: 'https://example.com/',
    })
    expect(posthogCapture).toHaveBeenNthCalledWith(2, '$pageview', {
      $current_url: 'https://example.com/map',
    })
  })

  it('tags workers.dev preview traffic as internal, non-production', async () => {
    setLocation('bfe918b0-my-app.narduk-enterprises.workers.dev')
    runtimeConfigValue = {
      public: {
        analyticsLoadStrategy: 'immediate',
        previewSafeMode: false,
        posthogPublicKey: 'phc_test_key',
        posthogHost: 'https://us.i.posthog.com',
        appName: 'test-app',
        deploymentTarget: undefined,
      },
    }

    const plugin = (await import('../app/plugins/posthog.client')).default
    plugin.setup?.({ provide: vi.fn() })

    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(posthogRegister).toHaveBeenCalledWith(
      expect.objectContaining({
        is_internal_user: true,
        environment: 'preview',
      }),
    )
  })
})

describe('gtag.client — enabled path', () => {
  beforeEach(() => {
    window.dataLayer = undefined
    document.head.innerHTML = ''
  })

  it('does not load gtag.js when the measurement id is missing', async () => {
    const plugin = (await import('../app/plugins/gtag.client')).default

    expect(() => plugin.setup?.()).not.toThrow()
    expect(document.head.querySelector('script[src*="googletagmanager"]')).toBeNull()
  })

  it('configures Google once and emits deduplicated manual pageviews for the initial and successful SPA paths', async () => {
    runtimeConfigValue = {
      public: {
        analyticsLoadStrategy: 'immediate',
        previewSafeMode: false,
        gaMeasurementId: 'G-TESTID',
      },
    }

    const plugin = (await import('../app/plugins/gtag.client')).default
    plugin.setup?.()

    // Nuxt can report the hydrated route through afterEach before isReady();
    // both paths must still produce the one initial pageview.
    afterEach?.({ path: '/' }, { path: '/' })
    await Promise.resolve()
    await Promise.resolve()

    afterEach?.({ path: '/ports', fullPath: '/ports?tab=private#details' }, { path: '/' })
    afterEach?.({ path: '/ports', fullPath: '/ports#comments' }, { path: '/ports' })
    afterEach?.({ path: '/failed' }, { path: '/ports' }, new Error('cancelled'))
    await Promise.resolve()
    await Promise.resolve()

    const script = document.head.querySelector('script[src*="googletagmanager"]')
    expect(script).not.toBeNull()
    expect(script?.getAttribute('src')).toContain('G-TESTID')
    const commands = window.dataLayer?.map((command) => Array.from(command))
    expect(commands).toEqual([
      ['js', expect.any(Date)],
      ['config', 'G-TESTID', { send_page_view: false }],
      [
        'event',
        'page_view',
        {
          page_path: '/',
          page_location: 'https://example.com/',
          page_title: '/',
        },
      ],
      [
        'event',
        'page_view',
        {
          page_path: '/ports',
          page_location: 'https://example.com/ports',
          page_title: '/ports',
        },
      ],
    ])
  })
})
