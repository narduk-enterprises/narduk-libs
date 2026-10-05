import { beforeEach, describe, expect, it, vi } from 'vitest'

import { logoutEverywhere } from '../server/lib/app-auth/auth-flows'

import type { H3Event } from 'h3'

/**
 * narduk-libs#1043: "log out everywhere" revokes the user's native-client tokens
 * and every other `auth_sessions` row, then ends this browser's session like
 * logout. Upstream it stays app-local (#921).
 */

const CLEAR_CURRENT = vi.hoisted(() => 'clear-current')
const REVOKE_OTHERS = 'revoke:user-1:except=sess-1'

const state = vi.hoisted(() => ({
  backend: 'supabase' as 'local' | 'supabase',
  nativeClients: [] as string[],
  calls: [] as string[],
  revokeFails: false,
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
    state.calls.push(CLEAR_CURRENT)
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
    if (state.revokeFails) throw new Error('database down')
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
    state.revokeFails = false
    state.signOutCalls = []
    state.sessionUser = { id: 'user-1', authSessionId: 'sess-1' }
  })

  it('ends every other session, then this one, so no session survives', async () => {
    await expect(logoutEverywhere(event)).resolves.toEqual({ success: true })

    expect(state.calls).toEqual([REVOKE_OTHERS, CLEAR_CURRENT])
  })

  it('leaves this browser signed in to retry when a revoke fails', async () => {
    state.revokeFails = true

    await expect(logoutEverywhere(event)).rejects.toThrow('database down')
    expect(state.calls).not.toContain(CLEAR_CURRENT)
    expect(state.signOutCalls).toEqual([])
  })

  it('stays app-local upstream: never the global Supabase sign-out (#921)', async () => {
    await logoutEverywhere(event)

    expect(state.signOutCalls).toEqual([[{ scope: 'local' }]])
  })

  it('revokes native-client tokens when the app has native clients', async () => {
    state.nativeClients = ['ios']

    await logoutEverywhere(event)

    expect(state.calls).toEqual(['native:user-1', REVOKE_OTHERS, CLEAR_CURRENT])
  })

  it('works on the local backend without calling Supabase', async () => {
    state.backend = 'local'

    await logoutEverywhere(event)

    expect(state.signOutCalls).toEqual([])
    expect(state.calls).toEqual([REVOKE_OTHERS, CLEAR_CURRENT])
  })

  it('is 401 without a session, and revokes nothing', async () => {
    state.sessionUser = null

    await expect(logoutEverywhere(event)).rejects.toMatchObject({ statusCode: 401 })
    expect(state.calls).toEqual([])
  })
})
