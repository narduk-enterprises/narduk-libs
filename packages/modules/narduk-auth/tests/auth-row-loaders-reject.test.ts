import { describe, expect, it, vi } from 'vitest'

import { loadAuthSessionRow, loadAuthUserRow } from '../server/lib/app-auth/session'

/**
 * narduk-libs#1037 kept one keyed per-request cache for the session and user
 * row reads. Both loaders are Nitro auto-imports in apps, so a database
 * accessor that throws must still surface as a rejected promise, never a
 * synchronous throw a `.catch()` chain would miss.
 */

vi.mock('#layer/server/utils/database', () => ({
  executeDatabaseQuery: vi.fn(),
  getDatabaseRow: vi.fn(),
  useDatabase: () => {
    throw new Error('no database configured')
  },
}))

vi.mock('#layer/server/utils/user-session', () => ({
  clearLayerUserSession: vi.fn(),
  getLayerUserSession: vi.fn(),
  replaceLayerUserSession: vi.fn(),
  setLayerUserSession: vi.fn(),
}))

vi.mock('#layer/server/utils/logger', () => ({ useLogger: () => console }))

vi.mock('#narduk-auth-server/utils/auth-bridge-database', () => ({
  useAuthBridgeDatabase: () => {
    throw new Error('no auth bridge database configured')
  },
}))

function freshEvent() {
  return { context: {} } as never
}

describe('auth row loaders reject rather than throw (#1037)', () => {
  it('loadAuthSessionRow returns a rejected promise when the accessor throws', async () => {
    const event = freshEvent()
    let result: Promise<unknown> | undefined
    expect(() => {
      result = loadAuthSessionRow(event, 'sess-1')
    }).not.toThrow()
    await expect(result).rejects.toThrow('no auth bridge database configured')
  })

  it('loadAuthUserRow returns a rejected promise when the accessor throws', async () => {
    const event = freshEvent()
    let result: Promise<unknown> | undefined
    expect(() => {
      result = loadAuthUserRow(event, 'user-1')
    }).not.toThrow()
    await expect(result).rejects.toThrow('no database configured')
  })
})
