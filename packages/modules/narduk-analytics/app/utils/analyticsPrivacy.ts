import { normalizeWebVitalsRoutePattern, UNMATCHED_WEB_VITALS_ROUTE } from './webVitals'

import type { ResolvedRouteLike } from './webVitals'
import type { CaptureResult, Properties } from 'posthog-js'

/**
 * `standard` is the default floor: fragments and sensitive query keys are
 * stripped from URL properties, and element/page text is not sent. Paths and
 * record ids stay visible. `strict` is opt-in for an app whose pages hold
 * private records: nothing that leaves the browser may carry a raw path, a
 * query string, a fragment, a page title or the text of an element.
 */
export type AnalyticsPrivacy = 'standard' | 'strict'

export function normalizeAnalyticsPrivacy(value: unknown): AnalyticsPrivacy {
  return value === 'strict' ? 'strict' : 'standard'
}

export type ResolveRoute = (path: string) => ResolvedRouteLike

/** The route label a path is reported as when the router cannot match it. */
export const UNMATCHED_ROUTE = UNMATCHED_WEB_VITALS_ROUTE

/**
 * The matched route **pattern** for a path — `/farms/:farmId/:year` rather
 * than `/farms/frm_1/2024`. Query and fragment are dropped before matching.
 */
export function templatePath(path: string, resolveRoute: ResolveRoute | undefined): string {
  const pathname = path.split(/[?#]/u, 1)[0] || '/'
  if (typeof resolveRoute !== 'function') return UNMATCHED_ROUTE

  let matched: ResolvedRouteLike['matched']
  try {
    matched = resolveRoute(pathname).matched
  } catch {
    return UNMATCHED_ROUTE
  }

  const deepest = matched?.at(-1)?.path
  return typeof deepest === 'string' && deepest !== ''
    ? normalizeWebVitalsRoutePattern(deepest)
    : UNMATCHED_ROUTE
}

/**
 * A URL with every identifying part removed. Same-origin URLs keep the origin
 * and the route pattern; any other origin keeps its origin only, so a search
 * engine's query or another site's path never reaches analytics. A value that
 * is not an absolute http(s) URL (PostHog's `$direct`, an empty string) is
 * returned unchanged.
 */
export function templateUrl(
  value: string,
  origin: string,
  resolveRoute: ResolveRoute | undefined,
): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return value
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return value
  if (url.origin !== origin) return url.origin
  return origin + templatePath(url.pathname, resolveRoute)
}

// `$current_url`, `$initial_current_url`, `$referrer`, `$session_entry_url`,
// `$prev_pageview_pathname`, … — PostHog's URL-bearing keys all end this way.
const URL_KEY = /^\$.*(?:url|referrer)$/u
const PATHNAME_KEY = /^\$.*pathname$/u
// Element text and structure: autocapture, rage clicks and dead clicks. Strict
// mode turns those off; standard mode drops the same keys so `$el_text` and
// click structure cannot leak page copy, while the autocapture *setting* stays
// the PostHog default.
const DROPPED_KEYS = new Set(['title', '$title', '$el_text', '$elements', '$elements_chain'])

/**
 * Query keys that commonly carry reset, invite, OAuth or session secrets.
 * Matches a keyword as a whole key or as a `_` / `-` / `.` segment so
 * `invite_code` and `session_id` drop; UTM and ordinary UI params stay.
 */
const SENSITIVE_QUERY_KEY =
  /^api[_-]?key$|(?:^|[._-])(?:token|secret|password|passwd|pwd|invite|invitation|auth|authorization|session|jwt|otp|magic|code|key|email|state|reset)(?:[._-]|$)/iu

function isSensitiveQueryKey(key: string): boolean {
  return SENSITIVE_QUERY_KEY.test(key)
}

function stripQueryAndFragment(path: string): string {
  return path.split(/[?#]/u, 1)[0] || '/'
}

/**
 * Standard-mode URL floor: drop the fragment and any sensitive query keys.
 * Paths, record ids and ordinary params (including UTM) stay. Values that are
 * not a URL or a path (`$direct`, empty) pass through unchanged.
 */
export function sanitizeStandardUrl(value: string): string {
  if (!value) return value
  const looksAbsolute = /^https?:\/\//iu.test(value)
  const looksPath = value.startsWith('/') || value.startsWith('?') || value.startsWith('#')
  if (!looksAbsolute && !looksPath) return value

  try {
    const url = looksAbsolute ? new URL(value) : new URL(value, 'https://narduk.invalid')
    if (looksAbsolute && url.protocol !== 'http:' && url.protocol !== 'https:') return value
    for (const key of [...url.searchParams.keys()]) {
      if (isSensitiveQueryKey(key)) url.searchParams.delete(key)
    }
    const search = url.searchParams.toString()
    const suffix = `${url.pathname}${search ? `?${search}` : ''}`
    return looksAbsolute ? `${url.origin}${suffix}` : suffix
  } catch {
    return stripQueryAndFragment(value)
  }
}

function isPlainObject(value: unknown): value is Properties {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function scrubProperties(
  properties: Properties,
  origin: string,
  resolveRoute: ResolveRoute | undefined,
): Properties {
  const scrubbed: Properties = {}
  for (const [key, value] of Object.entries(properties)) {
    if (DROPPED_KEYS.has(key)) continue
    if (typeof value === 'string' && URL_KEY.test(key)) {
      scrubbed[key] = templateUrl(value, origin, resolveRoute)
    } else if (typeof value === 'string' && PATHNAME_KEY.test(key)) {
      scrubbed[key] = templatePath(value, resolveRoute)
    } else if (isPlainObject(value)) {
      // `$set`, `$set_once`, and the nested `$web_vitals_*_event` payloads.
      scrubbed[key] = scrubProperties(value, origin, resolveRoute)
    } else if (Array.isArray(value)) {
      // Lists of objects (`$exception_list`, anything an app captures) get the
      // same rules per entry; scalar entries pass through.
      scrubbed[key] = value.map((entry: unknown) =>
        isPlainObject(entry) ? scrubProperties(entry, origin, resolveRoute) : entry,
      )
    } else {
      scrubbed[key] = value
    }
  }
  return scrubbed
}

/**
 * `$exception_list[].value` is the raw `error.message`; narduk-core already
 * supplies a redacted copy as `redacted_message`. Strict mode reports only
 * that copy, so a record name inside an error message stays in the browser.
 */
function scrubExceptionList(properties: Properties): Properties {
  const list = properties.$exception_list
  if (!Array.isArray(list)) return properties
  const redacted =
    typeof properties.redacted_message === 'string' ? properties.redacted_message : '(redacted)'
  const { $exception_message: _dropped, ...rest } = properties
  return {
    ...rest,
    $exception_list: list.map((entry: unknown) =>
      isPlainObject(entry) ? { ...entry, value: redacted } : entry,
    ),
  }
}

export interface StrictPrivacyBeforeSendOptions {
  /** `window.location.origin`: URLs on it are templated, others cut to origin. */
  origin: string
  /** `router.resolve`, to turn a path back into its route pattern. */
  resolveRoute?: ResolveRoute
}

/**
 * The PostHog `before_send` hook strict mode installs. It runs on every event
 * — pageviews, page leaves, exceptions, web vitals, anything an app captures
 * through `usePosthog()` — and it is the last hook to run, so nothing another
 * hook adds escapes it.
 */
export function createStrictPrivacyBeforeSend(options: StrictPrivacyBeforeSendOptions) {
  return (result: CaptureResult | null): CaptureResult | null => {
    if (!result) return result
    let properties = scrubProperties(result.properties ?? {}, options.origin, options.resolveRoute)
    if (result.event === '$exception') properties = scrubExceptionList(properties)
    const scrubbed: CaptureResult = { ...result, properties }
    if (isPlainObject(result.$set)) {
      scrubbed.$set = scrubProperties(result.$set, options.origin, options.resolveRoute)
    }
    if (isPlainObject(result.$set_once)) {
      scrubbed.$set_once = scrubProperties(result.$set_once, options.origin, options.resolveRoute)
    }
    return scrubbed
  }
}

function sanitizeStandardProperties(properties: Properties): Properties {
  const sanitized: Properties = {}
  for (const [key, value] of Object.entries(properties)) {
    if (DROPPED_KEYS.has(key)) continue
    if (typeof value === 'string' && URL_KEY.test(key)) {
      sanitized[key] = sanitizeStandardUrl(value)
    } else if (typeof value === 'string' && PATHNAME_KEY.test(key)) {
      sanitized[key] = stripQueryAndFragment(value)
    } else if (isPlainObject(value)) {
      sanitized[key] = sanitizeStandardProperties(value)
    } else if (Array.isArray(value)) {
      sanitized[key] = value.map((entry: unknown) =>
        isPlainObject(entry) ? sanitizeStandardProperties(entry) : entry,
      )
    } else {
      sanitized[key] = value
    }
  }
  return sanitized
}

/**
 * Standard-mode `before_send`: strips fragments and sensitive query keys from
 * URL properties, drops element/page text, and leaves paths untemplated.
 * This is not strict mode — record ids in the path still leave the browser.
 */
export function createStandardPrivacyBeforeSend() {
  return (result: CaptureResult | null): CaptureResult | null => {
    if (!result) return result
    const scrubbed: CaptureResult = {
      ...result,
      properties: sanitizeStandardProperties(result.properties ?? {}),
    }
    if (isPlainObject(result.$set)) {
      scrubbed.$set = sanitizeStandardProperties(result.$set)
    }
    if (isPlainObject(result.$set_once)) {
      scrubbed.$set_once = sanitizeStandardProperties(result.$set_once)
    }
    return scrubbed
  }
}

type BeforeSend = (result: CaptureResult | null) => CaptureResult | null

/** Runs each hook in order; a hook that drops the event (null) ends the chain. */
export function composeBeforeSend(...hooks: Array<BeforeSend | undefined>): BeforeSend | undefined {
  const active = hooks.filter((hook): hook is BeforeSend => typeof hook === 'function')
  if (active.length === 0) return undefined
  if (active.length === 1) return active[0]
  return (result) => active.reduce<CaptureResult | null>((current, hook) => hook(current), result)
}
