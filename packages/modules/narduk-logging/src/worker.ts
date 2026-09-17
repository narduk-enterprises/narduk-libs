import { createLogger } from './logger.js'
import { RequestTiming } from './timing.js'
import { isSharedCacheable, mergeServerTiming } from './response-headers.js'
import type { Logger, LoggerOptions } from './types.js'

const REQUEST_ID_PATTERN = /^[\w.:-]{1,128}$/

/**
 * The correlation header, named once so every caller agrees. Import this rather than repeating
 * the string — narduk-core's data client had its own copy.
 */
export const REQUEST_ID_HEADER = 'x-request-id'

/**
 * Validates an inbound correlation ID against a bounded, safe charset. `fallbackSeed` (Cloudflare's
 * `cf-ray`, say) is tried next when `value` is missing or malformed, so a request that never sent
 * its own ID still correlates with the edge's own trace instead of getting a disconnected UUID.
 *
 * The charset and 128-character bound are what make the value safe to put in a header and a log
 * record: no CR, LF, quote or space can survive it. They do not make it *trustworthy*. Any client
 * can choose the ID an edge-terminated request arrives with, so treat it as a correlation key
 * supplied by the caller, never as evidence of who or what sent the request.
 */
export function requestId(value?: string | null, fallbackSeed?: string | null): string {
  if (value && REQUEST_ID_PATTERN.test(value)) return value
  if (fallbackSeed && REQUEST_ID_PATTERN.test(fallbackSeed)) return fallbackSeed
  return crypto.randomUUID()
}

/** Headers to forward the current request's correlation ID on an outbound call. */
export function requestIdHeaders(id: string): Readonly<Record<string, string>> {
  return { [REQUEST_ID_HEADER]: id }
}

export function createWorkerLogger(options: Omit<LoggerOptions, 'runtime'>): Logger {
  return createLogger({ ...options, runtime: 'worker' })
}

export interface LogRequestOptions {
  route?: string
  /** Exposes named Server-Timing phases recorded via the `timing` argument passed to `handler`.
   *  Default false: the response only carries `total`. */
  timingExposePhases?: boolean
  /** When set, a request whose total duration exceeds this many ms gets one structured `warn`
   *  "Slow route" log line carrying the route, method, status, duration, and request ID already
   *  bound to `log`. Disabled (no line ever emitted) when left unset. */
  slowRouteThresholdMs?: number
}

export async function logRequest(
  request: Request,
  logger: Logger,
  handler: (log: Logger, timing: RequestTiming) => Response | Promise<Response>,
  options: LogRequestOptions = {},
): Promise<Response> {
  const id = requestId(request.headers.get('x-request-id'), request.headers.get('cf-ray'))
  const log = logger.withContext({
    requestId: id,
    method: request.method,
    path: options.route ?? '/[unmatched]',
    source: 'server',
  })
  const timing = new RequestTiming({ exposePhases: options.timingExposePhases })
  const slowRoute = (status: number): void => {
    const durationMs = Math.round(timing.totalMs())
    if (options.slowRouteThresholdMs !== undefined && durationMs > options.slowRouteThresholdMs) {
      log.warn('Slow route', { status, durationMs })
    }
  }
  try {
    const response = await handler(log, timing)
    // Clone immutable upstream headers without consuming or buffering the response body.
    const outgoing = new Response(response.body, response)
    // A response a shared cache may replay must not carry one request's identity: the edge would
    // serve the cache-missing request's ID to every later client. See `isSharedCacheable`.
    if (!isSharedCacheable(outgoing.headers.get('cache-control'))) {
      outgoing.headers.set(REQUEST_ID_HEADER, id)
      outgoing.headers.set(
        'server-timing',
        mergeServerTiming(outgoing.headers.get('server-timing'), timing.header()),
      )
    }
    log[response.status >= 500 ? 'error' : 'info']('Request completed', {
      status: response.status,
      durationMs: Math.round(timing.totalMs()),
    })
    slowRoute(response.status)
    return outgoing
  } catch (error) {
    log.error('Request failed', {
      status: 500,
      durationMs: Math.round(timing.totalMs()),
      error,
    })
    slowRoute(500)
    throw error
  }
}

/** Schedules, queue batches, and Durable Object alarms keep their handler's return/throw semantics. */
export function logJob<T>(
  logger: Logger,
  name: string,
  handler: (log: Logger) => T | Promise<T>,
  fields?: Record<string, unknown>,
): Promise<T> {
  return logger.withContext({ source: 'job' }).operation(name, handler, fields)
}

export type { RequestTiming, RequestTimingOptions } from './timing.js'
export type { Logger, LoggerOptions } from './types.js'
