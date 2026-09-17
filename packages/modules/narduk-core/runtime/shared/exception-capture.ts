/**
 * The two capture sites that feed the `narduk:exception` seam.
 *
 * Both are plain functions over a structural host so they can be unit-tested
 * without booting Nuxt or Nitro; the runtime plugins beside them are one-line
 * wrappers (`runtime/app/plugins/exception-capture.client.ts`,
 * `runtime/server/plugins/exception-capture.ts`).
 *
 * Neither site logs. On the server narduk-logging's `installNitroLogging`
 * already writes exactly one record per failing request — including 4xx and
 * unrouted paths, since narduk-libs#359 — so a record written here would be a
 * duplicate of the request summary.
 */
import {
  buildExceptionReport,
  emitNardukException,
  readExceptionStatusCode,
} from './exception-report'

import type { ExceptionHookHost } from './exception-report'

const INSTALLED = Symbol.for('@narduk/core/exception-capture-installed')

/**
 * Primitive throws cannot go in a `WeakSet`, and they are rare enough that a
 * small bounded ring is the whole of the bookkeeping they deserve.
 */
const MAX_TRACKED_PRIMITIVES = 50

/**
 * `vue:error` and `app:error` both fire for one error whenever a component
 * failure is escalated to the app error boundary, and Nitro can re-emit a
 * tagged error it already announced. One report per error, either way.
 */
export function createExceptionDeduper(): (error: unknown) => boolean {
  const objects = new WeakSet<object>()
  const primitives = new Set<unknown>()

  return (error: unknown): boolean => {
    if (error !== null && (typeof error === 'object' || typeof error === 'function')) {
      if (objects.has(error)) return false
      objects.add(error)
      return true
    }

    if (primitives.has(error)) return false
    if (primitives.size >= MAX_TRACKED_PRIMITIVES) {
      primitives.delete(primitives.values().next().value)
    }
    primitives.add(error)
    return true
  }
}

function markInstalled(host: object): boolean {
  if (Reflect.get(host, INSTALLED)) return false
  Object.defineProperty(host, INSTALLED, { value: true })
  return true
}

export interface ClientExceptionCaptureOptions {
  /** Deployed commit SHA — `runtimeConfig.public.buildVersion`. */
  resolveBuildVersion?: () => string | undefined
  /** Correlation id for the document this app hydrated from, when one is known. */
  resolveRequestId?: () => string | undefined
  /** Current route **pattern**, e.g. `router.currentRoute.value.matched.at(-1)?.path`. */
  resolveRoute?: () => string | undefined
}

/**
 * Captures Vue component errors (`vue:error`) and fatal app errors
 * (`app:error`) and publishes one report each.
 */
export function installClientExceptionCapture(
  host: ExceptionHookHost,
  options: ClientExceptionCaptureOptions = {},
): void {
  if (!markInstalled(host)) return

  const isNew = createExceptionDeduper()
  const report = (error: unknown, fatal: boolean): void => {
    if (!isNew(error)) return

    emitNardukException(
      host,
      buildExceptionReport(error, {
        buildVersion: options.resolveBuildVersion?.(),
        fatal,
        requestId: options.resolveRequestId?.(),
        route: options.resolveRoute?.(),
        source: 'client',
      }),
    )
  }

  host.hook('vue:error', ((error: unknown) => {
    report(error, false)
  }) as (...args: never[]) => void)

  host.hook('app:error', ((error: unknown) => {
    report(error, true)
  }) as (...args: never[]) => void)
}

/** The parts of an `H3Event` this module reads, all already populated by narduk-core. */
export interface ServerExceptionEvent {
  context?: {
    _requestId?: unknown
    matchedRoute?: { path?: unknown }
  } & Record<string, unknown>
}

export interface ServerExceptionCaptureHost {
  hooks: ExceptionHookHost
}

export interface ServerExceptionCaptureOptions {
  /** Deployed commit SHA, read per event so runtime config is resolved lazily. */
  resolveBuildVersion?: (event?: ServerExceptionEvent) => string | undefined
}

const REPORTED_FLAG = '_nardukExceptionReported'

function readRequestId(event: ServerExceptionEvent | undefined): string | undefined {
  const value = event?.context?._requestId
  return typeof value === 'string' && value !== '' ? value : undefined
}

function readRoute(event: ServerExceptionEvent | undefined): string | undefined {
  const value = event?.context?.matchedRoute?.path
  return typeof value === 'string' && value !== '' ? value : undefined
}

/**
 * Captures every error Nitro announces and publishes one report each. The
 * response is already the error handler's business; this only reports.
 */
export function installServerExceptionCapture(
  host: ServerExceptionCaptureHost,
  options: ServerExceptionCaptureOptions = {},
): void {
  if (!markInstalled(host)) return

  const isNew = createExceptionDeduper()

  host.hooks.hook('error', ((
    error: unknown,
    context: { event?: ServerExceptionEvent } | undefined,
  ) => {
    const event = context?.event
    const eventContext = event?.context

    // Nitro announces a handled error once as `request` and can announce the
    // same object again untagged. The per-event flag is the reliable guard;
    // the deduper covers errors raised with no event at all.
    if (eventContext) {
      if (eventContext[REPORTED_FLAG] === true) return
      eventContext[REPORTED_FLAG] = true
    } else if (!isNew(error)) {
      return
    }

    const statusCode = readExceptionStatusCode(error)

    emitNardukException(
      host.hooks,
      buildExceptionReport(error, {
        buildVersion: options.resolveBuildVersion?.(event),
        // A 404 or a rejected 403 is an outcome, not a crash; only a 5xx is.
        fatal: statusCode >= 500,
        requestId: readRequestId(event),
        route: readRoute(event),
        source: 'server',
        statusCode,
      }),
    )
  }) as (...args: never[]) => void)
}
