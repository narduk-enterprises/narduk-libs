import { createError } from 'h3'
import { useRuntimeConfig } from 'nitropack/runtime'

import type { AppSessionUser } from '../lib/app-auth/types'
import type { H3Event } from 'h3'

/**
 * Restricted-session allowlists enforced by the session-grant validator.
 *
 * Recovery (`auth_sessions.recovery_mode`) and MFA step-up (`AUTH_REQUIRE_MFA`
 * + `aal !== aal2`) both fail closed: any `requireAuth` / `requireAdmin` path
 * that is not listed here is 403. Logout and `GET /api/auth/me` stay reachable
 * so the client can finish the flow or sign out.
 *
 * `AUTH_REQUIRE_MFA` is ignored on the local backend — that stack has no TOTP
 * enroll/verify, so enforcing the flag would brick password sessions.
 */
export const RECOVERY_SESSION_ALLOWED_REQUESTS = [
  { method: 'GET', path: '/api/auth/me' },
  { method: 'POST', path: '/api/auth/change-password' },
  { method: 'POST', path: '/api/auth/logout' },
] as const

export const MFA_STEP_UP_ALLOWED_REQUESTS = [
  { method: 'GET', path: '/api/auth/me' },
  { method: 'POST', path: '/api/auth/logout' },
  { method: 'POST', path: '/api/auth/mfa/enroll' },
  { method: 'POST', path: '/api/auth/mfa/verify' },
] as const

export function normalizePrivilegePath(path: string): string {
  const pathname = (path.split('?')[0] ?? path).trim()
  if (!pathname || pathname === '/') return '/'
  return pathname.replace(/\/+$/u, '') || '/'
}

export function requestMethod(event: Pick<H3Event, 'method'>): string {
  return (event.method || 'GET').toUpperCase()
}

function isAllowedRequest(
  event: Pick<H3Event, 'method' | 'path'>,
  allowlist: ReadonlyArray<{ method: string; path: string }>,
): boolean {
  const method = requestMethod(event)
  const path = normalizePrivilegePath(event.path ?? '')
  return allowlist.some((entry) => entry.method === method && entry.path === path)
}

export function isRecoverySessionAllowedRequest(event: Pick<H3Event, 'method' | 'path'>): boolean {
  return isAllowedRequest(event, RECOVERY_SESSION_ALLOWED_REQUESTS)
}

export function isMfaStepUpAllowedRequest(event: Pick<H3Event, 'method' | 'path'>): boolean {
  return isAllowedRequest(event, MFA_STEP_UP_ALLOWED_REQUESTS)
}

function readPrivilegeRuntime(event: H3Event): {
  backend: 'local' | 'supabase'
  requireMfa: boolean
} {
  try {
    const config = useRuntimeConfig(event) as {
      authBackend?: unknown
      public?: { authBackend?: unknown; authRequireMfa?: unknown }
    }
    const backendValue = config.authBackend ?? config.public?.authBackend
    const backend = backendValue === 'supabase' ? 'supabase' : 'local'
    return {
      backend,
      requireMfa: config.public?.authRequireMfa === true,
    }
  } catch {
    return { backend: 'local', requireMfa: false }
  }
}

export function sessionRequiresMfaStepUp(event: H3Event, user: AppSessionUser): boolean {
  // Local has no TOTP challenge; treating AUTH_REQUIRE_MFA as a lockout would
  // leave password users with nowhere to step up.
  if (user.authBackend === 'local') return false
  const { backend, requireMfa } = readPrivilegeRuntime(event)
  if (backend === 'local' || !requireMfa) return false
  return user.aal !== 'aal2'
}

export function assertSessionPrivilegeAllowsRequest(event: H3Event, user: AppSessionUser): void {
  if (user.recoveryMode && !isRecoverySessionAllowedRequest(event)) {
    throw createError({
      statusCode: 403,
      statusMessage: 'This session can only change the password or sign out.',
      data: { code: 'recovery_mode' },
    })
  }

  if (sessionRequiresMfaStepUp(event, user) && !isMfaStepUpAllowedRequest(event)) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Complete multi-factor authentication to continue.',
      data: { code: 'mfa_required' },
    })
  }
}
