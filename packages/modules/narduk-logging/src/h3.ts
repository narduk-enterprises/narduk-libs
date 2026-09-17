import {
  defineEventHandler,
  getRequestHeader,
  getResponseStatus,
  setResponseHeader,
  toWebRequest,
} from 'h3'
import { createLogger } from './logger.js'
import { requestId } from './worker.js'
import { receiveClientLogs } from './ingestion.js'
import type { H3Event } from 'h3'
import type { Logger, LoggerOptions } from './types.js'
import type { ClientIngestionOptions } from './ingestion.js'

const INSTALLED = Symbol.for('@narduk/logging/nitro-installed')
const STATE_KEY = '_nardukLoggingState'
const DEFAULT_SKIP = ['/_nuxt/', '/__nuxt', '/favicon', '/api/health', '/api/_narduk/logs']

export interface RequestLoggingOptions extends LoggerOptions {
  requestLogging?: boolean
  skipPaths?: readonly string[]
}

/** Structural adapter keeps standalone H3 consumers independent of Nitro's type imports. */
export interface NitroLoggingHost {
  hooks: {
    hook(name: 'request' | 'afterResponse', handler: (event: H3Event) => void): unknown
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
  )
  const value: RequestState = { id, start: performance.now(), completed: false }
  event.context[STATE_KEY] = value
  event.context._requestId = id
  if (event.node?.res && !event.node.res.headersSent) setResponseHeader(event, 'x-request-id', id)
  return value
}

export function ensureRequestId(event: H3Event): string {
  return state(event).id
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

  const complete = (event: H3Event, status: number, error?: unknown): void => {
    const current = state(event)
    const config = current.options ?? options(event)
    if (current.completed) return
    current.completed = true
    // Failures must remain visible even on health/internal routes skipped for normal traffic.
    if ((config.requestLogging === false || skipped(event, config)) && status < 500) return
    const log = useLogger(event, config).withContext({ path: requestRoute(event) })
    log[status >= 500 ? 'error' : 'info']('Request completed', {
      status,
      durationMs: Math.round(performance.now() - current.start),
      ...(error === undefined ? {} : { error }),
    })
  }

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

export type { Logger, LoggerOptions } from './types.js'
