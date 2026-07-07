import { useRuntimeConfig } from 'nitropack/runtime'

import { readRuntimeString } from './runtime-env'

import type { H3Event } from 'h3'

/**
 * Structured, level-gated logger for server routes.
 *
 * Creates a per-request logger that respects the `logLevel` runtime config.
 * Logs are emitted as structured JSON via `console.*`, which surfaces in:
 *   - `wrangler tail` (live)
 *   - Cloudflare Dashboard → Workers → Logs
 *   - Logpush (if configured)
 *
 * Every log entry includes a `requestId` for correlating logs from the same
 * request across `wrangler tail` and Logpush.
 *
 * Usage:
 *   const log = useLogger(event)
 *   log.info('User registered', { email })
 *   log.debug('Cache miss', { key })
 *
 *   // Scoped sub-logger for a specific module:
 *   const cacheLog = log.child('D1Cache')
 *   cacheLog.debug('Cache HIT')  // message: "[D1Cache] Cache HIT"
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent'

export interface Logger {
  /** Create a scoped sub-logger that prefixes messages with `[scope]`. */
  child: (scope: string) => Logger
  debug: (message: string, data?: Record<string, unknown>) => void
  error: (message: string, data?: Record<string, unknown>) => void
  info: (message: string, data?: Record<string, unknown>) => void
  warn: (message: string, data?: Record<string, unknown>) => void
}

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4,
}

interface LayerLoggerContext {
  _logger?: Logger
  _requestId?: string
}

function getLayerLoggerContext(event: H3Event) {
  return event.context as H3Event['context'] & LayerLoggerContext
}

const VALID_LEVELS = new Set<string>(Object.keys(LEVEL_PRIORITY))

/**
 * Resolve the effective log level from runtime config.
 * Falls back to 'warn' in production, 'debug' in dev.
 */
export function resolveLogLevel(event: H3Event): LogLevel {
  try {
    const config = useRuntimeConfig(event)
    const level = readRuntimeString(event, 'LOG_LEVEL', {
      config,
      fallback: (config as Record<string, unknown>).logLevel,
    })
    if (level && VALID_LEVELS.has(level)) return level as LogLevel
  } catch {
    // Runtime config unavailable (e.g. in tests) — fall through to default
  }
  return import.meta.dev ? 'debug' : 'warn'
}

function shouldLog(configured: LogLevel, target: LogLevel): boolean {
  return LEVEL_PRIORITY[target] >= LEVEL_PRIORITY[configured]
}

function generateRequestId(): string {
  const bytes = new Uint8Array(4)
  crypto.getRandomValues(bytes)
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export function ensureRequestId(event: H3Event): string {
  const context = getLayerLoggerContext(event)
  context._requestId ??= generateRequestId()
  return context._requestId
}

function createLogEntry(
  event: H3Event,
  level: string,
  message: string,
  data?: Record<string, unknown>,
) {
  return {
    timestamp: new Date().toISOString(),
    level,
    requestId: getLayerLoggerContext(event)._requestId,
    method: event.method,
    path: event.path,
    message,
    ...(data ? { data } : {}),
  }
}

/**
 * Get or create a memoized Logger for the current request.
 *
 * Follows the same per-request memoization pattern as `useDatabase(event)`.
 * The logger is cached on `event.context._logger`.
 */
function createScopedLogger(event: H3Event, level: LogLevel, prefix: string): Logger {
  const fmt = (message: string) => (prefix ? `${prefix} ${message}` : message)

  return {
    debug(message, data) {
      if (shouldLog(level, 'debug')) {
        // eslint-disable-next-line no-console -- Server logger intentionally maps debug level to console.debug.
        console.debug(JSON.stringify(createLogEntry(event, 'debug', fmt(message), data)))
      }
    },
    info(message, data) {
      if (shouldLog(level, 'info')) {
        // eslint-disable-next-line no-console -- Server logger intentionally maps info level to console.info.
        console.info(JSON.stringify(createLogEntry(event, 'info', fmt(message), data)))
      }
    },
    warn(message, data) {
      if (shouldLog(level, 'warn')) {
        console.warn(JSON.stringify(createLogEntry(event, 'warn', fmt(message), data)))
      }
    },
    error(message, data) {
      if (shouldLog(level, 'error')) {
        console.error(JSON.stringify(createLogEntry(event, 'error', fmt(message), data)))
      }
    },
    child(scope: string) {
      return createScopedLogger(event, level, `${prefix}[${scope}]`.trim())
    },
  }
}

/**
 * Get or create a memoized Logger for the current request.
 *
 * Follows the same per-request memoization pattern as `useDatabase(event)`.
 * The logger is cached on `event.context._logger`.
 */
export function useLogger(event: H3Event): Logger {
  const context = getLayerLoggerContext(event)
  if (context._logger) return context._logger

  ensureRequestId(event)
  const level = resolveLogLevel(event)
  const logger = createScopedLogger(event, level, '')

  context._logger = logger
  return logger
}
