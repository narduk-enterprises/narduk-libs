/**
 * The estate exception seam.
 *
 * One `narduk:exception` hook carries every captured error to whichever
 * reporters an app has installed — PostHog through narduk-analytics, anything
 * else an app registers itself. The capture sites (`vue:error` / `app:error` on
 * the client, Nitro's `error` hook on the server) never talk to a reporter
 * directly, so adding a destination never means adding a second capture path.
 *
 * The hook rides the runtime's own bus (`nuxtApp.hooks` / `nitroApp.hooks`)
 * rather than a module-scoped registry: the bus is one object per running app,
 * so a reporter and a capture site agree even if the bundler ever gives them
 * separate copies of this module.
 *
 * Everything in this file is plain TypeScript with no `#imports`, `h3` or
 * `nitropack` import, so it loads — and is tested — outside a booted app.
 */

export const NARDUK_EXCEPTION_HOOK = 'narduk:exception'

export type ExceptionSource = 'client' | 'server'

/** Route label used when no route pattern could be resolved for an error. */
export const UNMATCHED_EXCEPTION_ROUTE = '(unmatched)'

/** Stand-in written over every redacted span, so a redaction is visible as one. */
export const REDACTED = '[redacted]'

export interface NardukExceptionReport {
  /** Deployed commit SHA — `runtimeConfig.public.buildVersion`. */
  buildVersion?: string
  /**
   * The captured error itself, normalized to an `Error` so a reporter that
   * wants a stack (PostHog's `captureException`) always gets one. Not redacted:
   * reporters that forward it are responsible for their own destination, and
   * the redacted `message` below is what this module puts on the wire.
   */
  error: Error
  /** `true` when the error took down the app rather than one component. */
  fatal: boolean
  /** Redacted, single-line error message. Safe to attach to an event. */
  message: string
  /** Error constructor name, e.g. `TypeError`. */
  name: string
  /** Per-request correlation id, the same one `x-request-id` carries. */
  requestId?: string
  /**
   * Route **pattern** (`/stations/:id`), never a raw path: record ids, slugs and
   * query strings stay out of the report, and every request for one page groups
   * under one value.
   */
  route: string
  /** Where the error was captured. */
  source: ExceptionSource
  /** HTTP status the error carries, or 500 when it carries none. */
  statusCode: number
}

export type ExceptionHandler = (report: NardukExceptionReport) => void

/**
 * The slice of a Nuxt or Nitro hook bus this module uses. Declared structurally
 * — like narduk-logging's `NitroLoggingHost` — because `narduk:exception` is not
 * a name either runtime's own hook types know about.
 */
export interface ExceptionHookHost {
  callHook: (name: string, ...args: unknown[]) => unknown
  hook: (name: string, handler: (...args: never[]) => void) => unknown
}

const ROUTE_PARAM_PATTERN_GROUP = /\([^()]*\)/g
const ROUTE_PARAM_MODIFIER = /(:\w+)[?*+]/g
const QUERY_STRING = /\?[^\s'"]*/g
const EMAIL = /[^\s@<>()[\]{}'",;:]+@(?:[a-z0-9-]+\.)+[a-z]{2,}/gi
const WHITESPACE_RUN = /\s+/g

const MAX_MESSAGE_LENGTH = 500

/**
 * Turns a vue-router record path into a stable label: `/stations/:id(\d+)?`
 * becomes `/stations/:id`, so custom param regexes and repeat/optional
 * modifiers never split one page across several values.
 */
export function normalizeExceptionRoute(pattern: string): string {
  const normalized = pattern
    .replaceAll(ROUTE_PARAM_PATTERN_GROUP, '')
    .replaceAll(ROUTE_PARAM_MODIFIER, '$1')
  return normalized === '' ? '/' : normalized
}

/**
 * Strips the two things an error message routinely leaks: the query string of
 * whatever URL it quotes (tokens, search terms, ids) and any email address.
 * Collapses the result to one line and caps its length.
 */
export function redactExceptionText(value: string): string {
  return value
    .replaceAll(QUERY_STRING, `?${REDACTED}`)
    .replaceAll(EMAIL, REDACTED)
    .replaceAll(WHITESPACE_RUN, ' ')
    .trim()
    .slice(0, MAX_MESSAGE_LENGTH)
}

/** Reads the HTTP status an h3/Nuxt error carries, defaulting to 500. */
export function readExceptionStatusCode(error: unknown): number {
  if (error && typeof error === 'object') {
    const { statusCode } = error as { statusCode?: unknown }
    if (typeof statusCode === 'number' && Number.isFinite(statusCode)) return statusCode
  }
  return 500
}

/**
 * Normalizes anything thrown into an `Error`. A thrown string, object or
 * `undefined` is real — especially from third-party client code — and a
 * reporter that assumes `.stack` must not be the thing that breaks.
 */
export function toException(value: unknown): Error {
  if (value instanceof Error) return value
  if (typeof value === 'string') return new Error(value)
  if (value && typeof value === 'object') {
    const { message } = value as { message?: unknown }
    if (typeof message === 'string') return Object.assign(new Error(message), { cause: value })
  }
  return Object.assign(new Error('Non-Error value thrown'), { cause: value })
}

export interface ExceptionReportContext {
  buildVersion?: string
  fatal?: boolean
  requestId?: string
  route?: string
  source: ExceptionSource
  statusCode?: number
}

/** Builds the redacted, low-cardinality record every reporter receives. */
export function buildExceptionReport(
  error: unknown,
  context: ExceptionReportContext,
): NardukExceptionReport {
  const normalized = toException(error)
  const route = context.route ? normalizeExceptionRoute(context.route) : UNMATCHED_EXCEPTION_ROUTE

  return {
    error: normalized,
    fatal: context.fatal === true,
    message: redactExceptionText(normalized.message),
    name: normalized.name,
    route,
    source: context.source,
    statusCode: context.statusCode ?? readExceptionStatusCode(error),
    ...(context.buildVersion ? { buildVersion: context.buildVersion } : {}),
    ...(context.requestId ? { requestId: context.requestId } : {}),
  }
}

/** Subscribes a reporter. Returns the host's own unsubscribe callback. */
export function onNardukException(host: ExceptionHookHost, handler: ExceptionHandler): unknown {
  return host.hook(NARDUK_EXCEPTION_HOOK, handler as (...args: never[]) => void)
}

/**
 * Publishes a report. A reporter that throws must never turn one error into
 * two, so the returned promise's rejection is swallowed here.
 */
export function emitNardukException(host: ExceptionHookHost, report: NardukExceptionReport): void {
  try {
    const result = host.callHook(NARDUK_EXCEPTION_HOOK, report)
    if (result && typeof (result as Promise<unknown>).catch === 'function') {
      void (result as Promise<unknown>).catch(() => {})
    }
  } catch {
    // A broken reporter is not a reason to escalate the error being reported.
  }
}
