import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AppSessionUser } from '../server/lib/app-auth/types'
import type { H3Event } from 'h3'

const CURRENT_SESSION_ID = vi.hoisted(() => 'sess-current')

const state = vi.hoisted(() => ({
  config: {
    authNativeClients: [] as unknown[],
    backend: 'local' as 'local' | 'supabase',
  },
  passwordHash: 'stored-hash',
  revokeCalls: [] as Array<{ exceptSessionId?: string | null; userId: string }>,
  user: null as AppSessionUser | null,
  verified: true,
}))

const revokeUserAuthSessions = vi.hoisted(() =>
  vi.fn(
    async (_event: H3Event, userId: string, options: { exceptSessionId?: string | null } = {}) => {
      state.revokeCalls.push({ userId, exceptSessionId: options.exceptSessionId })
    },
  ),
)

vi.mock('nitropack/runtime', () => ({
  useRuntimeConfig: () => ({ authNativeClients: state.config.authNativeClients }),
}))

function createQueryChain(): Record<string, unknown> {
  const chain: Record<string, unknown> = {}
  for (const method of ['delete', 'from', 'insert', 'select', 'set', 'update', 'values', 'where']) {
    chain[method] = () => chain
  }
  return chain
}

vi.mock('#layer/server/utils/database', () => ({
  executeDatabaseQuery: async () => {},
  getDatabaseRow: async () =>
    state.passwordHash
      ? {
          id: 'user-1',
          email: 'parent@example.com',
          passwordHash: state.passwordHash,
        }
      : undefined,
  useDatabase: () => createQueryChain(),
}))

vi.mock('#layer/server/utils/password', () => ({
  hashUserPassword: async (value: string) => `hashed:${value}`,
  verifyUserPassword: async () => state.verified,
}))

vi.mock('#layer/server/utils/user-session', () => ({
  replaceLayerUserSession: vi.fn(),
}))

vi.mock('../server/utils/native-auth', () => ({
  useNativeAuth: () => ({ revokeUser: vi.fn() }),
}))

vi.mock('../server/lib/app-auth/supabase-client', () => ({
  getAuthConfig: () => ({ backend: state.config.backend }),
  createSupabaseUserClient: () => ({
    signInWithPassword: async () => ({ error: null }),
  }),
  readRuntimeConfigString: (value: unknown, fallback = '') =>
    typeof value === 'string' ? value : fallback,
  toSupabaseHttpError: (error: unknown) => {
    throw error
  },
}))

vi.mock('../server/lib/app-auth/linking', () => ({
  ensureLinkedLocalUser: vi.fn(),
}))

vi.mock('../server/lib/app-auth/helpers', () => ({
  encodeQrCodeDataUrl: (value: string) => value,
}))

const clearAuthSessionRecoveryMode = vi.hoisted(() => vi.fn())

vi.mock('../server/lib/app-auth/session', () => ({
  clearAuthSessionRecoveryMode,
  commitSupabaseSessionFromClient: vi.fn(),
  getCurrentSessionUser: async () => state.user,
  getCurrentSupabaseContext: async () => ({
    client: {
      updateUser: async () => ({ data: { user: { id: 'auth-1' } }, error: null }),
    },
    localUser: { id: 'user-1' },
    authUser: { id: 'auth-1' },
    authSessionId: CURRENT_SESSION_ID,
    sessionUser: state.user,
  }),
  revokeUserAuthSessions,
}))

function event(): H3Event {
  return { context: {}, path: '/api/auth/change-password' } as H3Event
}

const SESSION_USER: AppSessionUser = {
  id: 'user-1',
  email: 'parent@example.com',
  name: 'Parent',
  isAdmin: false,
  authBackend: 'local',
  authSessionId: CURRENT_SESSION_ID,
}

describe('changePassword revokes other web sessions', () => {
  beforeEach(() => {
    state.config.backend = 'local'
    state.config.authNativeClients = []
    state.passwordHash = 'stored-hash'
    state.revokeCalls = []
    state.user = { ...SESSION_USER }
    state.verified = true
    revokeUserAuthSessions.mockClear()
    clearAuthSessionRecoveryMode.mockClear()
  })

  it('deletes other auth_sessions rows and keeps the current web session on local password change', async () => {
    const { changePassword } = await import('../server/lib/app-auth/profile')

    await expect(
      changePassword(event(), { currentPassword: 'old-password', newPassword: 'new-password-1' }),
    ).resolves.toEqual({ success: true })

    expect(revokeUserAuthSessions).toHaveBeenCalledWith(expect.anything(), 'user-1', {
      exceptSessionId: CURRENT_SESSION_ID,
    })
    expect(clearAuthSessionRecoveryMode).toHaveBeenCalledWith(expect.anything(), CURRENT_SESSION_ID)
  })

  it('deletes other auth_sessions rows after a supabase password change', async () => {
    state.config.backend = 'supabase'
    state.user = {
      ...SESSION_USER,
      authBackend: 'supabase',
      authProviders: ['email'],
      needsPasswordSetup: false,
      recoveryMode: false,
    }
    const { changePassword } = await import('../server/lib/app-auth/profile')

    await expect(
      changePassword(event(), { currentPassword: 'old-password', newPassword: 'new-password-1' }),
    ).resolves.toEqual({ success: true })

    expect(revokeUserAuthSessions).toHaveBeenCalledWith(expect.anything(), 'user-1', {
      exceptSessionId: CURRENT_SESSION_ID,
    })
    expect(clearAuthSessionRecoveryMode).toHaveBeenCalledWith(expect.anything(), CURRENT_SESSION_ID)
  })

  it('clears recovery_mode on the current row after a local password change', async () => {
    state.user = { ...SESSION_USER, recoveryMode: true }
    const { changePassword } = await import('../server/lib/app-auth/profile')

    await expect(
      changePassword(event(), { currentPassword: 'old-password', newPassword: 'new-password-1' }),
    ).resolves.toEqual({ success: true })

    expect(clearAuthSessionRecoveryMode).toHaveBeenCalledWith(expect.anything(), CURRENT_SESSION_ID)
  })
})
