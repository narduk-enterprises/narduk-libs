import { registerAuthSessionStabilityTests } from '../../../src/server/kit/auth-session-stability'

import type { AuthSessionStabilityModule } from '../../../src/server/kit/auth-session-stability'

const DEFAULT_AUTH_SESSION_REVALIDATE_WINDOW_MS = 5 * 60 * 1000

function stubModule(): AuthSessionStabilityModule {
  return {
    DEFAULT_AUTH_SESSION_REVALIDATE_WINDOW_MS,
    stampAuthSessionValidated: (user, validatedAt = new Date().toISOString()) => ({
      ...user,
      authSessionValidatedAt: validatedAt,
    }),
    wasAuthSessionRecentlyValidated: (
      user,
      nowMs = Date.now(),
      revalidateWindowMs = DEFAULT_AUTH_SESSION_REVALIDATE_WINDOW_MS,
    ) => {
      if (!user?.authSessionId || !user.authSessionValidatedAt) return false
      const validatedAtMs = Date.parse(user.authSessionValidatedAt)
      if (!Number.isFinite(validatedAtMs)) return false
      return nowMs - validatedAtMs < revalidateWindowMs
    },
    isRecoverableSupabaseSessionFailure: (error: unknown) => {
      if (!error || typeof error !== 'object') return false
      const candidate = error as {
        message?: string
        status?: number
        statusCode?: number
      }
      const message = candidate.message ?? ''
      const status = candidate.statusCode ?? candidate.status ?? null

      if (/error code:\s*521/i.test(message)) return true
      if (status !== null && status >= 500) return true
      if (/fetch failed|network error/i.test(message)) return true
      return false
    },
  }
}

registerAuthSessionStabilityTests(() => stubModule(), {
  describeName: 'auth-session-stability kit (behavior test)',
})
