import { beforeEach, describe, expect, it, vi } from 'vitest'

import accountDeleteRoute from '../server/api/auth/account/delete.post'

import type { AppSessionUser } from '../server/lib/app-auth/types'

/**
 * narduk-libs#923: account deletion re-authenticated only against the local
 * `users.password_hash`. Supabase-provisioned users never have one, so on the
 * Supabase backend `POST /api/auth/account/delete` with `{}` deleted the local
 * user and the upstream identity with no password at all. A linked user with a
 * stale local hash had the opposite problem: deletion demanded the old local
 * password instead of the Supabase one they sign in with.
 */

const state = vi.hoisted(() => ({
  backend: 'supabase' as 'local' | 'supabase',
  deleted: 0,
  localHashChecks: 0,
  localPasswordHash: null as string | null,
  signIns: [] as Array<{ email: string; password: string }>,
  supabasePassword: 'right-password',
  upstreamDeletes: [] as string[],
  user: null as AppSessionUser | null,
}))

vi.mock(
  '#narduk-auth-server/utils/accountDeletionBridge',
  async () => import('../server/utils/accountDeletionBridge'),
)

vi.mock('#narduk-auth-server/utils/app-auth', async () => {
  const profile = await import('../server/lib/app-auth/profile')
  return {
    deleteSupabaseAuthUser: async (_event: unknown, userId: string) => {
      state.upstreamDeletes.push(userId)
    },
    verifySupabaseAccountDeletionCredentials: profile.verifySupabaseAccountDeletionCredentials,
  }
})

vi.mock('#layer/server/utils/database', () => {
  const chain: Record<string, unknown> = {}
  for (const method of ['delete', 'from', 'select', 'where']) {
    chain[method] = () => chain
  }
  return {
    executeDatabaseQuery: async () => {
      state.deleted += 1
    },
    getDatabaseRow: async () => ({
      id: 'user-1',
      email: 'parent@example.com',
      passwordHash: state.localPasswordHash,
    }),
    useDatabase: () => chain,
  }
})

vi.mock('#layer/server/utils/password', () => ({
  hashUserPassword: async (value: string) => `hashed:${value}`,
  verifyUserPassword: async (password: string) => {
    state.localHashChecks += 1
    return password === 'old-local-password'
  },
}))

vi.mock('#layer/server/utils/user-session', () => ({
  clearLayerUserSession: vi.fn(),
  replaceLayerUserSession: vi.fn(),
}))

vi.mock('../server/utils/session-user', () => ({
  useRefreshedSessionUser: async () => state.user,
}))

vi.mock('../server/utils/native-auth', () => ({
  useNativeAuth: () => ({ revokeUser: vi.fn() }),
}))

vi.mock('../server/lib/app-auth/linking', () => ({ ensureLinkedLocalUser: vi.fn() }))
vi.mock('../server/lib/app-auth/helpers', () => ({ encodeQrCodeDataUrl: (v: string) => v }))
vi.mock('../server/lib/app-auth/session', () => ({
  clearAuthSessionRecoveryMode: vi.fn(),
  commitSupabaseSessionFromClient: vi.fn(),
  getCurrentSessionUser: async () => state.user,
  getCurrentSupabaseContext: vi.fn(),
  revokeUserAuthSessions: vi.fn(),
}))

vi.mock('../server/lib/app-auth/supabase-client', () => ({
  getAuthConfig: () => ({ backend: state.backend }),
  createSupabaseUserClient: () => ({
    signInWithPassword: async (credentials: { email: string; password: string }) => {
      state.signIns.push(credentials)
      return credentials.password === state.supabasePassword
        ? { error: null }
        : { error: { message: 'Invalid login credentials' } }
    },
  }),
  readRuntimeConfigString: (value: unknown, fallback = '') =>
    typeof value === 'string' ? value : fallback,
  toSupabaseHttpError: (error: unknown) => {
    throw error
  },
}))

vi.mock('nitropack/runtime', () => ({
  useRuntimeConfig: () => ({ authNativeClients: [], public: {} }),
}))

interface CapturedMutation {
  __handler: (context: Record<string, unknown>) => Promise<unknown>
}

const route = accountDeleteRoute as unknown as CapturedMutation

const SUPABASE_EMAIL_USER: AppSessionUser = {
  id: 'user-1',
  email: 'parent@example.com',
  name: 'Parent',
  isAdmin: false,
  authBackend: 'supabase',
  authMethod: 'session',
  authProviders: ['email'],
  authSessionId: 'sess-1',
  needsPasswordSetup: false,
  recoveryMode: false,
} as AppSessionUser

function deleteAccount(body: Record<string, unknown>) {
  return route.__handler({
    event: { context: {}, path: '/api/auth/account/delete', method: 'POST' },
    user: state.user,
    body,
  })
}

describe('account deletion re-authentication on the Supabase backend (#923)', () => {
  beforeEach(() => {
    state.backend = 'supabase'
    state.deleted = 0
    state.localHashChecks = 0
    state.localPasswordHash = null
    state.signIns = []
    state.upstreamDeletes = []
    state.user = { ...SUPABASE_EMAIL_USER }
  })

  it('refuses an email+password account that sends no current password', async () => {
    await expect(deleteAccount({})).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: 'Current password is required to delete this account.',
    })
    expect(state.upstreamDeletes).toEqual([])
    expect(state.deleted).toBe(0)
  })

  it('refuses a wrong current password, checked against Supabase', async () => {
    await expect(deleteAccount({ currentPassword: 'wrong' })).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: 'Invalid current password.',
    })
    expect(state.signIns).toEqual([{ email: 'parent@example.com', password: 'wrong' }])
    expect(state.upstreamDeletes).toEqual([])
    expect(state.deleted).toBe(0)
  })

  it('deletes after Supabase verifies the current password', async () => {
    await expect(deleteAccount({ currentPassword: 'right-password' })).resolves.toEqual({
      success: true,
    })
    expect(state.upstreamDeletes).toEqual(['user-1'])
    expect(state.deleted).toBe(1)
  })

  it('checks the Supabase password, not a stale local hash, for a linked user', async () => {
    state.localPasswordHash = 'stale-local-hash'

    await expect(deleteAccount({ currentPassword: 'right-password' })).resolves.toEqual({
      success: true,
    })
    expect(state.localHashChecks).toBe(0)

    await expect(deleteAccount({ currentPassword: 'old-local-password' })).rejects.toMatchObject({
      statusCode: 400,
    })
  })

  it('keeps provider-only Supabase accounts on the no-password path', async () => {
    state.user = { ...SUPABASE_EMAIL_USER, authProviders: ['google'] }

    await expect(deleteAccount({})).resolves.toEqual({ success: true })
    expect(state.signIns).toEqual([])
  })

  it('keeps the local backend on the local hash check', async () => {
    state.backend = 'local'
    state.localPasswordHash = 'local-hash'
    state.user = {
      ...SUPABASE_EMAIL_USER,
      authBackend: 'local',
      authProviders: undefined,
    } as AppSessionUser

    await expect(deleteAccount({})).rejects.toMatchObject({ statusCode: 400 })
    await expect(deleteAccount({ currentPassword: 'old-local-password' })).resolves.toEqual({
      success: true,
    })
    expect(state.localHashChecks).toBe(1)
    expect(state.signIns).toEqual([])
    expect(state.upstreamDeletes).toEqual([])
  })
})

/**
 * narduk-libs#1051: the stock route passes `verifyCredentials`, but an app that
 * builds its own delete route on the public helper and passes no hooks used to
 * fall through to the local hash check, which a Supabase user without a local
 * hash skips — so `{}` deleted the account.
 */
describe('custom delete route built on the helper (#1051)', () => {
  beforeEach(() => {
    state.backend = 'supabase'
    state.deleted = 0
    state.localHashChecks = 0
    state.localPasswordHash = null
    state.signIns = []
    state.upstreamDeletes = []
    state.user = { ...SUPABASE_EMAIL_USER }
  })

  async function customDelete(body: { currentPassword?: string }) {
    const { deleteCurrentUserAccount } = await import('../server/utils/accountDeletion')
    return deleteCurrentUserAccount(
      { context: {}, path: '/api/me/delete', method: 'POST' } as never,
      state.user as never,
      body,
    )
  }

  it('refuses a Supabase delete with an empty body', async () => {
    await expect(customDelete({})).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: 'Current password is required to delete this account.',
    })
    expect(state.deleted).toBe(0)
  })

  it('refuses a wrong password, checked against Supabase', async () => {
    await expect(customDelete({ currentPassword: 'wrong' })).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: 'Invalid current password.',
    })
    expect(state.signIns).toEqual([{ email: 'parent@example.com', password: 'wrong' }])
    expect(state.deleted).toBe(0)
  })

  it('accepts the right password', async () => {
    await expect(customDelete({ currentPassword: 'right-password' })).resolves.toBeUndefined()
    expect(state.localHashChecks).toBe(0)
    expect(state.deleted).toBe(1)
  })

  it('refuses a caller with no Supabase session on a Supabase app', async () => {
    // e.g. an API-key principal: nothing to re-authenticate, so fail closed.
    const principal = { ...SUPABASE_EMAIL_USER }
    delete (principal as { authBackend?: string }).authBackend
    state.user = null
    const { deleteCurrentUserAccount } = await import('../server/utils/accountDeletion')
    await expect(
      deleteCurrentUserAccount({ context: {} } as never, principal as never, {}),
    ).rejects.toMatchObject({ statusCode: 401 })
    expect(state.deleted).toBe(0)
  })

  it("refuses when the re-authenticated session is not the principal's account", async () => {
    // A victim's API key resolves the principal; the cookie is the attacker's
    // own session, so the attacker's own password must not unlock the delete.
    const victim = { ...SUPABASE_EMAIL_USER, id: 'victim-1', email: 'victim@example.com' }
    delete (victim as { authBackend?: string }).authBackend
    const { deleteCurrentUserAccount } = await import('../server/utils/accountDeletion')

    state.user = { ...SUPABASE_EMAIL_USER, id: 'attacker-1', email: 'attacker@example.com' }
    await expect(
      deleteCurrentUserAccount({ context: {} } as never, victim as never, {
        currentPassword: state.supabasePassword,
      }),
    ).rejects.toMatchObject({ statusCode: 401 })

    // An OAuth-only attacker session would otherwise need no password at all.
    state.user = { ...state.user, authProviders: ['google'] }
    await expect(
      deleteCurrentUserAccount({ context: {} } as never, victim as never, {}),
    ).rejects.toMatchObject({ statusCode: 401 })

    expect(state.signIns).toEqual([])
    expect(state.deleted).toBe(0)
  })

  it('keeps the binding when the Supabase check is passed as the verifyCredentials hook', async () => {
    // The documented custom-route pattern: the hook now receives the account id.
    const victim = { ...SUPABASE_EMAIL_USER, id: 'victim-1', email: 'victim@example.com' }
    const { verifySupabaseAccountDeletionCredentials } =
      await import('../server/lib/app-auth/profile')
    const { deleteCurrentUserAccount } = await import('../server/utils/accountDeletion')

    state.user = { ...SUPABASE_EMAIL_USER, id: 'attacker-1', email: 'attacker@example.com' }
    await expect(
      deleteCurrentUserAccount(
        { context: {} } as never,
        victim as never,
        { currentPassword: state.supabasePassword },
        { verifyCredentials: verifySupabaseAccountDeletionCredentials },
      ),
    ).rejects.toMatchObject({ statusCode: 401 })
    expect(state.signIns).toEqual([])
    expect(state.deleted).toBe(0)
  })

  it('lets a caller that re-authenticates itself opt out with its own verifyCredentials', async () => {
    const { deleteCurrentUserAccount } = await import('../server/utils/accountDeletion')
    await expect(
      deleteCurrentUserAccount(
        { context: {} } as never,
        state.user as never,
        {},
        {
          verifyCredentials: async () => {},
        },
      ),
    ).resolves.toBeUndefined()
    expect(state.signIns).toEqual([])
    expect(state.deleted).toBe(1)
  })

  it('keeps the local backend on the local hash check', async () => {
    state.backend = 'local'
    state.localPasswordHash = 'local-hash'
    state.user = { ...SUPABASE_EMAIL_USER, authBackend: 'local' } as AppSessionUser
    await expect(customDelete({})).rejects.toMatchObject({ statusCode: 400 })
    await expect(customDelete({ currentPassword: 'old-local-password' })).resolves.toBeUndefined()
    expect(state.signIns).toEqual([])
  })
})
