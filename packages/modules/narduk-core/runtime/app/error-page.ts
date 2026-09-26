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

/**
 * An app's own words for the page, per status code, with `default` for every
 * status it does not name (narduk-libs#976). An entry sets the title and the
 * description only; there is no way to route `error.message` through it.
 */
export type ErrorPageCopy = Partial<
  Record<'default' | number, Partial<ErrorPagePresentation> | undefined>
>

/** An extra recovery link shown beside Go Home and Try Again. */
export interface ErrorPageLink {
  /** An `i-lucide-*` style icon name. */
  icon?: string
  label: string
  to: string
}

/**
 * Classes for the page's parts, so an app themes it without `:deep()`
 * selectors on its test ids. Each replaces the part's default colour classes.
 */
export interface ErrorPageUi {
  /** The Go Home button, merged into its classes. */
  home?: string
  /** The outer wrapper. Replaces `min-h-screen bg-default`. */
  root?: string
  /** The status code. Replaces `text-primary`. */
  status?: string
  /** The heading. Replaces `text-primary`. */
  title?: string
}

/** Which recovery action is about to run. */
export type ErrorPageAction = 'home' | 'retry'

/**
 * Heading and body text for a status code: the app's `copy` for that status,
 * then its `copy.default`, then the estate copy, field by field. Never echoes
 * the error's own message.
 */
export function resolveErrorPresentation(
  statusCode: unknown,
  copy?: ErrorPageCopy,
): ErrorPagePresentation {
  const code = resolveErrorStatusCode(statusCode)
  const estate = PRESENTATIONS[code] ?? FALLBACK
  const own = copy?.[code]
  const fallback = copy?.default
  return {
    title: pickText(own?.title, fallback?.title, estate.title),
    description: pickText(own?.description, fallback?.description, estate.description),
  }
}

function pickText(...candidates: Array<string | undefined>): string {
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim() !== '') return candidate
  }
  return ''
}

/**
 * Runs an app's `onBeforeClear` hook, then the recovery action. A hook that
 * throws or rejects is ignored: logging must never stand between a user and
 * the way out of an error page.
 */
export async function runBeforeClear<TError>(
  hook: ((error: TError, action: ErrorPageAction) => unknown) | undefined,
  error: TError,
  action: ErrorPageAction,
): Promise<void> {
  if (!hook) return
  try {
    await hook(error, action)
  } catch {
    /* best-effort by contract */
  }
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
