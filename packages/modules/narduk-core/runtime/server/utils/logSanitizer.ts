import {
  sanitizeErrorForLog as sanitizeError,
  sanitizeUrlForLog as sanitizeUrl,
} from '@narduk-enterprises/narduk-logging'

/** Preserves the old 100-character bound with stricter URL credential handling. */
export function sanitizeUrlForLog(url: string): string {
  const sanitized = sanitizeUrl(url)
  return sanitized.length > 100 ? `${sanitized.slice(0, 97)}...` : sanitized
}

export function sanitizeErrorForLog(error: unknown): Record<string, unknown> {
  const safe = sanitizeError(error, { includeStack: import.meta.dev })
  return { ...safe, ...(safe.stack ? { stack: safe.stack.slice(0, 500) } : {}) }
}
