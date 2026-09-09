import type { LogRecord, LogSink } from './types.js'

export function formatRecord(
  record: Readonly<LogRecord>,
  format: 'json' | 'pretty' = 'json',
): string {
  if (format === 'json') return JSON.stringify(record)
  const { timestamp, level, service, scope, message, ...fields } = record
  return `${timestamp} ${level.toUpperCase()} ${service}${scope ? `:${scope}` : ''} ${message} ${JSON.stringify(fields)}`
}

export function createConsoleSink(format: 'json' | 'pretty' = 'json'): LogSink {
  return {
    write(record) {
      const line = formatRecord(record, format)
      if (record.level === 'error' || record.level === 'fatal') console.error(line)
      else if (record.level === 'warn') console.warn(line)
      else if (record.level === 'trace' || record.level === 'debug') console.debug(line)
      else console.info(line)
    },
  }
}
