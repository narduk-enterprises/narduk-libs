import type { CaptureResult, Properties } from 'posthog-js'
import type { CLSMetric, FCPMetric, INPMetric, LCPMetric } from 'web-vitals'

/**
 * Core Web Vitals reporting is PostHog's own `$web_vitals` autocapture, not a
 * second pipeline of ours.
 *
 * `posthog-js` ships a `webVitalsAutocapture` extension that buffers metrics
 * and captures one `$web_vitals` event carrying `$web_vitals_<METRIC>_value`
 * and `$web_vitals_<METRIC>_event` properties. It is switched on with
 * `capture_performance.web_vitals` and it supports exactly four metrics
 * (`SupportedWebVitalsMetrics` = `LCP | CLS | FCP | INP`) — TTFB is not one of
 * them.
 *
 * The extension does not bundle the measurement code: it calls
 * `__PosthogExtensions__.loadExternalDependency(instance, 'web-vitals', …)`
 * unless `window.__PosthogExtensions__.postHogWebVitalsCallbacks` is already
 * populated, and that loader refuses to run whenever
 * `disable_external_dependency_loading` is set — which is this module's default
 * posture (see `posthog.client`). So PostHog's autocapture would silently never
 * start here.
 *
 * `installPostHogWebVitalsCallbacks` closes that gap by publishing the same
 * callbacks object PostHog's own `web-vitals.js` asset publishes, sourced from
 * the pinned `web-vitals` npm package instead of a runtime script fetch. Same
 * library, same extension contract, no extra request, and nothing about the
 * module's external-dependency posture has to be relaxed.
 */
export const WEB_VITALS_EVENT_NAME = '$web_vitals'

/** Route label used when the router cannot match a captured URL to a page. */
export const UNMATCHED_WEB_VITALS_ROUTE = '(unmatched)'

/**
 * The four callbacks `posthog-js` requires. It refuses to start unless all four
 * are present, regardless of `web_vitals_allowed_metrics`.
 */
export interface PostHogWebVitalsCallbacks {
  onCLS: (report: (metric: CLSMetric) => void) => void
  onFCP: (report: (metric: FCPMetric) => void) => void
  onINP: (report: (metric: INPMetric) => void) => void
  onLCP: (report: (metric: LCPMetric) => void) => void
}

/** The `window` slot `posthog-js` reads its web-vitals callbacks from. */
export interface PostHogExtensionsHost {
  __PosthogExtensions__?: {
    postHogWebVitalsCallbacks?: PostHogWebVitalsCallbacks
  }
}

interface NetworkInformationLike {
  effectiveType?: string
  saveData?: boolean
}

/** The parts of `navigator` this module reads, all optional and all standard. */
export interface WebVitalsNavigatorLike {
  connection?: NetworkInformationLike
  deviceMemory?: number
  hardwareConcurrency?: number
}

/** Minimal shape of the vue-router `resolve()` result this module reads. */
export interface ResolvedRouteLike {
  matched?: Array<{ path?: string }>
}

export interface WebVitalsBeforeSendOptions {
  /** Deployed commit SHA — `runtimeConfig.public.buildVersion` from narduk-core. */
  buildVersion?: string
  /** `navigator`, or undefined when it is unavailable. */
  navigator?: WebVitalsNavigatorLike
  /** `router.resolve`, used to turn a captured URL back into its route pattern. */
  resolveRoute?: (path: string) => ResolvedRouteLike
}

const ROUTE_PARAM_PATTERN_GROUP = /\([^()]*\)/g
const ROUTE_PARAM_MODIFIER = /(:\w+)[?*+]/g

/**
 * Turns a vue-router record path into a stable dashboard label: `/stations/:id(\d+)?`
 * becomes `/stations/:id`. Custom param regexes and repeat/optional modifiers
 * are dropped so the same page always groups under one value.
 */
export function normalizeWebVitalsRoutePattern(pattern: string): string {
  const normalized = pattern
    .replaceAll(ROUTE_PARAM_PATTERN_GROUP, '')
    .replaceAll(ROUTE_PARAM_MODIFIER, '$1')
  return normalized === '' ? '/' : normalized
}

function readPathname(url: unknown): string | undefined {
  if (typeof url !== 'string' || url === '') return undefined

  try {
    return new URL(url).pathname
  } catch {
    return undefined
  }
}

/**
 * Resolves the route *pattern* for a captured URL. The pattern — never the raw
 * pathname — is what reaches PostHog, so record ids and slugs stay out of the
 * property and every request for a page groups under one value.
 */
export function resolveWebVitalsRoute(
  url: unknown,
  resolveRoute: WebVitalsBeforeSendOptions['resolveRoute'],
): string {
  const pathname = readPathname(url)
  if (pathname === undefined || typeof resolveRoute !== 'function') {
    return UNMATCHED_WEB_VITALS_ROUTE
  }

  let matched: ResolvedRouteLike['matched']
  try {
    matched = resolveRoute(pathname).matched
  } catch {
    return UNMATCHED_WEB_VITALS_ROUTE
  }

  const deepest = matched?.at(-1)?.path
  return typeof deepest === 'string' && deepest !== ''
    ? normalizeWebVitalsRoutePattern(deepest)
    : UNMATCHED_WEB_VITALS_ROUTE
}

/**
 * Connection and device class, read only where the browser already exposes it.
 * All four values are low-cardinality and carry no identifier.
 */
export function resolveWebVitalsClientContext(
  navigatorLike: WebVitalsNavigatorLike | undefined,
): Properties {
  if (!navigatorLike) return {}

  const properties: Properties = {}
  const effectiveType = navigatorLike.connection?.effectiveType
  const saveData = navigatorLike.connection?.saveData
  const deviceMemory = navigatorLike.deviceMemory
  const cpuCores = navigatorLike.hardwareConcurrency

  if (typeof effectiveType === 'string') properties.connection_effective_type = effectiveType
  if (typeof saveData === 'boolean') properties.connection_save_data = saveData
  if (typeof deviceMemory === 'number') properties.device_memory_gb = deviceMemory
  if (typeof cpuCores === 'number') properties.cpu_cores = cpuCores

  return properties
}

/**
 * The URL a `$web_vitals` event describes. PostHog stamps `$current_url` on each
 * nested metric payload when the metric is *recorded*, while the event's own
 * `$current_url` is the URL at flush time — up to `web_vitals_delayed_flush_ms`
 * later, and potentially a different page. Prefer the nested value.
 */
function readWebVitalsUrl(properties: Properties | undefined): unknown {
  if (!properties) return undefined

  for (const [key, value] of Object.entries(properties)) {
    if (!key.startsWith('$web_vitals_') || !key.endsWith('_event')) continue
    const nested = (value as Properties | undefined)?.$current_url
    if (typeof nested === 'string' && nested !== '') return nested
  }

  return properties.$current_url
}

/**
 * Builds the `before_send` hook that enriches PostHog's `$web_vitals` events
 * with the route pattern, the deployed build SHA, and connection/device class.
 * Every other event is returned untouched.
 *
 * The app id already rides along as the `app` super property registered by
 * `posthog.client`, so it is not duplicated here.
 */
export function createWebVitalsBeforeSend(options: WebVitalsBeforeSendOptions) {
  return (result: CaptureResult | null): CaptureResult | null => {
    if (!result || result.event !== WEB_VITALS_EVENT_NAME) return result

    const properties = result.properties ?? {}
    const enriched: Properties = {
      ...properties,
      ...resolveWebVitalsClientContext(options.navigator),
      route: resolveWebVitalsRoute(readWebVitalsUrl(properties), options.resolveRoute),
    }

    if (options.buildVersion) enriched.build_version = options.buildVersion

    return { ...result, properties: enriched }
  }
}

/**
 * Publishes the web-vitals callbacks on the extension slot `posthog-js` checks
 * before reaching for its external `web-vitals.js` asset. Returns false when
 * something already populated the slot, which is left untouched.
 */
export function installPostHogWebVitalsCallbacks(
  host: PostHogExtensionsHost,
  callbacks: PostHogWebVitalsCallbacks,
): boolean {
  const extensions = (host.__PosthogExtensions__ ??= {})
  if (extensions.postHogWebVitalsCallbacks) return false

  extensions.postHogWebVitalsCallbacks = callbacks
  return true
}
