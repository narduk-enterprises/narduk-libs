import { beforeEach, describe, expect, it, vi } from 'vitest'

import { changePassword } from '../server/lib/app-auth/profile'

import type { AppSessionUser } from '../server/lib/app-auth/types'

/**
 * narduk-libs#1075: a social-only Supabase session has no password to prove, so
 * setting its first password used to need no proof at all. That password then
 * signed in afresh (`POST /api/auth/login`), and the fresh `auth_sessions` row
 * satisfied the recent-sign-in window account deletion relies on (#1071). The
 * first password now needs the same recent sign-in.
 */

const state = vi.hoisted(() => ({
  passwordUpdates: [] as string[],
  sessionCreatedAt: null as string | null,
  signIns: [] as Array<{ email: string; password: string }>,
  user: null as AppSessionUser | null,
}))

vi.mock('#layer/server/utils/database', () => ({
  executeDatabaseQuery: vi.fn(),
  getDatabaseRow: vi.fn(),
  useDatabase: vi.fn(),
}))

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
  getCurrentSupabaseContext: async () => ({
    client: {
      updateUser: async ({ password }: { password: string }) => {
        state.passwordUpdates.push(password)
        return { data: { user: { id: 'auth-user-1' } }, error: null }
      },
    },
    localUser: { id: 'user-1' },
    authSessionId: 'sess-1',
    sessionUser: state.user,
  }),
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
    signOut: async () => ({ error: null }),
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

const SOCIAL_ONLY_USER = {
  id: 'user-1',
  email: 'parent@example.com',
  name: 'Parent',
  isAdmin: false,
  authBackend: 'supabase',
  authMethod: 'session',
  authProviders: ['google'],
  authSessionId: 'sess-1',
  needsPasswordSetup: false,
  recoveryMode: false,
} as AppSessionUser

const event = { context: {}, path: '/api/auth/change-password', method: 'POST' } as never

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString()
}

describe('a social-only session setting its first password needs a recent sign-in (#1075)', () => {
  beforeEach(() => {
    state.passwordUpdates = []
    state.sessionCreatedAt = minutesAgo(1)
    state.signIns = []
    state.user = { ...SOCIAL_ONLY_USER }
  })

  it('refuses an old social-only session and never sets the password', async () => {
    state.sessionCreatedAt = minutesAgo(60)

    await expect(changePassword(event, { newPassword: 'attacker-chosen-1' })).rejects.toMatchObject(
      {
        statusCode: 403,
        data: { code: 'reauthentication_required' },
      },
    )
    expect(state.passwordUpdates).toEqual([])
  })

  it('refuses a social-only session whose auth_sessions row is gone', async () => {
    state.sessionCreatedAt = null

    await expect(changePassword(event, { newPassword: 'attacker-chosen-1' })).rejects.toMatchObject(
      { statusCode: 403 },
    )
    expect(state.passwordUpdates).toEqual([])
  })

  it('lets a social-only session that signed in recently set its first password', async () => {
    await expect(changePassword(event, { newPassword: 'chosen-password-1' })).resolves.toEqual({
      success: true,
    })
    expect(state.passwordUpdates).toEqual(['chosen-password-1'])
    expect(state.signIns).toEqual([])
  })

  it('still lets a recovery session set a password without a recent sign-in', async () => {
    state.sessionCreatedAt = minutesAgo(60)
    state.user = { ...SOCIAL_ONLY_USER, recoveryMode: true }

    await expect(changePassword(event, { newPassword: 'recovered-password-1' })).resolves.toEqual({
      success: true,
    })
    expect(state.passwordUpdates).toEqual(['recovered-password-1'])
  })

  it('still proves the current password for an email-provider session, however old', async () => {
    state.sessionCreatedAt = minutesAgo(60)
    state.user = { ...SOCIAL_ONLY_USER, authProviders: ['email', 'google'] }

    await expect(
      changePassword(event, { currentPassword: 'right-password', newPassword: 'next-password-1' }),
    ).resolves.toEqual({ success: true })
    expect(state.signIns).toEqual([{ email: 'parent@example.com', password: 'right-password' }])
    expect(state.passwordUpdates).toEqual(['next-password-1'])
  })
})
