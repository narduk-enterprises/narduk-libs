import { useLogger } from '#layer/server/utils/logger'
import { setSessionGrantValidator } from '#layer/server/utils/sessionGrant'

import { assertSessionPrivilegeAllowsRequest } from './session-privilege'
import { useRefreshedSessionUser } from './session-user'

import type { SessionGrantValidation } from '#layer/server/utils/sessionGrant'
import type { H3Event } from 'h3'

/**
 * narduk-auth grant validator for narduk-core `requireAuth`.
 *
 * Reuses `useRefreshedSessionUser` so existence, expiry, live `users` fields,
 * and (for Supabase) token refresh share one per-request cache. A cookie that
 * does not point at a live `auth_sessions` row fails closed.
 *
 * After the row is live, recovery-mode and MFA step-up are enforced here
 * against the allowlists in `session-privilege.ts`. Restricted sessions throw
 * 403 with `recovery_mode` / `mfa_required` so `requireAuth` surfaces the hint
 * (core still maps a missing row to generic 401).
 */
export async function validateRegisteredAuthSessionGrant(
  event: H3Event,
  _sessionUser: unknown,
): Promise<SessionGrantValidation> {
  let user
  try {
    user = await useRefreshedSessionUser(event)
  } catch (error) {
    useLogger(event).child('AppAuth').warn('Auth session grant validation failed closed', { error })
    return { status: 'invalid' }
  }

  if (!user) {
    return { status: 'invalid' }
  }

  // Privilege 403s (recovery_mode / mfa_required) must reach requireAuth.
  assertSessionPrivilegeAllowsRequest(event, user)
  return { status: 'valid', user }
}

export function attachAuthSessionGrantValidator(event: H3Event): void {
  setSessionGrantValidator(event, validateRegisteredAuthSessionGrant)
}
