import { describe, expect, it } from 'vitest'

export interface AuthSessionStabilityModule {
  DEFAULT_AUTH_SESSION_REVALIDATE_WINDOW_MS: number
  isRecoverableSupabaseSessionFailure: (error: unknown) => boolean
  stampAuthSessionValidated: <T extends Record<string, unknown>>(user: T, validatedAt?: string) => T
  wasAuthSessionRecentlyValidated: (
    user:
      | {
          authSessionId?: string
          authSessionValidatedAt?: string
        }
      | null
      | undefined,
    nowMs?: number,
    revalidateWindowMs?: number,
  ) => boolean
}

type LoadAuthSessionStabilityModule = () =>
  Promise<AuthSessionStabilityModule> | AuthSessionStabilityModule

interface AuthSessionStabilityKitOptions {
  describeName?: string
}

/**
 * Register the fleet's canonical vitest coverage for the shared auth-session
 * stability utils. Apps supply a lazy loader that resolves to the auth package
 * module copy bundled into their `node_modules`:
 *
 *   import { registerAuthSessionStabilityTests } from '@narduk-enterprises/narduk-testkit/server/kit/auth-session-stability'
 *   registerAuthSessionStabilityTests(() =>
 *     import('@narduk-enterprises/narduk-auth/server/utils/auth-session-stability'),
 *   )
 */
export function registerAuthSessionStabilityTests(
  loadModule: LoadAuthSessionStabilityModule,
  options: AuthSessionStabilityKitOptions = {},
) {
  const { describeName = 'auth session stability utils' } = options

  describe(describeName, () => {
    it('stamps the validation time onto a shared-auth session user', async () => {
      const { stampAuthSessionValidated } = await loadModule()
      const user = stampAuthSessionValidated({
        id: 'user_123',
        email: 'ops@example.com',
        name: 'Ops',
        isAdmin: true,
        authSessionId: 'auth_session_123',
      }) as unknown as { authSessionValidatedAt: string }

      expect(user.authSessionValidatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    })

    it('detects when a shared-auth session was validated recently', async () => {
      const { DEFAULT_AUTH_SESSION_REVALIDATE_WINDOW_MS, wasAuthSessionRecentlyValidated } =
        await loadModule()
      expect(
        wasAuthSessionRecentlyValidated(
          {
            authSessionId: 'auth_session_123',
            authSessionValidatedAt: '2026-04-01T00:04:30.000Z',
          },
          Date.parse('2026-04-01T00:05:00.000Z'),
          DEFAULT_AUTH_SESSION_REVALIDATE_WINDOW_MS,
        ),
      ).toBe(true)
    })

    it('requires revalidation after the grace window elapses', async () => {
      const { DEFAULT_AUTH_SESSION_REVALIDATE_WINDOW_MS, wasAuthSessionRecentlyValidated } =
        await loadModule()
      expect(
        wasAuthSessionRecentlyValidated(
          {
            authSessionId: 'auth_session_123',
            authSessionValidatedAt: '2026-04-01T00:00:00.000Z',
          },
          Date.parse('2026-04-01T00:06:00.000Z'),
          DEFAULT_AUTH_SESSION_REVALIDATE_WINDOW_MS,
        ),
      ).toBe(false)
    })

    it('treats Cloudflare and network failures as recoverable auth refresh errors', async () => {
      const { isRecoverableSupabaseSessionFailure } = await loadModule()
      expect(
        isRecoverableSupabaseSessionFailure(
          new Error('unexpected token < in JSON at position 0 error code: 521'),
        ),
      ).toBe(true)
      expect(
        isRecoverableSupabaseSessionFailure(
          Object.assign(new Error('fetch failed'), { statusCode: 503 }),
        ),
      ).toBe(true)
      expect(
        isRecoverableSupabaseSessionFailure(new Error('network error while contacting auth host')),
      ).toBe(true)
    })

    it('does not treat invalid refresh token errors as recoverable', async () => {
      const { isRecoverableSupabaseSessionFailure } = await loadModule()
      expect(
        isRecoverableSupabaseSessionFailure(
          Object.assign(new Error('Invalid Refresh Token: Refresh Token Not Found'), {
            statusCode: 401,
          }),
        ),
      ).toBe(false)
    })
  })
}
