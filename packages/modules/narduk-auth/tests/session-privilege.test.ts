import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AppSessionUser } from '../server/lib/app-auth/types'
import type { H3Event } from 'h3'

const state = vi.hoisted(() => ({
  backend: 'supabase' as 'local' | 'supabase',
  requireMfa: false,
  user: null as AppSessionUser | null,
}))

vi.mock('../server/utils/session-user', () => ({
  useRefreshedSessionUser: async () => state.user,
}))

vi.mock('nitropack/runtime', () => ({
  useRuntimeConfig: () => ({
    authBackend: state.backend,
    public: { authBackend: state.backend, authRequireMfa: state.requireMfa },
  }),
}))

function principal(overrides: Partial<AppSessionUser> = {}): AppSessionUser {
  return {
    id: 'user-1',
    email: 'parent@example.com',
    name: 'Parent',
    isAdmin: false,
    authBackend: 'supabase',
    authSessionId: 'sess-1',
    aal: 'aal1',
    recoveryMode: false,
    ...overrides,
  }
}

function event(path: string, method = 'GET'): H3Event {
  return { context: {}, path, method } as H3Event
}

describe('restricted session allowlists', () => {
  beforeEach(() => {
    state.backend = 'supabase'
    state.requireMfa = false
    state.user = null
    vi.resetModules()
  })

  it('rejects a recovery session on API-key mint and allows change-password', async () => {
    state.user = principal({ recoveryMode: true })
    const { validateRegisteredAuthSessionGrant } =
      await import('../server/utils/session-grant-validator')

    await expect(
      validateRegisteredAuthSessionGrant(event('/api/auth/api-keys', 'POST'), state.user),
    ).rejects.toMatchObject({
      statusCode: 403,
      data: { code: 'recovery_mode' },
    })

    await expect(
      validateRegisteredAuthSessionGrant(event('/api/auth/change-password', 'POST'), state.user),
    ).resolves.toEqual({ status: 'valid', user: state.user })

    await expect(
      validateRegisteredAuthSessionGrant(event('/api/auth/me', 'GET'), state.user),
    ).resolves.toEqual({ status: 'valid', user: state.user })

    await expect(
      validateRegisteredAuthSessionGrant(event('/api/auth/me', 'PATCH'), state.user),
    ).rejects.toMatchObject({ data: { code: 'recovery_mode' } })
  })

  it('rejects aal1 when AUTH_REQUIRE_MFA is on, except MFA verify/enroll', async () => {
    state.requireMfa = true
    state.user = principal({ aal: 'aal1' })
    const { validateRegisteredAuthSessionGrant } =
      await import('../server/utils/session-grant-validator')

    await expect(
      validateRegisteredAuthSessionGrant(event('/api/auth/api-keys', 'POST'), state.user),
    ).rejects.toMatchObject({
      statusCode: 403,
      data: { code: 'mfa_required' },
    })

    await expect(
      validateRegisteredAuthSessionGrant(event('/api/auth/mfa/verify', 'POST'), state.user),
    ).resolves.toEqual({ status: 'valid', user: state.user })

    await expect(
      validateRegisteredAuthSessionGrant(event('/api/auth/mfa/enroll', 'POST'), state.user),
    ).resolves.toEqual({ status: 'valid', user: state.user })
  })

  it('allows a protected route after the session is aal2', async () => {
    state.requireMfa = true
    state.user = principal({ aal: 'aal2' })
    const { validateRegisteredAuthSessionGrant } =
      await import('../server/utils/session-grant-validator')

    await expect(
      validateRegisteredAuthSessionGrant(event('/api/auth/api-keys', 'POST'), state.user),
    ).resolves.toEqual({ status: 'valid', user: state.user })
  })

  it('does not enforce AUTH_REQUIRE_MFA on the local backend', async () => {
    state.backend = 'local'
    state.requireMfa = true
    state.user = principal({ authBackend: 'local', aal: 'aal1' })
    const { validateRegisteredAuthSessionGrant } =
      await import('../server/utils/session-grant-validator')

    await expect(
      validateRegisteredAuthSessionGrant(event('/api/admin/users/role', 'PUT'), state.user),
    ).resolves.toEqual({ status: 'valid', user: state.user })
  })
})

describe('recovery and MFA path helpers', () => {
  it('documents the exact allowlists', async () => {
    const {
      MFA_STEP_UP_ALLOWED_REQUESTS,
      RECOVERY_SESSION_ALLOWED_REQUESTS,
      isMfaStepUpAllowedRequest,
      isRecoverySessionAllowedRequest,
    } = await import('../server/utils/session-privilege')

    expect(RECOVERY_SESSION_ALLOWED_REQUESTS).toEqual([
      { method: 'GET', path: '/api/auth/me' },
      { method: 'POST', path: '/api/auth/change-password' },
      { method: 'POST', path: '/api/auth/logout' },
    ])
    expect(MFA_STEP_UP_ALLOWED_REQUESTS).toEqual([
      { method: 'GET', path: '/api/auth/me' },
      { method: 'POST', path: '/api/auth/logout' },
      { method: 'POST', path: '/api/auth/mfa/enroll' },
      { method: 'POST', path: '/api/auth/mfa/verify' },
    ])
    expect(isRecoverySessionAllowedRequest({ method: 'POST', path: '/api/auth/logout' })).toBe(true)
    expect(isMfaStepUpAllowedRequest({ method: 'POST', path: '/api/auth/api-keys' })).toBe(false)
  })
})
