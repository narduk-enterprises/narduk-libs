import { createBoundedBuffer } from './buffer.js'
import { createLogger } from './logger.js'
import { recordBytes } from './sanitize.js'
import type { Logger, LoggerOptions, LogRecord, LogSink } from './types.js'
import type { BufferStats } from './buffer.js'

export function createBrowserLogger(options: Omit<LoggerOptions, 'runtime'>): Logger {
  return createLogger({ ...options, runtime: 'browser' })
}

/** Explicit opt-in. No collector tokens or arbitrary authorization headers enter browser configuration. */
export function createRemoteSink(options: {
  endpoint: string
  fetch?: typeof fetch
  intervalMs?: number
  timeoutMs?: number
}): LogSink & { readonly stats: Readonly<BufferStats> } {
  if (!options.endpoint.startsWith('/') || options.endpoint.startsWith('//')) {
    throw new TypeError('Browser diagnostics endpoint must be a same-origin absolute path')
  }
  const buffer = createBoundedBuffer<Readonly<LogRecord>>({
    size: recordBytes,
    intervalMs: options.intervalMs,
    timeoutMs: options.timeoutMs,
    async send(records, signal) {
      const response = await (options.fetch ?? fetch)(options.endpoint, {
        method: 'POST',
        credentials: 'same-origin',
        redirect: 'error',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ schemaVersion: 1, records }),
        signal,
      })
      if (!response.ok) throw new Error(`Log ingestion returned ${response.status}`)
    },
  })
  return {
    write: (record) => buffer.push(record),
    flush: buffer.flush,
    close: buffer.close,
    get stats() {
      return buffer.stats
    },
  }
}

/** Explicit, reversible listeners; console is never patched. Call dispose at app teardown. */
export function installErrorHandlers(logger: Logger, target: Window = window): () => void {
  const onError = (event: ErrorEvent) =>
    logger.error('Unhandled browser error', {
      error: event.error ?? new Error('Browser error without details'),
    })
  const onRejection = (event: PromiseRejectionEvent) =>
    logger.error('Unhandled promise rejection', { error: event.reason })
  target.addEventListener('error', onError)
  target.addEventListener('unhandledrejection', onRejection)
  return () => {
    target.removeEventListener('error', onError)
    target.removeEventListener('unhandledrejection', onRejection)
  }
}

export { createLogger } from './logger.js'
export type { Logger, LoggerOptions, LogRecord, LogSink } from './types.js'
