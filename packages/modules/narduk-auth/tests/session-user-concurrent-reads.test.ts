import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AppSessionUser } from '../server/lib/app-auth/types'

/**
 * narduk-libs#1397: `refreshSessionUser` proves a session from two rows, the
 * `auth_sessions` row and the `users` row, and both ids come from the unsealed
 * cookie. Neither read needs the other's answer, so both start together.
 *
 * The answers do not change: a missing session row, a missing user row and a
 * throwing read each end where they always did, whatever the other read did.
 */

const state = vi.hoisted(() => ({
  clear: vi.fn(async () => {}),
  loadSession: vi.fn(),
  loadUser: vi.fn(),
  sessionUser: null as unknown,
}))

vi.mock('#layer/server/utils/user-session', () => ({
  clearLayerUserSession: state.clear,
  replaceLayerUserSession: vi.fn(async () => {}),
}))

vi.mock('../server/lib/app-auth/session', () => ({
  getCurrentSessionUser: async () => state.sessionUser,
  getCurrentSupabaseContext: vi.fn(),
  loadAuthSessionRow: state.loadSession,
  loadAuthUserRow: state.loadUser,
  mergeAuthoritativeSessionUser: (cookie: AppSessionUser) => ({ ...cookie, merged: true }),
}))

const COOKIE_USER = {
  id: 'user-1',
  email: 'reader@example.com',
  name: 'Reader',
  isAdmin: false,
  aal: null,
  authBackend: 'local',
  authProvider: 'email',
  authProviders: ['email'],
  authSessionId: 'auth-session-1',
  needsPasswordSetup: false,
  recoveryMode: false,
} as unknown as AppSessionUser

const LIVE_SESSION_ROW = {
  id: 'auth-session-1',
  aal: null,
  recoveryMode: false,
  expiresAt: Math.floor(Date.now() / 1000) + 3600,
}
const LIVE_USER_ROW = { id: 'user-1', email: 'reader@example.com' }

interface Deferred<T> {
  promise: Promise<T>
  reject: (reason: unknown) => void
  resolve: (value: T) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, reject, resolve }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

type Refresh = (event: unknown) => Promise<AppSessionUser | null>

async function freshRefresh(): Promise<Refresh> {
  vi.resetModules()
  const module = await import('../server/utils/session-user')
  // Each call gets its own event, so the per-request memo never carries over.
  return (event) => module.useRefreshedSessionUser(event as never)
}

function freshEvent() {
  return { context: {} }
}

describe('refreshSessionUser reads the session and user rows together (#1397)', () => {
  beforeEach(() => {
    state.clear.mockClear()
    state.loadSession.mockReset()
    state.loadUser.mockReset()
    state.sessionUser = COOKIE_USER
  })

  it('issues both reads before either resolves', async () => {
    const session = deferred<unknown>()
    const user = deferred<unknown>()
    state.loadSession.mockReturnValue(session.promise)
    state.loadUser.mockReturnValue(user.promise)
    const refresh = await freshRefresh()

    const result = refresh(freshEvent())
    await tick()

    // Nothing has resolved, yet both reads are in flight.
    expect(state.loadSession).toHaveBeenCalledTimes(1)
    expect(state.loadUser).toHaveBeenCalledTimes(1)
    expect(state.loadSession).toHaveBeenCalledWith(expect.anything(), 'auth-session-1')
    expect(state.loadUser).toHaveBeenCalledWith(expect.anything(), 'user-1')

    session.resolve(LIVE_SESSION_ROW)
    user.resolve(LIVE_USER_ROW)
    await expect(result).resolves.toMatchObject({ id: 'user-1', merged: true })
    expect(state.clear).not.toHaveBeenCalled()
  })

  it('refuses a missing session row and clears the cookie, whatever the user read answers', async () => {
    for (const userRead of [
      () => Promise.resolve(LIVE_USER_ROW),
      () => Promise.resolve(null),
      () => Promise.reject(new Error('users read failed')),
    ]) {
      state.clear.mockClear()
      state.loadSession.mockResolvedValue(null)
      state.loadUser.mockImplementation(userRead)
      const refresh = await freshRefresh()

      await expect(refresh(freshEvent())).resolves.toBeNull()
      expect(state.clear).toHaveBeenCalledTimes(1)
    }
  })

  it('refuses a missing user row and clears the cookie', async () => {
    state.loadSession.mockResolvedValue(LIVE_SESSION_ROW)
    state.loadUser.mockResolvedValue(null)
    const refresh = await freshRefresh()

    await expect(refresh(freshEvent())).resolves.toBeNull()
    expect(state.clear).toHaveBeenCalledTimes(1)
  })

  it('is unauthenticated, cookie untouched, when the user read throws and the session read is fine', async () => {
    state.loadSession.mockResolvedValue(LIVE_SESSION_ROW)
    state.loadUser.mockRejectedValue(new Error('users read failed'))
    const refresh = await freshRefresh()

    await expect(refresh(freshEvent())).resolves.toBeNull()
    expect(state.clear).not.toHaveBeenCalled()
  })

  it('is unauthenticated, cookie untouched, when the session read throws', async () => {
    state.loadSession.mockRejectedValue(new Error('auth_sessions read failed'))
    state.loadUser.mockResolvedValue(LIVE_USER_ROW)
    const refresh = await freshRefresh()

    await expect(refresh(freshEvent())).resolves.toBeNull()
    expect(state.clear).not.toHaveBeenCalled()
  })

  it('refuses an expired session row and clears the cookie', async () => {
    state.loadSession.mockResolvedValue({ ...LIVE_SESSION_ROW, expiresAt: 1 })
    state.loadUser.mockResolvedValue(LIVE_USER_ROW)
    const refresh = await freshRefresh()

    await expect(refresh(freshEvent())).resolves.toBeNull()
    expect(state.clear).toHaveBeenCalledTimes(1)
  })
})
