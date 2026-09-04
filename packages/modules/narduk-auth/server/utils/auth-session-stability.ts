import {
  isAuthApiError,
  isAuthRetryableFetchError,
  isAuthSessionMissingError,
} from '@supabase/auth-js'

import type { AppSessionUser } from '#narduk-auth-server/lib/app-auth/types'

export const DEFAULT_AUTH_SESSION_REVALIDATE_WINDOW_MS = 5 * 60 * 1000

const TERMINAL_SUPABASE_SESSION_CODES = new Set([
  'refresh_token_not_found',
  'refresh_token_already_used',
  'session_not_found',
  'session_expired',
])

export function stampAuthSessionValidated<T extends AppSessionUser>(
  user: T,
  validatedAt = new Date().toISOString(),
): T {
  return {
    ...user,
    authSessionValidatedAt: validatedAt,
  }
}

export function wasAuthSessionRecentlyValidated(
  user: Pick<AppSessionUser, 'authSessionId' | 'authSessionValidatedAt'> | null | undefined,
  nowMs = Date.now(),
  revalidateWindowMs = DEFAULT_AUTH_SESSION_REVALIDATE_WINDOW_MS,
): boolean {
  if (!user?.authSessionId || !user.authSessionValidatedAt) {
    return false
  }

  const validatedAtMs = Date.parse(user.authSessionValidatedAt)
  if (!Number.isFinite(validatedAtMs)) {
    return false
  }

  return nowMs - validatedAtMs < revalidateWindowMs
}

function extractErrorMessage(error: unknown): string {
  if (!error || typeof error !== 'object') return String(error)
  const candidate = error as {
    data?: { message?: string; statusMessage?: string }
    message?: string
    status?: number
    statusCode?: number
    statusMessage?: string
  }
  return [
    candidate.message,
    candidate.statusMessage,
    candidate.data?.statusMessage,
    candidate.data?.message,
    typeof candidate.statusCode === 'number' ? String(candidate.statusCode) : '',
    typeof candidate.status === 'number' ? String(candidate.status) : '',
  ]
    .filter(Boolean)
    .join(' ')
}

function getErrorStatus(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null

  if ('statusCode' in error && typeof error.statusCode === 'number') {
    return error.statusCode
  }

  if ('status' in error && typeof error.status === 'number') {
    return error.status
  }

  return null
}

export function getSupabaseSessionErrorSummary(error: unknown): {
  code: string | null
  message: string
  name: string | null
  status: number | null
} {
  const candidate =
    error && typeof error === 'object'
      ? (error as { code?: unknown; name?: unknown })
      : { code: null, name: null }

  return {
    code: typeof candidate.code === 'string' ? candidate.code : null,
    message: extractErrorMessage(error),
    name: typeof candidate.name === 'string' ? candidate.name : null,
    status: getErrorStatus(error),
  }
}

function isLikelyAuthUpstreamFailure(message: string): boolean {
  if (!message) return false
  return (
    /is not valid JSON/i.test(message) ||
    /Unexpected token/i.test(message) ||
    /invalid json|json parse|parse error/i.test(message) ||
    /error code:\s*521/i.test(message) ||
    (/\b521\b/.test(message) && /invalid json|parse|fetch|auth/i.test(message))
  )
}

export function isRecoverableSupabaseSessionFailure(error: unknown): boolean {
  if (isAuthRetryableFetchError(error)) {
    return true
  }

  const message = extractErrorMessage(error)
  const status = getErrorStatus(error)

  if (isLikelyAuthUpstreamFailure(message)) {
    return true
  }

  if (status !== null && status >= 500) {
    return true
  }

  return (
    /\b(?:fetch failed|network error|econnreset|etimedout|timed out|timeout|temporarily unavailable)\b/i.test(
      message,
    ) ||
    /\b(?:failed to fetch|connection reset|connection refused|socket hang up)\b/i.test(message) ||
    /cloudflare\s+5\d{2}/i.test(message)
  )
}

export function isRefreshTokenReuseFailure(error: unknown): boolean {
  const { code, message } = getSupabaseSessionErrorSummary(error)
  return (
    code === 'refresh_token_already_used' ||
    /\brefresh[_\s-]?token[_\s-]?already[_\s-]?used\b/i.test(message)
  )
}

export function isTerminalSupabaseSessionFailure(error: unknown): boolean {
  if (isAuthSessionMissingError(error)) {
    return true
  }

  const { code, message } = getSupabaseSessionErrorSummary(error)
  if (code && TERMINAL_SUPABASE_SESSION_CODES.has(code)) {
    return true
  }

  if (isAuthApiError(error)) {
    return TERMINAL_SUPABASE_SESSION_CODES.has(String(error.code ?? ''))
  }

  return (
    /\brefresh[_\s-]?token[_\s-]?(?:not[_\s-]?found|already[_\s-]?used)\b/i.test(message) ||
    /\bsession[_\s-]?(?:not[_\s-]?found|expired)\b/i.test(message)
  )
}
