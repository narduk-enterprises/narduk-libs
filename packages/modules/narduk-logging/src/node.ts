import { createLogger } from './logger.js'
import { formatRecord } from './sinks.js'
import { createBoundedBuffer } from './buffer.js'
import type { Logger, LoggerOptions, LogRecord, LogSink } from './types.js'
import type { BufferStats } from './buffer.js'
import type { ReadableLogRecord } from '@opentelemetry/sdk-logs'

export function createNodeLogger(
  options: Omit<LoggerOptions, 'runtime'> & { stream?: NodeJS.WritableStream },
): Logger {
  const stream = options.stream ?? process.stderr
  const format =
    options.format ??
    (options.environment === 'development' && process.stderr.isTTY && !process.env.CI
      ? 'pretty'
      : 'json')
  return createLogger({
    ...options,
    runtime: 'node',
    sinks: options.sinks ?? [
      {
        write(record) {
          stream.write(`${formatRecord(record, format)}\n`)
        },
      },
    ],
  })
}

/** Optional official exporter. The provider is private to this sink, never registered globally. */
export async function createOtlpSink(options: {
  endpoint: string
  headers?: Record<string, string>
  intervalMs?: number
  timeoutMs?: number
}): Promise<LogSink & { readonly stats: Readonly<BufferStats> }> {
  const url = new URL(options.endpoint)
  if (
    url.protocol !== 'https:' &&
    !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
  ) {
    throw new TypeError('OTLP requires HTTPS except on loopback')
  }
  if (url.username || url.password)
    throw new TypeError('Use server-side headers for OTLP authentication')
  const [{ LoggerProvider }, { OTLPLogExporter }, { SeverityNumber }] = await Promise.all([
    import('@opentelemetry/sdk-logs'),
    import('@opentelemetry/exporter-logs-otlp-http'),
    import('@opentelemetry/api-logs'),
  ])
  const exporter = new OTLPLogExporter({
    url: options.endpoint,
    headers: options.headers,
    timeoutMillis: options.timeoutMs ?? 2000,
  })
  const encoder = new TextEncoder()
  const buffer = createBoundedBuffer<ReadableLogRecord>({
    intervalMs: options.intervalMs,
    timeoutMs: options.timeoutMs,
    size: (record) => encoder.encode(String(record.body)).byteLength,
    send: (records, signal) =>
      new Promise<void>((resolve, reject) => {
        if (signal.aborted) {
          reject(new Error('Export aborted'))
          return
        }
        exporter.export([...records], (result) =>
          result.code === 0 ? resolve() : reject(new Error('OTLP export failed')),
        )
      }),
  })
  const provider = new LoggerProvider({
    processors: [
      {
        onEmit: (record) => buffer.push(record),
        forceFlush: buffer.flush,
        shutdown: async () => {
          await buffer.close()
          await exporter.shutdown()
        },
      },
    ],
  })
  const logger = provider.getLogger('@narduk-enterprises/narduk-logging')
  const severity = {
    trace: SeverityNumber.TRACE,
    debug: SeverityNumber.DEBUG,
    info: SeverityNumber.INFO,
    warn: SeverityNumber.WARN,
    error: SeverityNumber.ERROR,
    fatal: SeverityNumber.FATAL,
  }
  return {
    write(record: Readonly<LogRecord>) {
      logger.emit({
        body: JSON.stringify(record),
        timestamp: new Date(record.timestamp),
        severityText: record.level.toUpperCase(),
        severityNumber: severity[record.level],
        attributes: {
          'service.name': record.service,
          'deployment.environment.name': record.environment,
          'narduk.runtime': record.runtime,
        },
      })
    },
    flush: () => provider.forceFlush(),
    close: () => provider.shutdown(),
    get stats() {
      return buffer.stats
    },
  }
}

export type { Logger, LoggerOptions, LogSink } from './types.js'
