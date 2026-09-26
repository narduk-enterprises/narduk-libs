import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getCurrentSupabaseContext } from '../server/lib/app-auth/session'

/**
 * narduk-libs#1043: `getCurrentSupabaseContext` is the one caller that reaches
 * a Supabase refresh without the read paths' expiry check. A refresh rewrites
 * the row's expiry, so without its own check it would revive an expired
 * session. This runs the real `session.ts` and its row loader; only the
 * database read is stubbed.
 */

const state = vi.hoisted(() => ({ clearCalls: 0, row: null as null | Record<string, unknown> }))
const createSupabaseUserClient = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error('refresh reached')
  }),
)

vi.mock('#layer/server/utils/user-session', () => ({
  clearLayerUserSession: async () => {
    state.clearCalls += 1
  },
  getLayerUserSession: async () => ({
    user: { id: 'user-1', authSessionId: 'sess-1', authBackend: 'supabase' },
  }),
  replaceLayerUserSession: vi.fn(),
  setLayerUserSession: vi.fn(),
}))

vi.mock('#layer/server/utils/logger', () => ({ useLogger: () => console }))

vi.mock('#layer/server/utils/database', () => ({
  executeDatabaseQuery: vi.fn(),
  getDatabaseRow: async () => state.row,
  useDatabase: () => ({}),
}))

const selectChain = { from: () => ({ where: () => ({}) }) }
vi.mock('#narduk-auth-server/utils/auth-bridge-database', () => ({
  useAuthBridgeDatabase: () => ({ select: () => selectChain }),
}))

vi.mock('../server/lib/app-auth/supabase-client', () => ({ createSupabaseUserClient }))

function eventWithRow(expiresAt: number) {
  state.row = { id: 'sess-1', userId: 'user-1', expiresAt }
  return { context: {} } as never
}

const nowSeconds = () => Math.floor(Date.now() / 1000)

describe('getCurrentSupabaseContext enforces the row expiry (#1043)', () => {
  beforeEach(() => {
    state.clearCalls = 0
    createSupabaseUserClient.mockClear()
  })

  it('refuses an expired row with a 401 and clears the cookie, without refreshing', async () => {
    await expect(getCurrentSupabaseContext(eventWithRow(nowSeconds() - 1))).rejects.toMatchObject({
      statusCode: 401,
    })
    expect(state.clearCalls).toBe(1)
    expect(createSupabaseUserClient).not.toHaveBeenCalled()
  })

  it('still reaches the refresh for a live row', async () => {
    await expect(getCurrentSupabaseContext(eventWithRow(nowSeconds() + 3600))).rejects.toThrow(
      'refresh reached',
    )
    expect(state.clearCalls).toBe(0)
    expect(createSupabaseUserClient).toHaveBeenCalledTimes(1)
  })
})
