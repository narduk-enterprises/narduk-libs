/**
 * Logging sanitization utilities
 * Prevents sensitive data from appearing in logs
 */

const MAX_URL_LENGTH = 100

/**
 * Sanitize a URL for logging
 * - Removes query string and fragment
 * - Caps length
 * - Preserves hostname and path
 */
export function sanitizeUrlForLog(url: string): string {
  if (!url) {
    return '[empty]'
  }

  try {
    const urlObj = new URL(url)
    // Reconstruct without query/fragment
    const sanitized = `${urlObj.protocol}//${urlObj.hostname}${urlObj.pathname}`

    // Cap length
    if (sanitized.length > MAX_URL_LENGTH) {
      return sanitized.substring(0, MAX_URL_LENGTH - 3) + '...'
    }

    return sanitized
  } catch {
    // If URL parsing fails, just truncate the original
    if (url.length > MAX_URL_LENGTH) {
      return url.substring(0, MAX_URL_LENGTH - 3) + '...'
    }
    return url
  }
}

/**
 * Sanitize an error object for logging
 * Only includes safe fields, excludes stack traces in production
 */
export function sanitizeErrorForLog(error: unknown): Record<string, unknown> {
  const err = error instanceof Error ? error : new Error(String(error))
  const errWithCode = error as { code?: string }
  const sanitized: Record<string, unknown> = {
    message: err.message,
    code: errWithCode.code,
    name: err.name,
  }

  // Only include stack in development
  if (import.meta.dev && err.stack) {
    sanitized.stack = err.stack.substring(0, 500) // Limit stack trace length
  }

  return sanitized
}
