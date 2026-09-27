import { defu } from 'defu'
import { createApp, createRouter, eventHandler, readBody, toWebHandler, useSession } from 'h3'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { sessionRuntimeConfigSeed } from '../../narduk-core/src/auth-utils-install'
import {
  loadAuthSessionRow,
  loadAuthUserRow,
  setCurrentSessionUser,
} from '../server/lib/app-auth/session'
import sessionRefreshMiddleware from '../server/middleware/auth-session-refresh'
import { useRefreshedSessionUser } from '../server/utils/session-user'

import type * as NitroRuntimeStub from './stubs/nitropack-runtime'
import type * as SessionModule from '../server/lib/app-auth/session'
import type { AppSessionUser } from '../server/lib/app-auth/types'
import type { H3Event } from 'h3'

/**
 * narduk-libs#1214: the global session-refresh middleware ran h3's
 * `useSession` on every request, and h3 seals and sets a new cookie when the
 * request carries none. So every anonymous page and 404 got a 30-day
 * `nuxt-session` cookie.
 *
 * Nothing here mocks the session: the middleware, narduk-core's
 * `user-session` helpers and h3's `useSession` run for real against a real
 * h3 app. Only the `auth_sessions` and `users` row reads are stubbed, since
 * they stand for D1, and `runtimeConfig.session` is set per test the way the
 * two modules build it.
 */

const runtime = vi.hoisted(() => ({ session: {} as Record<string, unknown> }))

vi.mock('nitropack/runtime', async (importOriginal) => {
  const stub = await importOriginal<typeof NitroRuntimeStub>()
  return {
    ...stub,
    useRuntimeConfig: () => ({ ...stub.useRuntimeConfig(), session: runtime.session }),
  }
})

vi.mock('../server/lib/app-auth/session', async (importOriginal) => ({
  ...(await importOriginal<typeof SessionModule>()),
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

function liveSessionRow() {
  return {
    id: USER.authSessionId,
    aal: null,
    recoveryMode: false,
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
  }
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
 * `runtimeConfig.session` as nuxt-auth-utils 0.5.29's module builds it
 * (`defu(runtimeConfig.session, { name: 'nuxt-session', password: '', cookie:
 * { sameSite: 'lax' } })`), before core adds its seed. No `maxAge`.
 */
const NUXT_AUTH_UTILS_SESSION_DEFAULTS = {
  name: 'nuxt-session',
  password: '',
  cookie: { sameSite: 'lax' },
}

/** What an app gets: nuxt-auth-utils' defaults, then core's seed (`src/module.ts`). */
function installedSessionRuntimeConfig(appSession: Record<string, unknown> = {}) {
  return defu(
    defu(appSession, NUXT_AUTH_UTILS_SESSION_DEFAULTS),
    sessionRuntimeConfigSeed(undefined, {}).session,
  ) as Record<string, unknown>
}

/**
 * nuxt-auth-utils 0.5.29's `_useSession` config:
 * `defu({ password: process.env.NUXT_SESSION_PASSWORD }, runtimeConfig.session)`.
 * Its own read, not core's, so a disagreement between the two shows here.
 */
function nuxtAuthUtilsSessionConfig() {
  return defu({ password: process.env.NUXT_SESSION_PASSWORD }, runtime.session) as never
}

/** nuxt-auth-utils' `getUserSession`, which app routes may call directly. */
async function nuxtAuthUtilsGetUserSession(event: H3Event) {
  const session = await useSession(event, nuxtAuthUtilsSessionConfig())
  return { ...session.data, id: session.id } as Record<string, unknown>
}

/**
 * nuxt-auth-utils' `GET /api/_auth/session` (`runtime/server/api/session.get.js`):
 * an anonymous call that reaches it writes a cookie, as the real handler does.
 */
const nuxtAuthUtilsSessionRead = eventHandler(async (event: H3Event) => {
  const { secure: _secure, ...data } = await nuxtAuthUtilsGetUserSession(event)
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
  router.get(
    '/api/app-route',
    eventHandler(async (event) => {
      const session = await nuxtAuthUtilsGetUserSession(event)
      return { user: (session.user as AppSessionUser | undefined)?.email ?? null }
    }),
  )
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

function sessionSetCookies(response: Response, name = SESSION_COOKIE): string[] {
  return response.headers.getSetCookie().filter((cookie) => cookie.startsWith(`${name}=`))
}

async function signIn(name = SESSION_COOKIE): Promise<string> {
  const response = await request('/test/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(USER),
  })
  const [cookie] = sessionSetCookies(response, name)
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
  runtime.session = installedSessionRuntimeConfig()
  vi.mocked(loadAuthSessionRow).mockReset()
  vi.mocked(loadAuthUserRow).mockReset()
  vi.mocked(loadAuthSessionRow).mockImplementation(async () => liveSessionRow() as never)
  vi.mocked(loadAuthUserRow).mockResolvedValue(LIVE_USER_ROW as never)
})

afterEach(() => {
  vi.useRealTimers()
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

  // The verifier's probe on PR #1215: core refuses a cookie older than its
  // 30-day maxAge, but a re-seal keeps `createdAt` and extends the seal. When
  // nuxt-auth-utils read with no maxAge it still accepted the cookie and
  // served its user, although the grant was revoked and never consulted.
  describe('a replayed cookie past maxAge whose grant is revoked (#1214)', () => {
    const DAY_MS = 24 * 60 * 60 * 1000
    const T0 = Date.UTC(2026, 0, 1)

    async function replayedCookie(): Promise<string> {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(T0)
      const signedIn = await signIn()

      // Day 20: a surfaced field changed, so the refresh re-seals the cookie.
      // `createdAt` stays day 0; the seal's own expiry moves to day 50.
      vi.setSystemTime(T0 + 20 * DAY_MS)
      vi.mocked(loadAuthUserRow).mockResolvedValue({
        ...LIVE_USER_ROW,
        name: 'Reader Renamed',
      } as never)
      const day20 = await request('/', { headers: { cookie: signedIn } })
      expect(await day20.json()).toEqual({ page: 'home', user: USER.email })
      const resealed = sessionSetCookies(day20).filter(
        (cookie) => !cookie.startsWith(`${SESSION_COOKIE}=;`),
      )
      expect(resealed).toHaveLength(1)

      // Day 35: past the 30-day maxAge, and the grant is revoked.
      vi.setSystemTime(T0 + 35 * DAY_MS)
      vi.mocked(loadAuthSessionRow).mockResolvedValue(null)
      return resealed[0]!.split(';')[0]!
    }

    async function expectSignedOut(cookie: string) {
      const sessionRead = await request('/api/_auth/session', { headers: { cookie } })
      expect((await sessionRead.json()).user).toBeUndefined()

      const appRoute = await request('/api/app-route', { headers: { cookie } })
      expect(await appRoute.json()).toEqual({ user: null })
      // The unreadable cookie is replaced with an empty session. That write is
      // allowed: the request carried a cookie.
      const [replacement] = sessionSetCookies(appRoute)
      expect(replacement).toBeTruthy()
      const next = await request('/api/app-route', {
        headers: { cookie: replacement!.split(';')[0]! },
      })
      expect(await next.json()).toEqual({ user: null })
    }

    it('reads as signed out with the config the two modules install', async () => {
      expect(runtime.session.maxAge).toBe(30 * 24 * 60 * 60)
      await expectSignedOut(await replayedCookie())
    })

    it('reads as signed out even when nuxt-auth-utils reads with no maxAge', async () => {
      // An app that replaced `runtimeConfig.session` wholesale, or the config
      // before core seeded `maxAge`: the middleware must still hold.
      runtime.session = { ...NUXT_AUTH_UTILS_SESSION_DEFAULTS }
      await expectSignedOut(await replayedCookie())
    })
  })

  describe('a custom session name in runtimeConfig.session.name', () => {
    const CUSTOM_NAME = 'app-session'

    beforeEach(() => {
      runtime.session = installedSessionRuntimeConfig({ name: CUSTOM_NAME })
    })

    it('is written, revalidated and read under that name by core and nuxt-auth-utils alike', async () => {
      const cookie = await signIn(CUSTOM_NAME)

      const response = await request('/api/_auth/session', { headers: { cookie } })
      expect(await response.json()).toMatchObject({ user: { email: USER.email } })
      expect(loadAuthSessionRow).toHaveBeenCalledWith(expect.anything(), USER.authSessionId)
    })

    it('still sends an anonymous request no cookie', async () => {
      const page = await request('/')
      const sessionRead = await request('/api/_auth/session')
      expect(page.headers.getSetCookie()).toEqual([])
      expect(sessionRead.headers.getSetCookie()).toEqual([])
      expect(await sessionRead.json()).toEqual({})
    })
  })
})
