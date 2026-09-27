import {
  createApp,
  createRouter,
  eventHandler,
  readBody,
  toWebHandler,
  useSession,
  type H3Event,
} from 'h3'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { resolveSessionConfig } from '#layer/server/utils/user-session'

import sessionRefreshMiddleware from '../server/middleware/auth-session-refresh'
import {
  loadAuthSessionRow,
  loadAuthUserRow,
  setCurrentSessionUser,
} from '../server/lib/app-auth/session'
import { useRefreshedSessionUser } from '../server/utils/session-user'

import type { AppSessionUser } from '../server/lib/app-auth/types'

/**
 * narduk-libs#1214: the global session-refresh middleware ran h3's
 * `useSession` on every request, and h3 seals and sets a new cookie when the
 * request carries none. So every anonymous page and 404 got a 30-day
 * `nuxt-session` cookie.
 *
 * Nothing here mocks the session: the middleware, narduk-core's
 * `user-session` helpers and h3's `useSession` run for real against a real
 * h3 app. Only the `auth_sessions` and `users` row reads are stubbed, since
 * they stand for D1.
 */

vi.mock('../server/lib/app-auth/session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../server/lib/app-auth/session')>()),
  loadAuthSessionRow: vi.fn(),
  loadAuthUserRow: vi.fn(),
}))

const SESSION_COOKIE = 'nuxt-session'
const PASSWORD = 'narduk-libs-1214-session-password-at-least-32-chars'

const USER: AppSessionUser = {
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
}

const LIVE_SESSION_ROW = {
  id: USER.authSessionId,
  aal: null,
  recoveryMode: false,
  expiresAt: Math.floor(Date.now() / 1000) + 3600,
}

const LIVE_USER_ROW = {
  id: USER.id,
  email: USER.email,
  name: USER.name,
  isAdmin: false,
  appleId: null,
  passwordHash: 'hash',
}

/**
 * Stands in for nuxt-auth-utils' `GET /api/_auth/session`
 * (`runtime/server/api/session.get.js`): it reads the session through h3's
 * `useSession` with the same config, so an anonymous call reaching it writes
 * a cookie exactly as the real handler does.
 */
const nuxtAuthUtilsSessionRead = eventHandler(async (event: H3Event) => {
  const session = await useSession(event, resolveSessionConfig(event))
  const { secure: _secure, ...data } = { ...session.data, id: session.id }
  return data
})

function buildApp() {
  const app = createApp()
  app.use(sessionRefreshMiddleware)
  const router = createRouter()
  router.get(
    '/',
    eventHandler(async (event) => {
      const user = await useRefreshedSessionUser(event)
      return { page: 'home', user: user?.email ?? null }
    }),
  )
  router.get('/api/_auth/session', nuxtAuthUtilsSessionRead)
  router.post(
    '/test/login',
    eventHandler(async (event) => {
      await setCurrentSessionUser(event, (await readBody(event)) as AppSessionUser)
      return { ok: true }
    }),
  )
  app.use(router)
  return toWebHandler(app)
}

const handler = buildApp()

function request(path: string, init: RequestInit = {}) {
  return handler(new Request(`http://app.test${path}`, init))
}

function sessionSetCookies(response: Response): string[] {
  return response.headers.getSetCookie().filter((cookie) => cookie.startsWith(`${SESSION_COOKIE}=`))
}

async function signIn(): Promise<string> {
  const response = await request('/test/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(USER),
  })
  const [cookie] = sessionSetCookies(response)
  expect(cookie, 'sign-in sets the session cookie').toBeTruthy()
  return cookie!.split(';')[0]!
}

const previousPassword = process.env.NUXT_SESSION_PASSWORD

beforeAll(() => {
  process.env.NUXT_SESSION_PASSWORD = PASSWORD
})

afterAll(() => {
  if (previousPassword === undefined) delete process.env.NUXT_SESSION_PASSWORD
  else process.env.NUXT_SESSION_PASSWORD = previousPassword
})

beforeEach(() => {
  vi.mocked(loadAuthSessionRow).mockReset()
  vi.mocked(loadAuthUserRow).mockReset()
  vi.mocked(loadAuthSessionRow).mockResolvedValue(LIVE_SESSION_ROW as never)
  vi.mocked(loadAuthUserRow).mockResolvedValue(LIVE_USER_ROW as never)
})

describe('auth-session-refresh with the real h3 session (#1214)', () => {
  describe('an anonymous request', () => {
    it('gets no session cookie on a page', async () => {
      const response = await request('/')
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ page: 'home', user: null })
      expect(sessionSetCookies(response)).toEqual([])
    })

    it('gets no session cookie on a 404', async () => {
      const response = await request('/no-such-page')
      expect(response.status).toBe(404)
      expect(sessionSetCookies(response)).toEqual([])
    })

    it('gets no session cookie from the session read the client calls on load', async () => {
      const response = await request('/api/_auth/session', {
        headers: { accept: 'application/json' },
      })
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({})
      expect(sessionSetCookies(response)).toEqual([])
    })

    it('never reaches the grant store', async () => {
      await request('/')
      await request('/no-such-page')
      expect(loadAuthSessionRow).not.toHaveBeenCalled()
    })
  })

  describe('a request carrying a live session', () => {
    it('is revalidated against the grant store and stays signed in', async () => {
      const cookie = await signIn()

      const response = await request('/', { headers: { cookie } })
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ page: 'home', user: USER.email })
      expect(loadAuthSessionRow).toHaveBeenCalledWith(expect.anything(), USER.authSessionId)
      expect(loadAuthUserRow).toHaveBeenCalledWith(expect.anything(), USER.id)
      // Nothing surfaced changed, so the cookie is not rewritten.
      expect(sessionSetCookies(response)).toEqual([])
    })

    it('is revalidated when it arrives in the h3 session header', async () => {
      const cookie = await signIn()
      const sealed = cookie.slice(`${SESSION_COOKIE}=`.length)

      const response = await request('/', { headers: { 'x-nuxt-session-session': sealed } })
      expect(await response.json()).toEqual({ page: 'home', user: USER.email })
      expect(loadAuthSessionRow).toHaveBeenCalledWith(expect.anything(), USER.authSessionId)
    })
  })

  describe('a request carrying a revoked session (#442)', () => {
    it('is rejected and the cookie is cleared', async () => {
      const cookie = await signIn()
      vi.mocked(loadAuthSessionRow).mockResolvedValue(null)

      const response = await request('/', { headers: { cookie } })
      expect(await response.json()).toEqual({ page: 'home', user: null })
      const cleared = sessionSetCookies(response)
      expect(cleared).toHaveLength(1)
      expect(cleared[0]).toMatch(new RegExp(`^${SESSION_COOKIE}=;`))
    })

    it('is answered as signed out by the client session read', async () => {
      const cookie = await signIn()
      vi.mocked(loadAuthSessionRow).mockResolvedValue(null)

      const response = await request('/api/_auth/session', { headers: { cookie } })
      expect(await response.json()).toEqual({})
    })
  })
})
