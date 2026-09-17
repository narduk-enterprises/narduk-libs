import { beforeEach, describe, expect, it, vi } from 'vitest'

import accountDeleteRoute from '../server/api/auth/account/delete.post'
import changePasswordRoute from '../server/api/auth/change-password.post'
import profileRoute from '../server/api/auth/me.patch'
import enrollMfaRoute from '../server/api/auth/mfa/enroll.post'
import verifyMfaRoute from '../server/api/auth/mfa/verify.post'
import notificationCreateRoute from '../server/api/notifications/index.post'
import { resolvePersistedRecoveryMode } from '../server/lib/app-auth/recovery-mode'
import { assertInteractiveSessionPrincipal } from '../server/utils/interactive-principal'
import { AUTH_NOTIFICATION_SCOPES } from '../server/utils/notifications'

const deleteCurrentUserAccountBridge = vi.hoisted(() => vi.fn())

vi.mock('#narduk-auth-server/utils/accountDeletionBridge', () => ({
  deleteCurrentUserAccountBridge,
}))

interface CapturedMutation {
  __handler: (context: Record<string, unknown>) => Promise<unknown>
  __options: { requiredScopes?: string[] }
}

function captured(route: unknown): CapturedMutation {
  return route as unknown as CapturedMutation
}

describe('assertInteractiveSessionPrincipal', () => {
  it('rejects an API-key principal', () => {
    expect(() =>
      assertInteractiveSessionPrincipal({ authMethod: 'api-key' }, 'Account deletion'),
    ).toThrowError(/interactive session/)
  })

  it('allows a session principal', () => {
    expect(() =>
      assertInteractiveSessionPrincipal({ authMethod: 'session' }, 'Account deletion'),
    ).not.toThrow()
  })
})

describe('account delete refuses empty-scope API keys', () => {
  beforeEach(() => {
    deleteCurrentUserAccountBridge.mockReset()
  })

  it('returns 403 for an nk_ key before password rules run', async () => {
    await expect(
      captured(accountDeleteRoute).__handler({
        event: { path: '/api/auth/account/delete', method: 'POST' },
        user: { id: 'user-1', authMethod: 'api-key', scopes: [] },
        body: {},
      }),
    ).rejects.toMatchObject({ statusCode: 403 })
    expect(deleteCurrentUserAccountBridge).not.toHaveBeenCalled()
  })

  it('lets a session principal through to the password rules', async () => {
    await captured(accountDeleteRoute).__handler({
      event: { path: '/api/auth/account/delete', method: 'POST' },
      user: { id: 'user-1', authMethod: 'session' },
      body: {},
    })

    expect(deleteCurrentUserAccountBridge).toHaveBeenCalled()
  })
})

describe('notification mutations require a write scope', () => {
  it('declares auth:notifications:write', () => {
    expect(AUTH_NOTIFICATION_SCOPES.write).toBe('auth:notifications:write')
    expect(captured(notificationCreateRoute).__options.requiredScopes).toEqual([
      'auth:notifications:write',
    ])
  })
})

describe('persisted recovery_mode merge', () => {
  it('keeps the existing row flag when persist omits recoveryMode', () => {
    expect(resolvePersistedRecoveryMode(undefined, true)).toBe(true)
    expect(resolvePersistedRecoveryMode(undefined, false)).toBe(false)
    expect(resolvePersistedRecoveryMode(false, true)).toBe(false)
    expect(resolvePersistedRecoveryMode(true, false)).toBe(true)
    expect(resolvePersistedRecoveryMode(undefined, undefined)).toBe(false)
  })
})

describe('identity mutations refuse API keys', () => {
  it('returns 403 on change-password, profile, and MFA routes', async () => {
    const apiKey = { id: 'user-1', authMethod: 'api-key', scopes: [] }

    await expect(
      captured(changePasswordRoute).__handler({
        event: { path: '/api/auth/change-password', method: 'POST' },
        user: apiKey,
        body: { newPassword: 'new-password-1' },
      }),
    ).rejects.toMatchObject({ statusCode: 403 })

    await expect(
      captured(profileRoute).__handler({
        event: { path: '/api/auth/me', method: 'PATCH' },
        user: apiKey,
        body: { name: 'Parent' },
      }),
    ).rejects.toMatchObject({ statusCode: 403 })

    await expect(
      captured(enrollMfaRoute).__handler({
        event: { path: '/api/auth/mfa/enroll', method: 'POST' },
        user: apiKey,
        body: {},
      }),
    ).rejects.toMatchObject({ statusCode: 403 })

    await expect(
      captured(verifyMfaRoute).__handler({
        event: { path: '/api/auth/mfa/verify', method: 'POST' },
        user: apiKey,
        body: { factorId: 'factor-1', code: '123456' },
      }),
    ).rejects.toMatchObject({ statusCode: 403 })
  })
})
