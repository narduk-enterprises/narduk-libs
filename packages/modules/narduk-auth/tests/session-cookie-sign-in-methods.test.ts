import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as SessionModule from '../server/lib/app-auth/session'
import type { AppSessionUser } from '../server/lib/app-auth/types'
import type { H3Event } from 'h3'

/**
 * narduk-libs#1042: a local-backend cookie carried `needsPasswordSetup` and
 * `authProviders` from sign-in and nothing refreshed them, so a password set,
 * or an Apple ID linked, from another device left this browser stale until it
 * signed in again. The real merge and the real cookie refresh run here; only
 * the session, row and cookie I/O are stubbed.
 */

const state = vi.hoisted(() => ({
  cookie: null as AppSessionUser | null,
  dbUser: null as Record<string, unknown> | null,
}))

const replaceLayerUserSession = vi.hoisted(() => vi.fn())

vi.mock('#layer/server/utils/user-session', () => ({
  clearLayerUserSession: vi.fn(),
  getLayerUserSession: vi.fn(),
  replaceLayerUserSession,
  setLayerUserSession: vi.fn(),
}))

vi.mock('#layer/server/utils/logger', () => ({ useLogger: () => console }))

vi.mock('#layer/server/utils/database', () => ({
  createAppDatabase: vi.fn(),
  executeDatabaseQuery: vi.fn(),
  getDatabaseRow: vi.fn(),
  useDatabase: vi.fn(),
}))

vi.mock('../server/lib/app-auth/session', async (importOriginal) => {
  const actual = await importOriginal<typeof SessionModule>()
  return {
    ...actual,
    getCurrentSessionUser: async () => state.cookie,
    loadAuthSessionRow: async (_event: H3Event, id: string) => ({
      id,
      aal: null,
      recoveryMode: false,
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    }),
    loadAuthUserRow: async () => state.dbUser,
  }
})

function appleOnlyCookie(overrides: Partial<AppSessionUser> = {}): AppSessionUser {
  return {
    id: 'user-1',
    email: 'parent@example.com',
    name: 'Parent',
    isAdmin: false,
    authBackend: 'local',
    authMethod: 'session',
    authProvider: 'apple',
    authProviders: ['apple'],
    authSessionId: 'sess-1',
    emailConfirmedAt: null,
    needsPasswordSetup: true,
    recoveryMode: false,
    aal: null,
    ...overrides,
  } as AppSessionUser
}

function usersRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'user-1',
    email: 'parent@example.com',
    name: 'Parent',
    isAdmin: false,
    appleId: 'apple-sub-1',
    passwordHash: null,
    ...overrides,
  }
}

async function refresh(): Promise<AppSessionUser | null> {
  const { useRefreshedSessionUser } = await import('../server/utils/session-user')
  return useRefreshedSessionUser({ context: {}, path: '/api/protected' } as H3Event)
}

describe('the local session cookie follows the users row sign-in methods (#1042)', () => {
  beforeEach(() => {
    vi.resetModules()
    replaceLayerUserSession.mockClear()
    state.cookie = appleOnlyCookie()
    state.dbUser = usersRow()
  })

  it('clears needsPasswordSetup and adds email once a password is set elsewhere', async () => {
    state.dbUser = usersRow({ passwordHash: 'hashed:secret' })

    const user = await refresh()

    expect(user).toMatchObject({ needsPasswordSetup: false, authProviders: ['apple', 'email'] })
    expect(replaceLayerUserSession).toHaveBeenCalledTimes(1)
    expect(replaceLayerUserSession).toHaveBeenCalledWith(expect.anything(), {
      user: expect.objectContaining({
        needsPasswordSetup: false,
        authProviders: ['apple', 'email'],
      }),
    })
  })

  it('adds apple once an Apple ID is linked to a password account elsewhere', async () => {
    state.cookie = appleOnlyCookie({
      authProvider: 'email',
      authProviders: ['email'],
      needsPasswordSetup: false,
    })
    state.dbUser = usersRow({ passwordHash: 'hashed:secret', appleId: 'apple-sub-1' })

    await expect(refresh()).resolves.toMatchObject({ authProviders: ['email', 'apple'] })
    expect(replaceLayerUserSession).toHaveBeenCalledTimes(1)
  })

  it('leaves the cookie alone while the users row proves nothing new', async () => {
    await expect(refresh()).resolves.toMatchObject({
      needsPasswordSetup: true,
      authProviders: ['apple'],
    })
    expect(replaceLayerUserSession).not.toHaveBeenCalled()
  })

  it('keeps a passkey sign-in provider the row cannot see', async () => {
    state.cookie = appleOnlyCookie({
      authProvider: 'passkey',
      authProviders: ['passkey', 'apple', 'email'],
      needsPasswordSetup: false,
    })
    state.dbUser = usersRow({ passwordHash: 'hashed:secret' })

    await expect(refresh()).resolves.toMatchObject({
      authProviders: ['passkey', 'apple', 'email'],
    })
    expect(replaceLayerUserSession).not.toHaveBeenCalled()
  })

  it('never derives Supabase-backend providers from the local users row', async () => {
    const { mergeAuthoritativeSessionUser } = await import('../server/lib/app-auth/session')
    const cookie = appleOnlyCookie({ authBackend: 'supabase' })

    const merged = mergeAuthoritativeSessionUser(
      cookie,
      { aal: null, recoveryMode: false },
      usersRow({ passwordHash: 'hashed:secret' }) as never,
    )

    expect(merged.authProviders).toEqual(['apple'])
    expect(merged.needsPasswordSetup).toBe(true)
  })
})
