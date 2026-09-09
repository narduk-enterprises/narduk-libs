import type { LogRecord, LogSink } from './types.js'

/** Deliberately bounded so a test double is also safe in a long-running diagnostic. */
export function createMemorySink(
  limit = 1000,
): LogSink & { readonly records: readonly LogRecord[]; clear(): void } {
  const records: LogRecord[] = []
  return {
    write(record) {
      if (records.length >= limit) records.shift()
      records.push(structuredClone(record))
    },
    get records() {
      return records.map((record) => structuredClone(record))
    },
    clear() {
      records.length = 0
    },
  }
}
