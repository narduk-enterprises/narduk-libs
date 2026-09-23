// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  composeBeforeSend,
  createStrictPrivacyBeforeSend,
  normalizeAnalyticsPrivacy,
  templatePath,
  templateUrl,
  UNMATCHED_ROUTE,
} from '../app/utils/analyticsPrivacy'

import type { CaptureResult } from 'posthog-js'

// A private app's routes: a farm id, a year and a field id are all record data.
const ROUTES: Array<[RegExp, string]> = [
  [/^\/$/u, '/'],
  [/^\/join$/u, '/join'],
  [/^\/farms\/[^/]+$/u, '/farms/:farmId'],
  [/^\/farms\/[^/]+\/[^/]+$/u, '/farms/:farmId/:year(\\d+)'],
  [/^\/farms\/[^/]+\/[^/]+\/fields\/[^/]+$/u, '/farms/:farmId/:year(\\d+)/fields/:fieldId'],
]
const resolveRoute = (path: string) => {
  const hit = ROUTES.find(([pattern]) => pattern.test(path))
  return { matched: hit ? [{ path: '' }, { path: hit[1] }] : [] }
}
const ORIGIN = 'https://acre.example'

function event(name: string, properties: Record<string, unknown>, extra = {}): CaptureResult {
  return { uuid: 'u', event: name, properties, ...extra } as CaptureResult
}

describe('analytics privacy helpers', () => {
  it('accepts only the exact word strict', () => {
    expect(normalizeAnalyticsPrivacy('strict')).toBe('strict')
    expect(normalizeAnalyticsPrivacy('STRICT')).toBe('standard')
    expect(normalizeAnalyticsPrivacy(undefined)).toBe('standard')
  })

  it('reduces a path to its route pattern, dropping query and fragment', () => {
    expect(templatePath('/farms/frm_1/2024/fields/fld_9?tab=yield#x', resolveRoute)).toBe(
      '/farms/:farmId/:year/fields/:fieldId',
    )
    expect(templatePath('/join#token=secret', resolveRoute)).toBe('/join')
    expect(templatePath('/nowhere', resolveRoute)).toBe(UNMATCHED_ROUTE)
    expect(templatePath('/farms/frm_1', undefined)).toBe(UNMATCHED_ROUTE)
  })

  it('keeps origin plus pattern on this site and only the origin elsewhere', () => {
    expect(templateUrl(`${ORIGIN}/farms/frm_1/2024?x=1#y`, ORIGIN, resolveRoute)).toBe(
      `${ORIGIN}/farms/:farmId/:year`,
    )
    expect(templateUrl('https://www.google.com/search?q=renz+farm', ORIGIN, resolveRoute)).toBe(
      'https://www.google.com',
    )
    expect(templateUrl('$direct', ORIGIN, resolveRoute)).toBe('$direct')
    expect(templateUrl('', ORIGIN, resolveRoute)).toBe('')
  })
})

describe('createStrictPrivacyBeforeSend', () => {
  const scrub = createStrictPrivacyBeforeSend({ origin: ORIGIN, resolveRoute })

  it('templates every URL and pathname property, including $set and $set_once', () => {
    const result = scrub(
      event(
        '$pageleave',
        {
          $current_url: `${ORIGIN}/join#token=invite-secret`,
          $pathname: '/farms/frm_1/2024/fields/fld_9',
          $referrer: 'https://mail.example/inbox/123?open=1',
          $prev_pageview_pathname: '/farms/frm_1',
          $session_entry_url: `${ORIGIN}/farms/frm_1/2024`,
          $host: 'acre.example',
          app: 'narduk-farm',
          title: 'Field 3 · Renz',
        },
        {
          $set: { $current_url: `${ORIGIN}/farms/frm_1` },
          $set_once: { $initial_current_url: `${ORIGIN}/join#token=invite-secret` },
        },
      ),
    )

    expect(result?.properties).toEqual({
      $current_url: `${ORIGIN}/join`,
      $pathname: '/farms/:farmId/:year/fields/:fieldId',
      $referrer: 'https://mail.example',
      $prev_pageview_pathname: '/farms/:farmId',
      $session_entry_url: `${ORIGIN}/farms/:farmId/:year`,
      $host: 'acre.example',
      app: 'narduk-farm',
    })
    expect(result?.$set).toEqual({ $current_url: `${ORIGIN}/farms/:farmId` })
    expect(result?.$set_once).toEqual({ $initial_current_url: `${ORIGIN}/join` })
    expect(JSON.stringify(result)).not.toMatch(/frm_1|fld_9|invite-secret|Renz/u)
  })

  it('drops element text and structure', () => {
    const result = scrub(
      event('$autocapture', {
        $current_url: `${ORIGIN}/`,
        $el_text: '20.7 bu/ac',
        $elements: [{ tag_name: 'span' }],
        $elements_chain: 'span:text="20.7"',
      }),
    )
    expect(result?.properties).toEqual({ $current_url: `${ORIGIN}/` })
  })

  it('scrubs the nested URL on web-vitals metric payloads', () => {
    const result = scrub(
      event('$web_vitals', {
        $web_vitals_LCP_value: 1200,
        $web_vitals_LCP_event: { $current_url: `${ORIGIN}/farms/frm_1/2024`, value: 1200 },
      }),
    )
    expect(result?.properties?.$web_vitals_LCP_event).toEqual({
      $current_url: `${ORIGIN}/farms/:farmId/:year`,
      value: 1200,
    })
  })

  it('scrubs objects inside arrays and passes scalar entries through', () => {
    const result = scrub(
      event('farm_viewed', {
        visits: [{ $current_url: `${ORIGIN}/farms/frm_1/2024`, title: 'Renz Farm' }, 3, 'x'],
      }),
    )
    expect(result?.properties?.visits).toEqual([
      { $current_url: `${ORIGIN}/farms/:farmId/:year` },
      3,
      'x',
    ])
  })

  it('replaces raw exception messages with the redacted copy', () => {
    const result = scrub(
      event('$exception', {
        redacted_message: 'Field not found',
        $exception_message: 'Field "North 40" not found',
        $exception_list: [{ type: 'Error', value: 'Field "North 40" not found' }],
      }),
    )
    expect(result?.properties?.$exception_list).toEqual([
      { type: 'Error', value: 'Field not found' },
    ])
    expect(result?.properties).not.toHaveProperty('$exception_message')
  })

  it('passes a dropped event through as dropped', () => {
    expect(scrub(null)).toBeNull()
  })
})

describe('composeBeforeSend', () => {
  it('runs hooks in order and stops at null', () => {
    const tag = (result: CaptureResult | null) =>
      result && { ...result, properties: { ...result.properties, tagged: true } }
    const drop = () => null
    expect(composeBeforeSend(undefined)).toBeUndefined()
    expect(composeBeforeSend(tag)?.(event('x', {}))?.properties).toEqual({ tagged: true })
    expect(composeBeforeSend(drop, tag)?.(event('x', {}))).toBeNull()
  })
})

// --- plugins in strict mode --------------------------------------------------

let runtimeConfigValue: Record<string, unknown> = {}
type AfterEach = (to: { path: string }, from: { path: string }, failure?: unknown) => void
let afterEach: AfterEach | undefined
const currentRoute = { value: { path: '/farms/frm_1/2024' } }

vi.mock('#imports', () => ({
  defineNuxtPlugin: <T>(definition: T): T => definition,
  nextTick: (callback?: () => unknown): Promise<unknown> =>
    callback ? Promise.resolve().then(callback) : Promise.resolve(),
  useHead: vi.fn(),
  useRouter: () => ({
    afterEach: (handler: AfterEach) => {
      afterEach = handler
    },
    currentRoute,
    isReady: () => Promise.resolve(),
    resolve: resolveRoute,
  }),
  useRuntimeConfig: () => runtimeConfigValue,
}))

const posthogInit = vi.fn()
const posthogCapture = vi.fn()
vi.mock('posthog-js', () => ({
  posthog: {
    init: posthogInit.mockImplementation(() => ({ capture: posthogCapture })),
    register: vi.fn(),
    capture: posthogCapture,
  },
}))

const flush = async () => {
  for (let i = 0; i < 4; i += 1) await new Promise((resolve) => setTimeout(resolve, 0))
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  afterEach = undefined
  window.dataLayer = undefined
  document.head.innerHTML = ''
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: {
      hostname: 'acre.example',
      href: `${ORIGIN}/farms/frm_1/2024`,
      origin: ORIGIN,
    },
  })
})

describe('posthog.client — strict privacy', () => {
  it('turns off every element and replay capture, whatever the runtime flags say', async () => {
    runtimeConfigValue = {
      public: {
        analyticsLoadStrategy: 'immediate',
        analyticsPrivacy: 'strict',
        posthogPublicKey: 'phc_test_key',
        posthogHost: 'https://us.i.posthog.com',
        appName: 'test-app',
        deploymentTarget: 'production',
        posthogSessionReplayEnabled: true,
        posthogSurveysEnabled: true,
        posthogDeadClicksEnabled: true,
        posthogExternalDependencyLoadingEnabled: true,
        posthogWebVitalsEnabled: true,
        posthogWebVitalsAttributionEnabled: true,
      },
    }
    const plugin = (await import('../app/plugins/posthog.client')).default
    plugin.setup?.({ provide: vi.fn() })
    await flush()

    const config = posthogInit.mock.calls[0]?.[1] as Record<string, unknown>
    expect(config).toMatchObject({
      autocapture: false,
      rageclick: false,
      capture_heatmaps: false,
      capture_dead_clicks: false,
      disable_session_recording: true,
      disable_surveys: true,
      disable_external_dependency_loading: true,
      advanced_disable_flags: true,
      capture_performance: { web_vitals: true, web_vitals_attribution: false },
    })
    expect(typeof config.before_send).toBe('function')

    const sent = (config.before_send as (r: CaptureResult) => CaptureResult)(
      event('$pageleave', { $current_url: `${ORIGIN}/farms/frm_1/2024?x=1` }),
    )
    expect(sent.properties.$current_url).toBe(`${ORIGIN}/farms/:farmId/:year`)

    expect(posthogCapture).toHaveBeenCalledWith('$pageview', {
      $current_url: `${ORIGIN}/farms/:farmId/:year`,
    })
    afterEach?.({ path: '/farms/frm_1/2024/fields/fld_9' }, { path: '/' })
    await flush()
    expect(posthogCapture).toHaveBeenLastCalledWith('$pageview', {
      $current_url: `${ORIGIN}/farms/:farmId/:year/fields/:fieldId`,
    })
  })

  it('leaves standard apps exactly as they were', async () => {
    runtimeConfigValue = {
      public: {
        analyticsLoadStrategy: 'immediate',
        posthogPublicKey: 'phc_test_key',
        appName: 'test-app',
        deploymentTarget: 'production',
      },
    }
    const plugin = (await import('../app/plugins/posthog.client')).default
    plugin.setup?.({ provide: vi.fn() })
    await flush()

    const config = posthogInit.mock.calls[0]?.[1] as Record<string, unknown>
    expect(config).not.toHaveProperty('autocapture')
    expect(config).not.toHaveProperty('before_send')
    expect(posthogCapture).toHaveBeenCalledWith('$pageview', {
      $current_url: `${ORIGIN}/farms/frm_1/2024`,
    })
  })
})

describe('gtag.client — strict privacy', () => {
  it('sends route patterns only, with signals and ad personalisation off', async () => {
    runtimeConfigValue = {
      public: {
        analyticsLoadStrategy: 'immediate',
        analyticsPrivacy: 'strict',
        gaMeasurementId: 'G-TESTID',
      },
    }
    const plugin = (await import('../app/plugins/gtag.client')).default
    plugin.setup?.()
    await flush()
    afterEach?.({ path: '/farms/frm_1/2024/fields/fld_9' }, { path: '/farms/frm_1/2024' })
    await flush()

    const commands = window.dataLayer?.map((command) => Array.from(command)) ?? []
    const page = {
      page_path: '/farms/:farmId/:year',
      page_location: `${ORIGIN}/farms/:farmId/:year`,
      page_title: '/farms/:farmId/:year',
    }
    expect(commands[1]).toEqual([
      'config',
      'G-TESTID',
      {
        send_page_view: false,
        allow_google_signals: false,
        allow_ad_personalization_signals: false,
        page_referrer: '',
        ...page,
      },
    ])
    expect(commands).toContainEqual(['event', 'page_view', page])
    expect(commands.at(-1)).toEqual([
      'event',
      'page_view',
      {
        page_path: '/farms/:farmId/:year/fields/:fieldId',
        page_location: `${ORIGIN}/farms/:farmId/:year/fields/:fieldId`,
        page_title: '/farms/:farmId/:year/fields/:fieldId',
      },
    ])
    expect(JSON.stringify(commands)).not.toMatch(/frm_1|fld_9/u)
  })
})
