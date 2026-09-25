import { beforeEach, describe, expect, it, vi } from 'vitest'

import accountDeleteRoute from '../server/api/auth/account/delete.post'

import type { AppSessionUser } from '../server/lib/app-auth/types'

/**
 * narduk-libs#1052 (the rest of #923): a social-only Supabase account has no
 * password to prove, so account deletion needs a recent sign-in instead; an
 * invited `email`-provider user is held to the password on purpose; and the
 * Supabase session the password check creates is signed out.
 */

const state = vi.hoisted(() => ({
  deleted: 0,
  sessionCreatedAt: null as string | null,
  signIns: [] as Array<{ email: string; password: string }>,
  signOuts: [] as Array<{ scope?: string }>,
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
    getDatabaseRow: async () => ({ id: 'user-1', email: 'parent@example.com', passwordHash: null }),
    useDatabase: () => chain,
  }
})

vi.mock('#layer/server/utils/password', () => ({
  hashUserPassword: async (value: string) => `hashed:${value}`,
  verifyUserPassword: async () => false,
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
  loadAuthSessionRow: async (_event: unknown, id: string) =>
    state.sessionCreatedAt && id === 'sess-1' ? { createdAt: state.sessionCreatedAt } : null,
  revokeUserAuthSessions: vi.fn(),
}))

vi.mock('../server/lib/app-auth/supabase-client', () => ({
  getAuthConfig: () => ({ backend: 'supabase' }),
  createSupabaseUserClient: () => ({
    signInWithPassword: async (credentials: { email: string; password: string }) => {
      state.signIns.push(credentials)
      return credentials.password === 'right-password'
        ? { error: null }
        : { error: { message: 'Invalid login credentials' } }
    },
    signOut: async (options: { scope?: string }) => {
      state.signOuts.push(options)
      return { error: null }
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

const route = accountDeleteRoute as unknown as {
  __handler: (context: Record<string, unknown>) => Promise<unknown>
}

const BASE_USER = {
  id: 'user-1',
  email: 'parent@example.com',
  name: 'Parent',
  isAdmin: false,
  authBackend: 'supabase',
  authMethod: 'session',
  authSessionId: 'sess-1',
  needsPasswordSetup: false,
  recoveryMode: false,
} as AppSessionUser

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString()
}

function deleteAccount(body: Record<string, unknown>) {
  return route.__handler({
    event: { context: {}, path: '/api/auth/account/delete', method: 'POST' },
    user: state.user,
    body,
  })
}

describe('social-only Supabase account deletion needs a recent sign-in (#1052)', () => {
  beforeEach(() => {
    state.deleted = 0
    state.sessionCreatedAt = minutesAgo(1)
    state.signIns = []
    state.signOuts = []
    state.upstreamDeletes = []
    state.user = { ...BASE_USER, authProviders: ['apple'], needsPasswordSetup: true }
  })

  it('deletes when the session signed in within the window', async () => {
    await expect(deleteAccount({})).resolves.toEqual({ success: true })
    expect(state.upstreamDeletes).toEqual(['user-1'])
    expect(state.signIns).toEqual([])
  })

  it('refuses a session that signed in longer ago than the window', async () => {
    state.sessionCreatedAt = minutesAgo(11)
    await expect(deleteAccount({})).rejects.toMatchObject({
      statusCode: 403,
      data: { code: 'reauthentication_required' },
    })
    expect(state.upstreamDeletes).toEqual([])
    expect(state.deleted).toBe(0)
  })

  it('refuses when the auth_sessions row cannot be found', async () => {
    state.sessionCreatedAt = null
    await expect(deleteAccount({})).rejects.toMatchObject({
      data: { code: 'reauthentication_required' },
    })
    expect(state.deleted).toBe(0)
  })

  it('does not let a password stand in for the recent sign-in', async () => {
    state.sessionCreatedAt = minutesAgo(60)
    await expect(deleteAccount({ currentPassword: 'right-password' })).rejects.toMatchObject({
      data: { code: 'reauthentication_required' },
    })
    expect(state.signIns).toEqual([])
  })
})

describe('invited email-provider users are held to the password (#1052)', () => {
  beforeEach(() => {
    state.deleted = 0
    state.sessionCreatedAt = minutesAgo(1)
    state.signIns = []
    state.signOuts = []
    state.upstreamDeletes = []
    // Supabase reports an invited / magic-link user as provider `email`, so
    // needsPasswordSetup is false even if they never chose a password.
    state.user = { ...BASE_USER, authProviders: ['email'] }
  })

  it('requires the current password even straight after a magic-link sign-in', async () => {
    await expect(deleteAccount({})).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: 'Current password is required to delete this account.',
    })
    expect(state.deleted).toBe(0)
  })

  it('signs the verification session out, local scope, after the password check', async () => {
    await expect(deleteAccount({ currentPassword: 'right-password' })).resolves.toEqual({
      success: true,
    })
    expect(state.signOuts).toEqual([{ scope: 'local' }])
  })

  it('creates no verification session to sign out when the password is wrong', async () => {
    await expect(deleteAccount({ currentPassword: 'wrong' })).rejects.toMatchObject({
      statusCode: 400,
    })
    expect(state.signOuts).toEqual([])
  })
})
