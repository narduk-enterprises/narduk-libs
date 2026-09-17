/**
 * Presentation logic for the estate error page, kept out of the SFC so it is
 * testable without a Vue renderer.
 */

export interface ErrorPagePresentation {
  description: string
  title: string
}

const PRESENTATIONS: Record<number, ErrorPagePresentation> = {
  401: {
    title: 'Not authenticated',
    description: 'Please sign in to access this page.',
  },
  403: {
    title: 'Access denied',
    description: "You don't have permission to access this resource.",
  },
  404: {
    title: 'Page not found',
    description: "The page you're looking for doesn't exist or has been moved.",
  },
  429: {
    title: 'Too many requests',
    description: 'You have made too many requests. Please wait a moment and try again.',
  },
  503: {
    title: 'Temporarily unavailable',
    description: 'The service is briefly unavailable. Please try again in a moment.',
  },
}

const FALLBACK: ErrorPagePresentation = {
  title: 'Something went wrong',
  description: 'An unexpected error occurred. Please try again later.',
}

/** The status code shown and reported when an error carries none. */
export const DEFAULT_ERROR_STATUS_CODE = 500

export function resolveErrorStatusCode(statusCode: unknown): number {
  return typeof statusCode === 'number' && Number.isFinite(statusCode)
    ? statusCode
    : DEFAULT_ERROR_STATUS_CODE
}

/** Heading and body text for a status code. Never echoes the error's own message. */
export function resolveErrorPresentation(statusCode: unknown): ErrorPagePresentation {
  return PRESENTATIONS[resolveErrorStatusCode(statusCode)] ?? FALLBACK
}

/**
 * The raw error message, shown only where `previewSafeMode` is on — preview,
 * staging and any deployment an operator has explicitly marked non-production.
 * Production users get the status-code copy above and nothing else, because an
 * unhandled error's message routinely quotes internals.
 */
export function resolveErrorDetail(message: unknown, previewSafeMode: boolean): string {
  if (!previewSafeMode) return ''
  return typeof message === 'string' ? message.trim() : ''
}
