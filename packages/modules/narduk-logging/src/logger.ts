import { createConsola, LogLevels } from 'consola/core'
import {
  boundRecord,
  cleanText,
  freezeRecord,
  sanitizeErrorForLog,
  sanitizeFields,
  sanitizeUrlForLog,
} from './sanitize.js'
import { createConsoleSink } from './sinks.js'
import type {
  ConfiguredLogLevel,
  LogContext,
  LogDiagnostics,
  LogLevel,
  Logger,
  LoggerOptions,
  LogRecord,
  LogSink,
  SafeFields,
} from './types.js'

const CONTEXT_LIMITS = { requestId: 128, operationId: 128, method: 32, path: 512 } as const

export function resolveLogLevel(
  value: unknown,
  fallback: ConfiguredLogLevel = 'info',
): ConfiguredLogLevel {
  return typeof value === 'string' &&
    ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'].includes(value)
    ? (value as ConfiguredLogLevel)
    : fallback
}

function identity(value: string | undefined, name: string, limit: number): string {
  // eslint-disable-next-line no-control-regex -- Identity labels must reject control characters.
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > limit ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new TypeError(
      `Logging ${name} must be a non-empty string of at most ${limit} characters without controls`,
    )
  }
  return value.trim()
}

type SafeContext = Omit<LogContext, 'data'> & { data?: SafeFields }

function safeContext(context: LogContext = {}, options: LoggerOptions): SafeContext {
  const fields = sanitizeFields(context, options)
  const result: SafeContext = {}
  for (const [key, limit] of Object.entries(CONTEXT_LIMITS)) {
    const value = fields[key]
    if (typeof value === 'string') {
      const name = key as keyof typeof CONTEXT_LIMITS
      result[name] =
        name === 'path' ? sanitizeUrlForLog(value).slice(0, limit) : value.slice(0, limit)
    }
  }
  if (typeof fields.traceId === 'string' && /^[a-f0-9]{32}$/.test(fields.traceId))
    result.traceId = fields.traceId
  if (typeof fields.spanId === 'string' && /^[a-f0-9]{16}$/.test(fields.spanId))
    result.spanId = fields.spanId
  if (['server', 'client', 'job', 'cli'].includes(String(fields.source)))
    result.source = fields.source as LogContext['source']
  if (fields.data && typeof fields.data === 'object' && !Array.isArray(fields.data))
    result.data = fields.data
  return result
}

/** Creates an isolated logger. Only explicit sinks can start asynchronous delivery. */
export function createLogger(options: LoggerOptions): Logger {
  const base = {
    service: identity(options.service, 'service', 128),
    environment: identity(options.environment, 'environment', 64),
    runtime: identity(options.runtime ?? 'javascript', 'runtime', 64),
    ...(options.release ? { release: identity(options.release, 'release', 128) } : {}),
  }
  const level = resolveLogLevel(
    options.level,
    options.environment === 'development' ? 'debug' : 'info',
  )
  const sinks = [
    ...(options.sinks ?? [
      createConsoleSink(
        options.format ?? (options.environment === 'development' ? 'pretty' : 'json'),
      ),
    ]),
  ]
  const diagnostics: LogDiagnostics = { emitted: 0, sinkFailures: 0, dropped: 0 }
  let closed = false
  let emitting = false
  const engine = createConsola({
    level: LogLevels[level],
    throttle: 0,
    reporters: [
      {
        log(entry) {
          const record = entry.args[0] as Readonly<LogRecord>
          diagnostics.emitted++
          for (const sink of sinks) {
            try {
              sink.write(record)
            } catch {
              diagnostics.sinkFailures++
            }
          }
        },
      },
    ],
  })

  async function lifecycle(method: 'flush' | 'close'): Promise<void> {
    const results = await Promise.allSettled(
      sinks.map(async (sink: LogSink) => {
        await sink[method]?.()
      }),
    )
    diagnostics.sinkFailures += results.filter((result) => result.status === 'rejected').length
  }

  function scoped(context: SafeContext, scope?: string): Logger {
    const emit = (target: LogLevel, message: string, data?: Record<string, unknown>): void => {
      if (LogLevels[target] > engine.level) return
      if (closed || emitting) {
        diagnostics.dropped++
        return
      }
      emitting = true
      try {
        const safeData = data ? sanitizeFields(data, options) : undefined
        const { data: boundData, ...bindings } = context
        const fields = { ...boundData, ...safeData }
        const error = fields.error
        delete fields.error
        const record: LogRecord = {
          schemaVersion: 1,
          timestamp: (options.clock?.() ?? new Date()).toISOString(),
          ...base,
          ...bindings,
          level: target,
          message: cleanText(typeof message === 'string' ? message : '[Invalid message]'),
          ...(scope ? { scope } : {}),
          ...(Object.keys(fields).length ? { data: fields } : {}),
        }
        if (error !== undefined) record.error = sanitizeErrorForLog(error, options)
        engine[target]({ args: [freezeRecord(boundRecord(record))] })
      } catch {
        diagnostics.dropped++
      } finally {
        emitting = false
      }
    }
    const bind = (next: LogContext): SafeContext => {
      const safe = safeContext(next, options)
      return { ...context, ...safe, data: { ...context.data, ...safe.data } }
    }
    const logger: Logger = {
      trace: (message, data) => emit('trace', message, data),
      debug: (message, data) => emit('debug', message, data),
      info: (message, data) => emit('info', message, data),
      warn: (message, data) => emit('warn', message, data),
      error: (message, data) => emit('error', message, data),
      fatal: (message, data) => emit('fatal', message, data),
      child: (name, next = {}) =>
        scoped(bind(next), cleanText(scope ? `${scope}.${name}` : name, 256)),
      withContext: (next) => scoped(bind(next), scope),
      async operation(name, work, data) {
        const operationLog = logger.withContext({ operationId: crypto.randomUUID() })
        const start = performance.now()
        try {
          const result = await work(operationLog)
          operationLog.info('Operation completed', {
            ...data,
            operation: name,
            outcome: 'success',
            durationMs: Math.round(performance.now() - start),
          })
          return result
        } catch (error) {
          operationLog.error('Operation failed', {
            ...data,
            operation: name,
            outcome: 'failure',
            durationMs: Math.round(performance.now() - start),
            error,
          })
          throw error
        }
      },
      flush: () => lifecycle('flush'),
      async close() {
        if (!closed) {
          closed = true
          await lifecycle('close')
        }
      },
      get diagnostics() {
        return { ...diagnostics }
      },
    }
    return logger
  }
  return scoped(safeContext(options.context, options))
}
