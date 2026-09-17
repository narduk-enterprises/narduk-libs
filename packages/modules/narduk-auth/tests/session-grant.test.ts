import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AppSessionUser } from '../server/lib/app-auth/types'
import type { H3Event } from 'h3'

const state = vi.hoisted(() => ({
  clearCalls: 0,
  lookups: 0,
  lookupError: null as Error | null,
  row: null as null | {
    aal?: string | null
    expiresAt: number
    id: string
    recoveryMode?: boolean
  },
  dbUser: null as null | {
    email: string
    id: string
    isAdmin: boolean | null
    name: string | null
  },
  user: null as AppSessionUser | null,
}))

const replaceLayerUserSession = vi.hoisted(() => vi.fn())

vi.mock('#layer/server/utils/user-session', () => ({
  clearLayerUserSession: async () => {
    state.clearCalls += 1
  },
  replaceLayerUserSession,
}))

vi.mock('../server/utils/app-auth', () => ({
  getCurrentSessionUser: async () => state.user,
  getCurrentSupabaseContext: async () => {
    throw new Error('supabase refresh must not run for a deleted or local session')
  },
}))

vi.mock('../server/lib/app-auth/session', () => ({
  loadAuthSessionRow: async (_event: H3Event, authSessionId: string) => {
    state.lookups += 1
    if (state.lookupError) throw state.lookupError
    if (state.row && state.row.id === authSessionId) return state.row
    return null
  },
  loadAuthUserRow: async () => state.dbUser,
  mergeAuthoritativeSessionUser: (
    sessionUser: AppSessionUser,
    authSession: { aal?: string | null; recoveryMode?: boolean },
    dbUser: { email: string; isAdmin: boolean | null; name: string | null },
  ) => ({
    ...sessionUser,
    email: dbUser.email,
    name: dbUser.name,
    isAdmin: dbUser.isAdmin,
    recoveryMode: Boolean(authSession.recoveryMode),
    aal:
      authSession.aal === 'aal1' || authSession.aal === 'aal2' ? authSession.aal : sessionUser.aal,
  }),
}))

const recentlyValidatedAt = new Date().toISOString()
const STOLEN_SESSION_ID = 'sess-stolen'

function cookieUser(overrides: Partial<AppSessionUser> = {}): AppSessionUser {
  return {
    id: 'user-1',
    email: 'parent@example.com',
    name: 'Parent',
    isAdmin: false,
    authBackend: 'supabase',
    authSessionId: STOLEN_SESSION_ID,
    authSessionValidatedAt: recentlyValidatedAt,
    ...overrides,
  }
}

function event(): H3Event {
  return { context: {}, path: '/api/protected' } as H3Event
}

describe('web session grant validation', () => {
  beforeEach(() => {
    state.clearCalls = 0
    state.lookups = 0
    state.lookupError = null
    state.row = null
    state.dbUser = {
      id: 'user-1',
      email: 'parent@example.com',
      name: 'Parent',
      isAdmin: false,
    }
    state.user = null
    replaceLayerUserSession.mockClear()
    vi.resetModules()
  })

  it('rejects a recently-validated cookie whose auth_sessions row is gone', async () => {
    state.user = cookieUser()
    const { useRefreshedSessionUser } = await import('../server/utils/session-user')

    await expect(useRefreshedSessionUser(event())).resolves.toBeNull()
    expect(state.clearCalls).toBe(1)
  })

  it('rejects a cookie that does not point at an auth_sessions row', async () => {
    state.user = cookieUser({ authSessionId: null, authBackend: 'local' })
    const { useRefreshedSessionUser } = await import('../server/utils/session-user')

    await expect(useRefreshedSessionUser(event())).resolves.toBeNull()
    expect(state.clearCalls).toBe(1)
  })

  it('prefers the users row isAdmin over a stale cookie', async () => {
    state.user = cookieUser({ authBackend: 'local', isAdmin: true })
    state.row = { id: STOLEN_SESSION_ID, expiresAt: Math.floor(Date.now() / 1000) + 3600 }
    state.dbUser = {
      id: 'user-1',
      email: 'parent@example.com',
      name: 'Parent',
      isAdmin: false,
    }
    const { useRefreshedSessionUser } = await import('../server/utils/session-user')

    await expect(useRefreshedSessionUser(event())).resolves.toMatchObject({
      id: 'user-1',
      isAdmin: false,
    })
  })

  it('writes the merged local principal back so /api/_auth/session drops isAdmin', async () => {
    state.user = cookieUser({ authBackend: 'local', isAdmin: true })
    state.row = { id: STOLEN_SESSION_ID, expiresAt: Math.floor(Date.now() / 1000) + 3600 }
    state.dbUser = {
      id: 'user-1',
      email: 'parent@example.com',
      name: 'Parent',
      isAdmin: false,
    }
    const { useRefreshedSessionUser } = await import('../server/utils/session-user')

    await useRefreshedSessionUser(event())

    expect(replaceLayerUserSession).toHaveBeenCalledWith(expect.anything(), {
      user: expect.objectContaining({ id: 'user-1', isAdmin: false }),
    })
  })

  it('rejects a cookie whose users row is gone', async () => {
    state.user = cookieUser({ authBackend: 'local', isAdmin: true })
    state.row = { id: STOLEN_SESSION_ID, expiresAt: Math.floor(Date.now() / 1000) + 3600 }
    state.dbUser = null
    const { useRefreshedSessionUser } = await import('../server/utils/session-user')

    await expect(useRefreshedSessionUser(event())).resolves.toBeNull()
    expect(state.clearCalls).toBe(1)
  })

  it('accepts a live local session without refreshing Supabase', async () => {
    state.user = cookieUser({ authBackend: 'local' })
    state.row = { id: STOLEN_SESSION_ID, expiresAt: Math.floor(Date.now() / 1000) + 3600 }
    const { useRefreshedSessionUser } = await import('../server/utils/session-user')

    await expect(useRefreshedSessionUser(event())).resolves.toMatchObject({
      id: 'user-1',
      authSessionId: STOLEN_SESSION_ID,
    })
    expect(state.clearCalls).toBe(0)
  })

  it('maps a missing row through the core grant validator as invalid', async () => {
    state.user = cookieUser()
    const { validateRegisteredAuthSessionGrant } =
      await import('../server/utils/session-grant-validator')

    await expect(validateRegisteredAuthSessionGrant(event(), state.user)).resolves.toEqual({
      status: 'invalid',
    })
  })

  it('treats a throwing session lookup as invalid and does not clear the cookie', async () => {
    state.user = cookieUser()
    state.lookupError = new Error('D1 unavailable')
    const { useRefreshedSessionUser } = await import('../server/utils/session-user')
    const { validateRegisteredAuthSessionGrant } =
      await import('../server/utils/session-grant-validator')
    const request = event()

    await expect(useRefreshedSessionUser(request)).resolves.toBeNull()
    expect(state.clearCalls).toBe(0)
    await expect(validateRegisteredAuthSessionGrant(event(), state.user)).resolves.toEqual({
      status: 'invalid',
    })
    expect(state.clearCalls).toBe(0)
  })

  it('hits D1 at most once per request for the same session', async () => {
    state.user = cookieUser({ authBackend: 'local' })
    state.row = { id: STOLEN_SESSION_ID, expiresAt: Math.floor(Date.now() / 1000) + 3600 }
    const { useRefreshedSessionUser } = await import('../server/utils/session-user')
    const request = event()

    await useRefreshedSessionUser(request)
    await useRefreshedSessionUser(request)
    expect(state.lookups).toBe(1)
    expect(state.clearCalls).toBe(0)
  })
})

describe('auth-session-refresh coverage', () => {
  it('refreshes admin and auth/me, skips public login, and covers other API routes', async () => {
    const { shouldRevalidateAuthSession } =
      await import('../server/utils/auth-session-refresh-path')

    expect(shouldRevalidateAuthSession('/api/admin/users')).toBe(true)
    expect(shouldRevalidateAuthSession('/api/auth/me')).toBe(true)
    expect(shouldRevalidateAuthSession('/api/notifications')).toBe(true)
    expect(shouldRevalidateAuthSession('/dashboard')).toBe(true)
    expect(shouldRevalidateAuthSession('/api/auth/login')).toBe(false)
    expect(shouldRevalidateAuthSession('/_nuxt/builds/meta.json')).toBe(false)
    expect(shouldRevalidateAuthSession('/_ipx/s_32x32/logo.png')).toBe(false)
    expect(shouldRevalidateAuthSession('/favicon.ico')).toBe(false)
    expect(shouldRevalidateAuthSession('/robots.txt')).toBe(false)
    expect(shouldRevalidateAuthSession('/sitemap.xml')).toBe(false)
    expect(shouldRevalidateAuthSession('/_og/card')).toBe(false)
    expect(shouldRevalidateAuthSession('/__nuxt_error')).toBe(false)
  })
})
