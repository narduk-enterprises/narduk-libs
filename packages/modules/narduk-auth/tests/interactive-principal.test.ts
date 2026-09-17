import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it, vi } from 'vitest'

import accountDeleteRoute from '../server/api/auth/account/delete.post'
import notificationCreateRoute from '../server/api/notifications/index.post'
import { resolvePersistedRecoveryMode } from '../server/lib/app-auth/recovery-mode'
import { assertInteractiveSessionPrincipal } from '../server/utils/interactive-principal'
import { AUTH_NOTIFICATION_SCOPES } from '../server/utils/notifications'

vi.mock('#narduk-auth-server/utils/accountDeletionBridge', () => ({
  deleteCurrentUserAccountBridge: vi.fn(),
}))

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

function stripComments(source: string): string {
  return source
    .replaceAll(/\/\*[\s\S]*?\*\//gu, '')
    .split('\n')
    .filter((line) => !/^\s*\/\//u.test(line))
    .join('\n')
}

interface CapturedMutation {
  __handler: (context: Record<string, unknown>) => Promise<unknown>
  __options: { requiredScopes?: string[] }
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
  it('returns 403 for an nk_ key before password rules run', async () => {
    const route = accountDeleteRoute as unknown as CapturedMutation

    await expect(
      route.__handler({
        event: { path: '/api/auth/account/delete', method: 'POST' },
        user: { id: 'user-1', authMethod: 'api-key', scopes: [] },
        body: {},
      }),
    ).rejects.toMatchObject({ statusCode: 403 })
  })

  it('lets a session principal through to the password rules', async () => {
    const source = stripComments(
      readFileSync(join(packageRoot, 'server/api/auth/account/delete.post.ts'), 'utf8'),
    )
    expect(source).toContain("assertInteractiveSessionPrincipal(user, 'Account deletion')")
    expect(source).toContain('deleteCurrentUserAccountBridge')
  })
})

describe('notification mutations require a write scope', () => {
  it('declares auth:notifications:write', () => {
    expect(AUTH_NOTIFICATION_SCOPES.write).toBe('auth:notifications:write')
    const route = notificationCreateRoute as unknown as CapturedMutation
    expect(route.__options.requiredScopes).toEqual(['auth:notifications:write'])
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
  it('guards change-password, profile, and MFA routes', () => {
    for (const file of [
      'server/api/auth/change-password.post.ts',
      'server/api/auth/me.patch.ts',
      'server/api/auth/mfa/enroll.post.ts',
      'server/api/auth/mfa/verify.post.ts',
    ]) {
      const source = stripComments(readFileSync(join(packageRoot, file), 'utf8'))
      expect(source).toContain('assertInteractiveSessionPrincipal(user')
    }
  })
})
