import { beforeEach, describe, expect, it, vi } from 'vitest'

import { logoutEverywhere } from '../server/lib/app-auth/auth-flows'

import type { H3Event } from 'h3'

/**
 * narduk-libs#1043: "log out everywhere" ends this browser's session like
 * logout, then deletes every other `auth_sessions` row the user holds and
 * revokes their native-client tokens. Upstream it stays app-local (#921).
 */

const state = vi.hoisted(() => ({
  backend: 'supabase' as 'local' | 'supabase',
  nativeClients: [] as string[],
  calls: [] as string[],
  signOutCalls: [] as unknown[][],
  sessionUser: { id: 'user-1', authSessionId: 'sess-1' } as Record<string, unknown> | null,
}))

vi.mock('nitropack/runtime', () => ({
  useRuntimeConfig: () => ({ public: {}, authNativeClients: state.nativeClients }),
}))

vi.mock('../server/utils/native-auth', () => ({
  useNativeAuth: () => ({
    revokeUser: async (userId: string) => {
      state.calls.push(`native:${userId}`)
    },
  }),
}))

vi.mock('../server/lib/app-auth/session', () => ({
  clearCurrentSession: async () => {
    state.calls.push('clear-current')
  },
  establishLocalSessionUser: vi.fn(),
  getCurrentSessionUser: async () => state.sessionUser,
  getCurrentSupabaseContext: async () => ({
    client: {
      signOut: async (...args: unknown[]) => {
        state.signOutCalls.push(args)
        return { error: null }
      },
    },
  }),
  persistSupabaseSession: vi.fn(),
  revokeUserAuthSessions: async (
    _event: H3Event,
    userId: string,
    options: { exceptSessionId?: string | null } = {},
  ) => {
    state.calls.push(`revoke:${userId}:except=${options.exceptSessionId ?? 'none'}`)
  },
  setCurrentSessionUser: vi.fn(),
}))

vi.mock('../server/lib/app-auth/supabase-client', () => ({
  createSupabaseClient: vi.fn(),
  createSupabaseUserClient: vi.fn(),
  getAuthConfig: () => ({ backend: state.backend }),
  isSupabaseConfigured: () => true,
  toSupabaseHttpError: (error: unknown) => {
    throw error
  },
}))

const event = {} as H3Event

describe('logoutEverywhere (#1043)', () => {
  beforeEach(() => {
    state.backend = 'supabase'
    state.nativeClients = []
    state.calls = []
    state.signOutCalls = []
    state.sessionUser = { id: 'user-1', authSessionId: 'sess-1' }
  })

  it('ends this session, then every session the user holds, keeping none', async () => {
    await expect(logoutEverywhere(event)).resolves.toEqual({ success: true })

    expect(state.calls).toEqual(['clear-current', 'revoke:user-1:except=none'])
  })

  it('stays app-local upstream: never the global Supabase sign-out (#921)', async () => {
    await logoutEverywhere(event)

    expect(state.signOutCalls).toEqual([[{ scope: 'local' }]])
  })

  it('revokes native-client tokens when the app has native clients', async () => {
    state.nativeClients = ['ios']

    await logoutEverywhere(event)

    expect(state.calls).toEqual(['clear-current', 'native:user-1', 'revoke:user-1:except=none'])
  })

  it('works on the local backend without calling Supabase', async () => {
    state.backend = 'local'

    await logoutEverywhere(event)

    expect(state.signOutCalls).toEqual([])
    expect(state.calls).toEqual(['clear-current', 'revoke:user-1:except=none'])
  })

  it('is 401 without a session, and revokes nothing', async () => {
    state.sessionUser = null

    await expect(logoutEverywhere(event)).rejects.toMatchObject({ statusCode: 401 })
    expect(state.calls).toEqual([])
  })
})
