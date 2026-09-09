import type { JsonValue, LogLevel, LogRecord } from './schema.js'

export type { JsonValue, LogError, LogLevel, LogRecord } from './schema.js'
export type ConfiguredLogLevel = LogLevel | 'silent'
export type LogContext = Pick<
  LogRecord,
  'requestId' | 'operationId' | 'traceId' | 'spanId' | 'method' | 'path' | 'source'
> & { data?: Record<string, unknown> }

/** write must return immediately; asynchronous delivery belongs to a bounded sink. */
export interface LogSink {
  write(record: Readonly<LogRecord>): void
  flush?(): Promise<void>
  close?(): Promise<void>
}

export interface LogDiagnostics {
  emitted: number
  sinkFailures: number
  dropped: number
}

export interface LoggerOptions {
  service: string
  environment: string
  runtime?: string
  release?: string
  level?: ConfiguredLogLevel
  format?: 'json' | 'pretty'
  sinks?: readonly LogSink[]
  context?: LogContext
  /** Additional exact field names to redact (case and punctuation insensitive). */
  redact?: readonly string[]
  includeStack?: boolean
  /** Injectable clock for deterministic tests; timestamps are always UTC. */
  clock?: () => Date
}

export interface Logger {
  trace(message: string, data?: Record<string, unknown>): void
  debug(message: string, data?: Record<string, unknown>): void
  info(message: string, data?: Record<string, unknown>): void
  warn(message: string, data?: Record<string, unknown>): void
  error(message: string, data?: Record<string, unknown>): void
  fatal(message: string, data?: Record<string, unknown>): void
  child(scope: string, context?: LogContext): Logger
  withContext(context: LogContext): Logger
  operation<T>(
    name: string,
    work: (log: Logger) => T | Promise<T>,
    data?: Record<string, unknown>,
  ): Promise<T>
  flush(): Promise<void>
  close(): Promise<void>
  readonly diagnostics: Readonly<LogDiagnostics>
}

export type SafeFields = Record<string, JsonValue>
