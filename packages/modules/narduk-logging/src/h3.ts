import {
  defineEventHandler,
  getRequestHeader,
  getResponseHeader,
  getResponseStatus,
  removeResponseHeader,
  setResponseHeader,
  toWebRequest,
} from 'h3'
import { createLogger } from './logger.js'
import { REQUEST_ID_HEADER, requestId } from './worker.js'
import { RequestTiming } from './timing.js'
import { isSharedCacheable, mergeServerTiming } from './response-headers.js'
import { receiveClientLogs } from './ingestion.js'
import type { H3Event } from 'h3'
import type { Logger, LoggerOptions } from './types.js'
import type { ClientIngestionOptions } from './ingestion.js'
import type { RequestTimingOptions } from './timing.js'

const INSTALLED = Symbol.for('@narduk/logging/nitro-installed')
const STATE_KEY = '_nardukLoggingState'
const DEFAULT_SKIP = ['/_nuxt/', '/__nuxt', '/favicon', '/api/health', '/api/_narduk/logs']

export interface RequestLoggingOptions extends LoggerOptions {
  requestLogging?: boolean
  skipPaths?: readonly string[]
  /** Exposes named Server-Timing phases recorded via `useRequestTiming`. Default false: a public
   *  response only carries `total`. */
  timingExposePhases?: boolean
  /** When set, a request whose total duration exceeds this many ms gets one structured `warn`
   *  "Slow route" log line carrying the route, method, status, duration, and request ID already
   *  bound to the request logger. Disabled (no line ever emitted) when left unset. */
  slowRouteThresholdMs?: number
}

/** Structural adapter keeps standalone H3 consumers independent of Nitro's type imports. */
export interface NitroLoggingHost {
  hooks: {
    hook(
      name: 'request' | 'beforeResponse' | 'afterResponse',
      handler: (event: H3Event) => void,
    ): unknown
    hook(
      name: 'error',
      handler: (error: Error, context: { event?: H3Event; tags?: string[] }) => void,
    ): unknown
  }
}

interface RequestState {
  id: string
  start: number
  completed: boolean
  options?: RequestLoggingOptions
  logger?: Logger
  timing?: RequestTiming
}

function state(event: H3Event): RequestState {
  const existing = event.context[STATE_KEY] as RequestState | undefined
  if (existing) return existing
  const id = requestId(
    typeof event.context._requestId === 'string'
      ? event.context._requestId
      : event.node?.req
        ? getRequestHeader(event, 'x-request-id')
        : undefined,
    // cf-ray gives a request that never sent its own ID an identity that still correlates with
    // Cloudflare's own edge trace, instead of a UUID disconnected from everything else.
    event.node?.req ? getRequestHeader(event, 'cf-ray') : undefined,
  )
  const value: RequestState = { id, start: performance.now(), completed: false }
  event.context[STATE_KEY] = value
  event.context._requestId = id
  if (event.node?.res && !event.node.res.headersSent)
    setResponseHeader(event, REQUEST_ID_HEADER, id)
  return value
}

/**
 * The request's correlation ID, created on first call. This is the supported way to read it —
 * `event.context._requestId` is this module's own storage and may change.
 */
export function ensureRequestId(event: H3Event): string {
  return state(event).id
}

/**
 * Returns the request's phase timer, creating it on first call. `exposePhases` (default false,
 * or `current.options.timingExposePhases` from the Nitro plugin config) controls whether marked
 * phases are rendered in the `Server-Timing` header at completion, or only the aggregate `total`.
 * Calling this is optional — every request gets a `total`-only header from `installNitroLogging`
 * even when a route never touches timing.
 *
 * The timer is created once per request: a later call returns the existing instance and ignores
 * its `options`, so `exposePhases` is decided by whichever caller gets there first (or by the
 * plugin's `timingExposePhases`). Decide it in the plugin config rather than per call site when
 * more than one place in a route reaches for the timer.
 */
export function useRequestTiming(event: H3Event, options?: RequestTimingOptions): RequestTiming {
  const current = state(event)
  if (!current.timing) {
    current.timing = new RequestTiming({
      start: current.start,
      exposePhases: options?.exposePhases ?? current.options?.timingExposePhases,
      clock: options?.clock,
    })
  }
  return current.timing
}

/** The matched route avoids recording user-controlled path identifiers or query parameters. */
export function requestRoute(event: H3Event): string {
  const matched = event.context.matchedRoute as { path?: unknown } | undefined
  return typeof matched?.path === 'string' ? matched.path : '/[unmatched]'
}

export function useLogger(event: H3Event, options?: LoggerOptions): Logger {
  const current = state(event)
  if (!current.logger) {
    const config = options ?? current.options
    if (!config)
      throw new TypeError('useLogger needs the logging Nitro plugin or explicit LoggerOptions')
    current.logger = createLogger({
      ...config,
      context: {
        ...config.context,
        requestId: current.id,
        method: event.method,
        path: requestRoute(event),
        source: 'server',
      },
    })
  }
  return current.logger
}

function statusOf(error: unknown): number {
  if (
    error &&
    typeof error === 'object' &&
    'statusCode' in error &&
    typeof error.statusCode === 'number'
  )
    return error.statusCode
  return 500
}

function skipped(event: H3Event, options: RequestLoggingOptions): boolean {
  const path = event.path.split('?')[0] ?? ''
  return (options.skipPaths ?? DEFAULT_SKIP).some(
    (prefix) =>
      path === prefix ||
      ((prefix.endsWith('/') || prefix === '/__nuxt' || prefix === '/favicon') &&
        path.startsWith(prefix)),
  )
}

/** Shared by the standalone Nuxt module and narduk-core's source-compatible bridge. */
export function installNitroLogging(
  nitro: NitroLoggingHost,
  options: (event?: H3Event) => RequestLoggingOptions,
): void {
  if (Reflect.get(nitro, INSTALLED)) return
  Object.defineProperty(nitro, INSTALLED, { value: true })
  nitro.hooks.hook('request', (event) => {
    state(event).options = options(event)
  })

  /**
   * `beforeResponse` is the last hook that runs while the response headers are still open. h3
   * writes and ends the response *before* calling `afterResponse`, so on a real Node server
   * (`nuxt dev`, `nuxt preview`, the node-server preset) `headersSent` is already true there and
   * the header was silently dropped from every successful response — present only on the error
   * path, which runs earlier. It survived review because the unit fixture built its own
   * `ServerResponse` that was never written to. See narduk-libs#395.
   */
  const stampResponse = (event: H3Event): void => {
    const current = state(event)
    if (!event.node?.res || event.node.res.headersSent) return
    // A response a shared cache may replay must not carry one request's identity; see
    // `isSharedCacheable`. The ID went on at the `request` hook, before the route chose its
    // caching, so this is where it comes back off.
    if (isSharedCacheable(getResponseHeader(event, 'cache-control') as string | undefined)) {
      removeResponseHeader(event, REQUEST_ID_HEADER)
      return
    }
    const timing = current.timing ?? new RequestTiming({ start: current.start })
    const existing = getResponseHeader(event, 'server-timing') as string | undefined
    setResponseHeader(event, 'server-timing', mergeServerTiming(existing, timing.header()))
  }

  const complete = (event: H3Event, status: number, error?: unknown): void => {
    const current = state(event)
    const config = current.options ?? options(event)
    if (current.completed) return
    current.completed = true
    const timing = current.timing ?? new RequestTiming({ start: current.start })
    const durationMs = Math.round(timing.totalMs())
    // Failures must remain visible even on health/internal routes skipped for normal traffic.
    // A route the app silenced stays silent for the slow-route line too: `requestLogging: false`
    // opts out of per-request records, and `skipPaths` exists so a slow asset or health probe
    // cannot flood the log.
    if ((config.requestLogging === false || skipped(event, config)) && status < 500) return
    const log = useLogger(event, config).withContext({ path: requestRoute(event) })
    if (config.slowRouteThresholdMs !== undefined && durationMs > config.slowRouteThresholdMs) {
      log.warn('Slow route', { status, durationMs })
    }
    log[status >= 500 ? 'error' : 'info']('Request completed', {
      status,
      durationMs,
      ...(error === undefined ? {} : { error }),
    })
  }

  nitro.hooks.hook('beforeResponse', stampResponse)
  nitro.hooks.hook('afterResponse', (event) => complete(event, getResponseStatus(event)))
  nitro.hooks.hook('error', (error, context) => {
    if (!context.event) {
      createLogger(options()).error('Unhandled server error', { error })
      return
    }
    const current = state(context.event)
    const status = statusOf(error)
    // The error handler sends the response itself, so h3 skips afterResponse on every
    // failing request in both the Node and Worker builds. This hook is the only boundary
    // that always runs, and the completed flag keeps the pair to one record either way.
    if (current.completed || (context.tags && !context.tags.includes('request'))) {
      if (status >= 500) {
        useLogger(context.event, current.options ?? options(context.event)).error(
          'Captured server error',
          { error },
        )
      }
      return
    }
    // A 4xx carries no error payload: its message quotes the raw request target, which the
    // route-template contract keeps out of records.
    complete(context.event, status, status >= 500 ? error : undefined)
  })
}

export type DiagnosticsHandlerOptions = Omit<
  ClientIngestionOptions,
  'logger' | 'authorize' | 'rateLimit'
> & {
  logger: (event: H3Event) => Logger
  authorize: (event: H3Event) => boolean | Promise<boolean>
  rateLimit: (event: H3Event) => boolean | Promise<boolean>
}

/** Install only in an app-owned route after selecting authentication and rate-limit policies. */
export function defineClientLogHandler(options: DiagnosticsHandlerOptions) {
  if (typeof options.authorize !== 'function' || typeof options.rateLimit !== 'function') {
    throw new TypeError('Diagnostics ingestion requires explicit authorization and rate limiting')
  }
  if (options.mode === 'anonymous' && !options.allowedOrigins?.length) {
    throw new TypeError('Anonymous diagnostics requires allowedOrigins')
  }
  return defineEventHandler((event) =>
    receiveClientLogs(toWebRequest(event), {
      ...options,
      logger: options.logger(event),
      authorize: () => options.authorize(event),
      rateLimit: () => options.rateLimit(event),
    }),
  )
}

export { REQUEST_ID_HEADER, requestIdHeaders } from './worker.js'
export type { Logger, LoggerOptions } from './types.js'
export type { RequestTiming, RequestTimingOptions } from './timing.js'
