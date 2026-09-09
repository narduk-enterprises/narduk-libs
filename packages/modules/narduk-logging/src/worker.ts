import { createLogger } from './logger.js'
import type { Logger, LoggerOptions } from './types.js'

export function requestId(value?: string | null): string {
  return value && /^[\w.:-]{1,128}$/.test(value) ? value : crypto.randomUUID()
}

export function createWorkerLogger(options: Omit<LoggerOptions, 'runtime'>): Logger {
  return createLogger({ ...options, runtime: 'worker' })
}

export async function logRequest(
  request: Request,
  logger: Logger,
  handler: (log: Logger) => Response | Promise<Response>,
  options: { route?: string } = {},
): Promise<Response> {
  const id = requestId(request.headers.get('x-request-id'))
  const log = logger.withContext({
    requestId: id,
    method: request.method,
    path: options.route ?? '/[unmatched]',
    source: 'server',
  })
  const start = performance.now()
  try {
    const response = await handler(log)
    // Clone immutable upstream headers without consuming or buffering the response body.
    const outgoing = new Response(response.body, response)
    outgoing.headers.set('x-request-id', id)
    log[response.status >= 500 ? 'error' : 'info']('Request completed', {
      status: response.status,
      durationMs: Math.round(performance.now() - start),
    })
    return outgoing
  } catch (error) {
    log.error('Request failed', {
      status: 500,
      durationMs: Math.round(performance.now() - start),
      error,
    })
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

export type { Logger, LoggerOptions } from './types.js'
