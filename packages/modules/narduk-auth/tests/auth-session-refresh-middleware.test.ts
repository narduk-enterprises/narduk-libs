import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const useRefreshedSessionUser = vi.hoisted(() => vi.fn(async () => null))

vi.mock('#narduk-auth-server/utils/session-user', () => ({
  useRefreshedSessionUser,
}))

describe('auth-session-refresh middleware', () => {
  let handler: (event: { path: string }) => Promise<void>

  beforeEach(async () => {
    vi.resetModules()
    useRefreshedSessionUser.mockClear()
    vi.stubGlobal('defineEventHandler', (fn: (event: { path: string }) => Promise<void>) => fn)
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
})
