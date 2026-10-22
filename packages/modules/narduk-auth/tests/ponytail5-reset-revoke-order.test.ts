import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Ponytail-5 repro (#2003 auth-tenancy-pg #2): completing a reset link writes
 * the new password hash, then revokes sessions, in separate autocommits after
 * the one-time token is consumed. If the revoke throws, the password has
 * already changed and old sessions survive. Red before the fix.
 */

const state = vi.hoisted(() => ({
  rows: [] as unknown[],
  writes: [] as string[],
}))

function chain(): Record<string, unknown> {
  const c: Record<string, unknown> = {}
  for (const method of [
    'update',
    'set',
    'where',
    'returning',
    'select',
    'from',
    'insert',
    'values',
  ]) {
    c[method] = () => c
  }
  return c
}

vi.mock('#layer/server/utils/database', () => ({
  executeDatabaseQuery: async () => {
    state.writes.push('users.password_hash')
  },
  getDatabaseRow: async () => state.rows.shift() ?? null,
  useDatabase: () => chain(),
}))
vi.mock('#layer/server/utils/logger', () => ({
  useLogger: () => ({ child: () => ({ warn: vi.fn(), info: vi.fn() }) }),
}))
vi.mock('#layer/server/utils/password', () => ({
  hashUserPassword: async (value: string) => `hashed:${value}`,
}))
vi.mock('#narduk-auth-server/utils/auth-bridge-database', () => ({
  useAuthBridgeDatabase: () => chain(),
}))
vi.mock('nitropack/runtime', () => ({ useRuntimeConfig: () => ({ authNativeClients: [] }) }))
vi.mock('../server/utils/native-auth', () => ({ useNativeAuth: () => ({ revokeUser: vi.fn() }) }))
vi.mock('../server/utils/verified-email', () => ({ recordLocalEmailVerification: vi.fn() }))
vi.mock('../server/lib/app-auth/local-email-throttle', () => ({
  assertLocalEmailAttemptAllowed: vi.fn(),
  clearLocalEmailAttempts: vi.fn(),
  recordLocalEmailAttemptFailure: vi.fn(),
}))
vi.mock('../server/lib/app-auth/local-email-runtime', () => ({
  assertLocalEmailDeliveryReady: vi.fn(),
  readLocalEmailSettings: () => ({ allowlist: [] }),
  sendLocalEmailLink: vi.fn(),
}))
vi.mock('../server/lib/app-auth/session', () => ({
  establishLocalSessionUser: vi.fn(),
  revokeUserAuthSessions: async () => {
    state.writes.push('revoke (throws)')
    throw new Error('D1_ERROR: simulated')
  },
}))
vi.mock('../server/lib/app-auth/supabase-client', () => ({
  getAuthConfig: () => ({ backend: 'local', redirectPath: '/' }),
}))

describe('local reset completion ordering', () => {
  beforeEach(() => {
    const user = { id: 'user-1', email: 'parent@example.com', passwordHash: 'old' }
    state.rows = [{ purpose: 'reset', email: 'parent@example.com', redirectPath: '/' }, user, user]
    state.writes = []
  })

  it('does not change the password when revoking old sessions fails', async () => {
    const { completeLocalEmailPassword } = await import('../server/lib/app-auth/local-email-flow')
    await expect(
      completeLocalEmailPassword(
        { context: {} } as never,
        {
          token: 'tok',
          newPassword: 'new-password-123',
        } as never,
      ),
    ).rejects.toThrow('simulated')
    expect(state.writes).toEqual(['revoke (throws)'])
  })
})
