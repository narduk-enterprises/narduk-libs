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
const posthogReset = vi.fn()

vi.mock('posthog-js', () => ({
  posthog: {
    init: posthogInit.mockImplementation(() => ({ capture: posthogCapture })),
    register: posthogRegister,
    capture: posthogCapture,
    reset: posthogReset,
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
  it('blocks native SDK capture until the identity baseline and after a failed barrier', async () => {
    runtimeConfigValue = {
      public: {
        analyticsLoadStrategy: 'immediate',
        posthogPublicKey: 'phc_fixture',
        posthogHost: '',
        appName: 'fixture',
        analyticsIdentityEnabled: true,
      },
    }
    let pendingEvent: unknown = 'unobserved'
    posthogInit.mockImplementationOnce((_key, options) => {
      pendingEvent = options.before_send({ event: 'native', properties: {} })
      return { capture: posthogCapture }
    })
    const plugin = (await import('../app/plugins/posthog.client')).default
    const provide = vi.fn()
    plugin.setup?.({ provide })
    await vi.waitFor(() => expect(posthogInit).toHaveBeenCalled())
    const transport = provide.mock.calls.find(([key]) => key === 'analytics')?.[1]
    const beforeSend = posthogInit.mock.calls[0]![1].before_send
    expect(pendingEvent).toBeNull()
    expect(posthogReset).toHaveBeenCalledTimes(1)
    expect(transport.status).toBe('ready')
    expect(beforeSend({ event: 'native', properties: {} })).not.toBeNull()
    transport.fail()
    expect(beforeSend({ event: 'native', properties: {} })).toBeNull()
    transport.disable()
    expect(beforeSend({ event: 'native', properties: {} })).toBeNull()
  })
  it('classifies traffic before the first capture, so the first pageview carries the class', async () => {
    runtimeConfigValue = {
      public: {
        analyticsLoadStrategy: 'immediate',
        posthogPublicKey: 'phc_fixture',
        posthogHost: '',
        appName: 'fixture',
      },
    }
    const realUserAgent = navigator.userAgent
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: `${realUserAgent} NardukAutomation/lighthouse`,
    })
    try {
      const plugin = (await import('../app/plugins/posthog.client')).default
      plugin.setup?.({ provide: vi.fn() })
      await vi.waitFor(() => expect(posthogCapture).toHaveBeenCalled())

      // The initial pageview was queued before init; register ran with the
      // class before that queued capture was replayed.
      const registered = posthogRegister.mock.calls[0]![0]
      expect(registered).toMatchObject({
        traffic_class: 'automation',
        traffic_evidence: 'ua_marker',
        automation_tool: 'lighthouse',
        classification_version: 1,
      })
      expect(posthogRegister.mock.invocationCallOrder[0]).toBeLessThan(
        posthogCapture.mock.invocationCallOrder[0]!,
      )
      expect(posthogCapture.mock.calls[0]![0]).toBe('$pageview')

      // before_send stamps the class last: a stale snapshot cannot override it.
      const beforeSend = posthogInit.mock.calls[0]![1].before_send
      const sent = beforeSend({
        event: '$pageview',
        properties: { traffic_class: 'unmarked', classification_version: 0 },
      })
      expect(sent.properties).toMatchObject({
        traffic_class: 'automation',
        classification_version: 1,
      })
    } finally {
      Object.defineProperty(navigator, 'userAgent', { configurable: true, value: realUserAgent })
    }
  })

  it('opts out of the posthog-js bot filter only for the NardukAutomation marker', async () => {
    const realUserAgent = navigator.userAgent
    const initOptionsFor = async (userAgent: string) => {
      vi.resetModules()
      posthogInit.mockClear()
      runtimeConfigValue = {
        public: {
          analyticsLoadStrategy: 'immediate',
          posthogPublicKey: 'phc_fixture',
          posthogHost: '',
          appName: 'fixture',
        },
      }
      Object.defineProperty(navigator, 'userAgent', { configurable: true, value: userAgent })
      const plugin = (await import('../app/plugins/posthog.client')).default
      plugin.setup?.({ provide: vi.fn() })
      await vi.waitFor(() => expect(posthogInit).toHaveBeenCalled())
      return posthogInit.mock.calls[0]![1] as Record<string, unknown>
    }
    try {
      const marked = await initOptionsFor(`${realUserAgent} NardukAutomation/lighthouse`)
      expect(marked.opt_out_useragent_filter).toBe(true)

      // Other bots, including a bare Lighthouse or headless browser, keep the default.
      const lighthouse = await initOptionsFor(`${realUserAgent} Chrome-Lighthouse`)
      expect(lighthouse).not.toHaveProperty('opt_out_useragent_filter')
      const headless = await initOptionsFor(`${realUserAgent} HeadlessChrome/141.0`)
      expect(headless).not.toHaveProperty('opt_out_useragent_filter')
      const ordinary = await initOptionsFor(realUserAgent)
      expect(ordinary).not.toHaveProperty('opt_out_useragent_filter')
    } finally {
      Object.defineProperty(navigator, 'userAgent', { configurable: true, value: realUserAgent })
    }
  })

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
    expect(posthogCapture).toHaveBeenNthCalledWith(
      1,
      '$pageview',
      expect.objectContaining({
        $current_url: 'https://example.com/',
      }),
      expect.objectContaining({ timestamp: expect.any(Date) }),
    )
    expect(posthogCapture).toHaveBeenNthCalledWith(
      2,
      '$pageview',
      expect.objectContaining({
        $current_url: 'https://example.com/map',
      }),
      expect.objectContaining({ timestamp: expect.any(Date) }),
    )
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
    // The traffic class is resolved (asynchronously) before Google is configured.
    await vi.waitFor(() => expect(afterEach).toBeDefined())

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
      ['set', { classification_version: 1, traffic_class: 'unmarked', traffic_evidence: 'none' }],
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
