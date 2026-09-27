import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const useRefreshedSessionUser = vi.hoisted(() => vi.fn(async () => null))

/** A readable session cookie that carries no user, unless a test says otherwise. */
const READABLE_NO_USER = { id: 'session-1' }

const peekLayerUserSession = vi.hoisted(() =>
  vi.fn(async (): Promise<null | Record<string, unknown>> => null),
)

const getLayerUserSession = vi.hoisted(() => vi.fn(async () => ({ id: 'fresh-session' })))

const hasLayerUserSession = vi.hoisted(() => vi.fn(() => true))

vi.mock('#layer/server/utils/user-session', () => ({
  getLayerUserSession,
  hasLayerUserSession,
  peekLayerUserSession,
}))

vi.mock('#narduk-auth-server/utils/session-user', () => ({
  useRefreshedSessionUser,
}))

describe('auth-session-refresh middleware', () => {
  let handler: (event: { method?: string; path: string }) => Promise<unknown>

  beforeEach(async () => {
    vi.resetModules()
    useRefreshedSessionUser.mockReset()
    useRefreshedSessionUser.mockResolvedValue(null)
    peekLayerUserSession.mockReset()
    peekLayerUserSession.mockResolvedValue(READABLE_NO_USER)
    getLayerUserSession.mockClear()
    hasLayerUserSession.mockReset()
    hasLayerUserSession.mockReturnValue(true)
    vi.stubGlobal('defineEventHandler', (fn: (event: { path: string }) => Promise<unknown>) => fn)
    const loaded = await import('../server/middleware/auth-session-refresh')
    handler = loaded.default
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('refreshes shared auth state before admin API reads', async () => {
    await handler({ path: '/api/admin/users' })
    expect(useRefreshedSessionUser).toHaveBeenCalledTimes(1)
  })

  it('refreshes shared auth state before auth/me reads', async () => {
    await handler({ path: '/api/auth/me' })
    expect(useRefreshedSessionUser).toHaveBeenCalledTimes(1)
  })

  it('skips public login so narduk-testkit still sees the same skip', async () => {
    await handler({ path: '/api/auth/login' })
    expect(useRefreshedSessionUser).not.toHaveBeenCalled()
  })

  it('skips common static asset prefixes', async () => {
    await handler({ path: '/_nuxt/builds/meta.json' })
    await handler({ path: '/favicon.ico' })
    await handler({ path: '/robots.txt' })
    expect(useRefreshedSessionUser).not.toHaveBeenCalled()
  })

  it('still refreshes page SSR and other API routes', async () => {
    await handler({ path: '/dashboard' })
    await handler({ path: '/api/notifications' })
    expect(useRefreshedSessionUser).toHaveBeenCalledTimes(2)
  })

  // narduk-libs#1214: with no session cookie there is nothing to revalidate,
  // and reading one through h3's useSession would set a new cookie.
  it('skips a request that carries no session', async () => {
    hasLayerUserSession.mockReturnValue(false)
    await expect(handler({ path: '/' })).resolves.toBeUndefined()
    await expect(handler({ path: '/api/admin/users' })).resolves.toBeUndefined()
    expect(useRefreshedSessionUser).not.toHaveBeenCalled()
    expect(peekLayerUserSession).not.toHaveBeenCalled()
    expect(getLayerUserSession).not.toHaveBeenCalled()
  })

  it('answers the client session read as signed out when there is no session', async () => {
    hasLayerUserSession.mockReturnValue(false)
    await expect(handler({ method: 'GET', path: '/api/_auth/session' })).resolves.toEqual({})
    await expect(handler({ method: 'DELETE', path: '/api/_auth/session' })).resolves.toBeUndefined()
    expect(useRefreshedSessionUser).not.toHaveBeenCalled()
  })

  it('does not 500 when session refresh throws; the request proceeds unauthenticated', async () => {
    useRefreshedSessionUser.mockRejectedValueOnce(new Error('D1 unavailable'))
    await expect(handler({ path: '/dashboard' })).resolves.toBeUndefined()
    expect(useRefreshedSessionUser).toHaveBeenCalledTimes(1)
  })

  // narduk-libs#1041: nuxt-auth-utils serves `GET /api/_auth/session` from the
  // sealed cookie. Clearing the session does not stop it: h3 re-reads the
  // request's cookie, so a revoked session still answered with its user.
  describe('GET /api/_auth/session', () => {
    const SESSION_READ = { method: 'GET', path: '/api/_auth/session' }
    const COOKIE_USER = { id: 'user-1', email: 'parent@example.com' }

    it('answers an empty session for a cookie whose grant is revoked', async () => {
      peekLayerUserSession.mockResolvedValue({ id: 'session-1', user: COOKIE_USER })
      await expect(handler(SESSION_READ)).resolves.toEqual({})
      await expect(handler({ ...SESSION_READ, path: '/api/_auth/session?x=1' })).resolves.toEqual(
        {},
      )
    })

    it('answers the trailing-slash spelling Nitro routes to the same handler', async () => {
      peekLayerUserSession.mockResolvedValue({ id: 'session-1', user: COOKIE_USER })
      await expect(handler({ ...SESSION_READ, path: '/api/_auth/session/' })).resolves.toEqual({})
      await expect(handler({ ...SESSION_READ, path: '/api/_auth/session/?x=1' })).resolves.toEqual(
        {},
      )
    })

    it('answers an empty session when the grant lookup throws', async () => {
      peekLayerUserSession.mockResolvedValue({ id: 'session-1', user: COOKIE_USER })
      useRefreshedSessionUser.mockRejectedValueOnce(new Error('D1 unavailable'))
      await expect(handler(SESSION_READ)).resolves.toEqual({})
    })

    it('leaves a live session, and a cookie with no user, to nuxt-auth-utils', async () => {
      useRefreshedSessionUser.mockResolvedValue(COOKIE_USER as never)
      await expect(handler(SESSION_READ)).resolves.toBeUndefined()

      useRefreshedSessionUser.mockResolvedValue(null)
      peekLayerUserSession.mockResolvedValue(READABLE_NO_USER)
      await expect(handler(SESSION_READ)).resolves.toBeUndefined()
    })

    // narduk-libs#1214: a cookie core cannot unseal (tampered, a rotated
    // password, past maxAge) is replaced with a fresh empty session, so
    // nuxt-auth-utils cannot unseal it on its own later in the request.
    it('answers an empty session for a cookie that does not unseal, and replaces it', async () => {
      peekLayerUserSession.mockResolvedValue(null)
      await expect(handler(SESSION_READ)).resolves.toEqual({})
      expect(getLayerUserSession).toHaveBeenCalledTimes(1)
    })

    it('replaces an unreadable cookie on every other path too', async () => {
      peekLayerUserSession.mockResolvedValue(null)
      await expect(handler({ method: 'GET', path: '/dashboard' })).resolves.toBeUndefined()
      expect(getLayerUserSession).toHaveBeenCalledTimes(1)
    })

    it('does not touch a readable cookie', async () => {
      await handler(SESSION_READ)
      peekLayerUserSession.mockResolvedValue({ id: 'session-1', user: COOKIE_USER })
      await handler({ method: 'GET', path: '/dashboard' })
      expect(getLayerUserSession).not.toHaveBeenCalled()
    })

    it('leaves sign-out and every other path alone', async () => {
      peekLayerUserSession.mockResolvedValue({ id: 'session-1', user: COOKIE_USER })
      await expect(
        handler({ method: 'DELETE', path: '/api/_auth/session' }),
      ).resolves.toBeUndefined()
      await expect(handler({ method: 'GET', path: '/api/notifications' })).resolves.toBeUndefined()
    })
  })
})
