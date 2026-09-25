import { beforeEach, describe, expect, it, vi } from 'vitest'

import { logoutUser } from '../server/lib/app-auth/auth-flows'

import type { H3Event } from 'h3'

/**
 * narduk-libs#921: `@supabase/auth-js` `signOut()` defaults to
 * `{ scope: 'global' }`, which revokes every session the user holds at the
 * shared authority — every other device, and every other app on it. Logging
 * out of this browser must end only this browser's session.
 */

const state = vi.hoisted(() => ({
  backend: 'supabase' as 'local' | 'supabase',
  signOutCalls: [] as unknown[][],
  cleared: 0,
  sessionUser: { id: 'user-1', authSessionId: 'sess-1' } as Record<string, unknown> | null,
}))

vi.mock('nitropack/runtime', () => ({
  useRuntimeConfig: () => ({ public: {} }),
}))

vi.mock('../server/lib/app-auth/session', () => ({
  clearCurrentSession: async () => {
    state.cleared += 1
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

describe('logoutUser on the Supabase backend (#921)', () => {
  beforeEach(() => {
    state.backend = 'supabase'
    state.signOutCalls = []
    state.cleared = 0
    state.sessionUser = { id: 'user-1', authSessionId: 'sess-1' }
  })

  it('revokes only this session upstream, never the global default', async () => {
    await expect(logoutUser(event)).resolves.toEqual({ success: true })

    expect(state.signOutCalls).toEqual([[{ scope: 'local' }]])
    expect(state.cleared).toBe(1)
  })

  it('does not call Supabase on the local backend', async () => {
    state.backend = 'local'

    await logoutUser(event)

    expect(state.signOutCalls).toEqual([])
    expect(state.cleared).toBe(1)
  })
})
