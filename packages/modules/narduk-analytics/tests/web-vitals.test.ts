// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createWebVitalsBeforeSend,
  installPostHogWebVitalsCallbacks,
  normalizeWebVitalsRoutePattern,
  resolveWebVitalsClientContext,
  resolveWebVitalsRoute,
  UNMATCHED_WEB_VITALS_ROUTE,
} from '../app/utils/webVitals'

import type { PostHogWebVitalsCallbacks } from '../app/utils/webVitals'
import type { CaptureResult } from 'posthog-js'

const STATION_ROUTE_PATTERN = '/stations/:id'
const STATION_URL = 'https://example.com/stations/44013'
const BUILD_VERSION = 'abc123def456'

let runtimeConfigValue: Record<string, unknown> = {}

interface RouteRecord {
  path?: string
}

let resolvedRoutes: Record<string, RouteRecord[]> = {}

vi.mock('#imports', () => ({
  defineNuxtPlugin: <T>(definition: T): T => definition,
  nextTick: (callback?: () => unknown): Promise<unknown> =>
    callback ? Promise.resolve().then(callback) : Promise.resolve(),
  useHead: vi.fn(),
  useRouter: () => ({
    afterEach: vi.fn(),
    currentRoute: { value: { path: '/' } },
    resolve: (path: string) => ({ matched: resolvedRoutes[path] ?? [] }),
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

const standardCallbacks = {
  onCLS: vi.fn(),
  onFCP: vi.fn(),
  onINP: vi.fn(),
  onLCP: vi.fn(),
}
const attributionCallbacks = {
  onCLS: vi.fn(),
  onFCP: vi.fn(),
  onINP: vi.fn(),
  onLCP: vi.fn(),
}

vi.mock('web-vitals', () => standardCallbacks)
vi.mock('web-vitals/attribution', () => attributionCallbacks)

interface ExtensionsWindow extends Window {
  __PosthogExtensions__?: { postHogWebVitalsCallbacks?: PostHogWebVitalsCallbacks }
}

function extensionsWindow(): ExtensionsWindow {
  return window as ExtensionsWindow
}

function setLocation(hostname: string): void {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { hostname, href: `https://${hostname}/`, origin: `https://${hostname}` },
  })
}

/** Runs the plugin's enabled path and returns the options handed to `posthog.init`. */
async function initOptions(): Promise<Record<string, unknown>> {
  const plugin = (await import('../app/plugins/posthog.client')).default
  plugin.setup?.({ provide: vi.fn() })

  // initializePosthog() awaits the posthog-js and web-vitals dynamic imports.
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))

  return (posthogInit.mock.calls[0]?.[1] ?? {}) as Record<string, unknown>
}

function enabledRuntimeConfig(overrides: Record<string, unknown> = {}): void {
  runtimeConfigValue = {
    public: {
      analyticsLoadStrategy: 'immediate',
      previewSafeMode: false,
      posthogPublicKey: 'phc_test_key',
      posthogHost: 'https://p.nard.uk',
      appName: 'test-app',
      buildVersion: BUILD_VERSION,
      deploymentTarget: 'production',
      posthogWebVitalsEnabled: true,
      ...overrides,
    },
  }
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  document.cookie = ''
  setLocation('example.com')
  delete extensionsWindow().__PosthogExtensions__
  resolvedRoutes = {
    '/': [{ path: '/' }],
    '/stations/44013': [{ path: '/stations' }, { path: '/stations/:id()' }],
  }
  runtimeConfigValue = { public: { analyticsLoadStrategy: 'off', previewSafeMode: true } }
})

describe('normalizeWebVitalsRoutePattern', () => {
  it.each([
    ['/', '/'],
    ['/stations', '/stations'],
    ['/stations/:id()', STATION_ROUTE_PATTERN],
    ['/stations/:id(\\d+)', STATION_ROUTE_PATTERN],
    ['/docs/:slug(.*)*', '/docs/:slug'],
    ['/search/:query?', '/search/:query'],
  ])('normalizes %s to %s', (pattern, expected) => {
    expect(normalizeWebVitalsRoutePattern(pattern)).toBe(expected)
  })

  it('never returns an empty label', () => {
    expect(normalizeWebVitalsRoutePattern('')).toBe('/')
  })
})

describe('resolveWebVitalsRoute', () => {
  const resolveRoute = (path: string) => ({ matched: resolvedRoutes[path] ?? [] })

  it('reports the matched route pattern rather than the raw path', () => {
    expect(resolveWebVitalsRoute(`${STATION_URL}?unit=m`, resolveRoute)).toBe(STATION_ROUTE_PATTERN)
  })

  it.each([
    ['an unmatched path', 'https://example.com/nope'],
    ['a non-URL value', 'not-a-url'],
    ['an empty value', ''],
    ['a missing value', undefined],
  ])('falls back to the unmatched label for %s', (_label, url) => {
    expect(resolveWebVitalsRoute(url, resolveRoute)).toBe(UNMATCHED_WEB_VITALS_ROUTE)
  })

  it('falls back when no resolver is available', () => {
    expect(resolveWebVitalsRoute(STATION_URL, undefined)).toBe(UNMATCHED_WEB_VITALS_ROUTE)
  })

  it('falls back when the resolver throws', () => {
    expect(
      resolveWebVitalsRoute(STATION_URL, () => {
        throw new Error('no matching route')
      }),
    ).toBe(UNMATCHED_WEB_VITALS_ROUTE)
  })
})

describe('resolveWebVitalsClientContext', () => {
  it('reads connection and device class where the browser exposes it', () => {
    expect(
      resolveWebVitalsClientContext({
        connection: { effectiveType: '4g', saveData: false },
        deviceMemory: 8,
        hardwareConcurrency: 10,
      }),
    ).toEqual({
      connection_effective_type: '4g',
      connection_save_data: false,
      device_memory_gb: 8,
      cpu_cores: 10,
    })
  })

  it('omits every value the browser does not expose', () => {
    expect(resolveWebVitalsClientContext({})).toEqual({})
    expect(resolveWebVitalsClientContext(undefined)).toEqual({})
  })
})

describe('createWebVitalsBeforeSend', () => {
  const beforeSend = createWebVitalsBeforeSend({
    buildVersion: BUILD_VERSION,
    navigator: { connection: { effectiveType: '4g' }, hardwareConcurrency: 10 },
    resolveRoute: (path: string) => ({ matched: resolvedRoutes[path] ?? [] }),
  })

  function webVitalsEvent(properties: Record<string, unknown>): CaptureResult {
    return { uuid: 'uuid-1', event: '$web_vitals', properties } as CaptureResult
  }

  it('enriches a $web_vitals event with route, build SHA and client class', () => {
    const result = beforeSend(
      webVitalsEvent({
        $current_url: STATION_URL,
        $web_vitals_LCP_value: 1234,
        $web_vitals_LCP_event: { name: 'LCP', value: 1234, $current_url: STATION_URL },
      }),
    )

    expect(result?.properties).toMatchObject({
      route: STATION_ROUTE_PATTERN,
      build_version: BUILD_VERSION,
      connection_effective_type: '4g',
      cpu_cores: 10,
      $web_vitals_LCP_value: 1234,
    })
  })

  it('prefers the URL recorded with the metric over the URL at flush time', () => {
    const result = beforeSend(
      webVitalsEvent({
        // PostHog buffers for up to web_vitals_delayed_flush_ms, so the
        // event-level $current_url can already be the next page.
        $current_url: 'https://example.com/',
        $web_vitals_CLS_value: 0.02,
        $web_vitals_CLS_event: { name: 'CLS', value: 0.02, $current_url: STATION_URL },
      }),
    )

    expect(result?.properties.route).toBe(STATION_ROUTE_PATTERN)
  })

  it('omits build_version when no build SHA is configured', () => {
    const withoutBuild = createWebVitalsBeforeSend({
      resolveRoute: (path: string) => ({ matched: resolvedRoutes[path] ?? [] }),
    })

    const result = withoutBuild(
      webVitalsEvent({ $current_url: 'https://example.com/', $web_vitals_FCP_value: 700 }),
    )

    expect(result?.properties.route).toBe('/')
    expect(result?.properties).not.toHaveProperty('build_version')
  })

  it.each([
    ['$pageview', { $current_url: STATION_URL }],
    ['custom-event', {}],
  ])('leaves %s events untouched', (event, properties) => {
    const original = { uuid: 'uuid-2', event, properties } as CaptureResult

    expect(beforeSend(original)).toBe(original)
  })

  it('passes a dropped event straight through', () => {
    expect(beforeSend(null)).toBeNull()
  })
})

describe('installPostHogWebVitalsCallbacks', () => {
  it('publishes the callbacks on the extension slot posthog-js checks', () => {
    const host: { __PosthogExtensions__?: Record<string, unknown> } = {}

    expect(installPostHogWebVitalsCallbacks(host, standardCallbacks)).toBe(true)
    expect(host.__PosthogExtensions__?.postHogWebVitalsCallbacks).toBe(standardCallbacks)
  })

  it('never clobbers callbacks something else already published', () => {
    const existing = { ...standardCallbacks }
    const host = { __PosthogExtensions__: { postHogWebVitalsCallbacks: existing } }

    expect(installPostHogWebVitalsCallbacks(host, attributionCallbacks)).toBe(false)
    expect(host.__PosthogExtensions__.postHogWebVitalsCallbacks).toBe(existing)
  })
})

describe('posthog.client — web vitals wiring', () => {
  it('starts PostHog web vitals autocapture without an external script fetch', async () => {
    enabledRuntimeConfig()

    const options = await initOptions()

    expect(options.capture_performance).toEqual({
      web_vitals: true,
      web_vitals_attribution: false,
    })
    expect(options.before_send).toBeTypeOf('function')
    expect(extensionsWindow().__PosthogExtensions__?.postHogWebVitalsCallbacks).toEqual({
      onCLS: standardCallbacks.onCLS,
      onFCP: standardCallbacks.onFCP,
      onINP: standardCallbacks.onINP,
      onLCP: standardCallbacks.onLCP,
    })
  })

  it('uses the attribution build only when attribution is enabled', async () => {
    enabledRuntimeConfig({ posthogWebVitalsAttributionEnabled: true })

    const options = await initOptions()

    expect(options.capture_performance).toEqual({
      web_vitals: true,
      web_vitals_attribution: true,
    })
    expect(extensionsWindow().__PosthogExtensions__?.postHogWebVitalsCallbacks?.onLCP).toBe(
      attributionCallbacks.onLCP,
    )
  })

  it('enriches the $web_vitals events PostHog captures through the installed hook', async () => {
    enabledRuntimeConfig()

    const options = await initOptions()
    const beforeSend = options.before_send as (result: CaptureResult) => CaptureResult | null
    const enriched = beforeSend({
      uuid: 'uuid-3',
      event: '$web_vitals',
      properties: {
        $current_url: STATION_URL,
        $web_vitals_INP_value: 180,
      },
    } as CaptureResult)

    expect(enriched?.properties).toMatchObject({
      route: STATION_ROUTE_PATTERN,
      build_version: BUILD_VERSION,
    })
  })

  it('pins web vitals off when the app has not opted in, so remote config cannot start it', async () => {
    enabledRuntimeConfig({ posthogWebVitalsEnabled: false })

    const options = await initOptions()

    expect(options.capture_performance).toEqual({
      web_vitals: false,
      web_vitals_attribution: false,
    })
    expect(options.before_send).toBeUndefined()
    expect(extensionsWindow().__PosthogExtensions__).toBeUndefined()
  })

  it('ignores attribution when web vitals itself is off', async () => {
    enabledRuntimeConfig({
      posthogWebVitalsEnabled: false,
      posthogWebVitalsAttributionEnabled: true,
    })

    const options = await initOptions()

    expect(options.capture_performance).toEqual({
      web_vitals: false,
      web_vitals_attribution: false,
    })
  })

  it.each([
    ['preview safe mode', { previewSafeMode: true }],
    ['a missing PostHog key', { posthogPublicKey: '' }],
    ['an off load strategy', { analyticsLoadStrategy: 'off' }],
  ])('captures nothing under %s, even with web vitals opted in', async (_label, overrides) => {
    enabledRuntimeConfig(overrides)

    const plugin = (await import('../app/plugins/posthog.client')).default
    const result = plugin.setup?.({ provide: vi.fn() }) as { provide: { posthog: unknown } }
    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(result.provide.posthog).toBeUndefined()
    expect(posthogInit).not.toHaveBeenCalled()
    expect(posthogCapture).not.toHaveBeenCalled()
    expect(extensionsWindow().__PosthogExtensions__).toBeUndefined()
  })

  it('captures nothing on a local development host', async () => {
    setLocation('localhost')
    enabledRuntimeConfig()

    const plugin = (await import('../app/plugins/posthog.client')).default
    plugin.setup?.({ provide: vi.fn() })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(posthogInit).not.toHaveBeenCalled()
    expect(posthogCapture).not.toHaveBeenCalled()
    expect(extensionsWindow().__PosthogExtensions__).toBeUndefined()
  })
})
