import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const useRefreshedSessionUser = vi.hoisted(() => vi.fn(async () => null))

const getCurrentSessionUser = vi.hoisted(() => vi.fn(async (): Promise<unknown> => null))

vi.mock('#narduk-auth-server/utils/session-user', () => ({
  useRefreshedSessionUser,
}))

vi.mock('#narduk-auth-server/lib/app-auth/session', () => ({
  getCurrentSessionUser,
}))

describe('auth-session-refresh middleware', () => {
  let handler: (event: { method?: string; path: string }) => Promise<unknown>

  beforeEach(async () => {
    vi.resetModules()
    useRefreshedSessionUser.mockReset()
    useRefreshedSessionUser.mockResolvedValue(null)
    getCurrentSessionUser.mockReset()
    getCurrentSessionUser.mockResolvedValue(null)
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
      getCurrentSessionUser.mockResolvedValue(COOKIE_USER)
      await expect(handler(SESSION_READ)).resolves.toEqual({})
      await expect(handler({ ...SESSION_READ, path: '/api/_auth/session?x=1' })).resolves.toEqual(
        {},
      )
    })

    it('answers the trailing-slash spelling Nitro routes to the same handler', async () => {
      getCurrentSessionUser.mockResolvedValue(COOKIE_USER)
      await expect(handler({ ...SESSION_READ, path: '/api/_auth/session/' })).resolves.toEqual({})
      await expect(handler({ ...SESSION_READ, path: '/api/_auth/session/?x=1' })).resolves.toEqual(
        {},
      )
    })

    it('answers an empty session when the grant lookup throws', async () => {
      getCurrentSessionUser.mockResolvedValue(COOKIE_USER)
      useRefreshedSessionUser.mockRejectedValueOnce(new Error('D1 unavailable'))
      await expect(handler(SESSION_READ)).resolves.toEqual({})
    })

    it('leaves a live session, and a cookie with no user, to nuxt-auth-utils', async () => {
      useRefreshedSessionUser.mockResolvedValue(COOKIE_USER as never)
      await expect(handler(SESSION_READ)).resolves.toBeUndefined()

      useRefreshedSessionUser.mockResolvedValue(null)
      getCurrentSessionUser.mockResolvedValue(null)
      await expect(handler(SESSION_READ)).resolves.toBeUndefined()
    })

    it('leaves sign-out and every other path alone', async () => {
      getCurrentSessionUser.mockResolvedValue(COOKIE_USER)
      await expect(
        handler({ method: 'DELETE', path: '/api/_auth/session' }),
      ).resolves.toBeUndefined()
      await expect(handler({ method: 'GET', path: '/api/notifications' })).resolves.toBeUndefined()
    })
  })
})
