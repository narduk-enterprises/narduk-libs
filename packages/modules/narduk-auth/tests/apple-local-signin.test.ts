import { DatabaseSync } from 'node:sqlite'

import { drizzle } from 'drizzle-orm/sqlite-proxy'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { APPLE_ISSUER, hashAppleNonce } from '../server/lib/app-auth/apple-identity'

import { appleTestKeys, signAppleToken } from './fixtures/apple-tokens'

import type { AppleSignInConfig } from '../shared/utils/apple-sign-in-config'
import type { H3Event } from 'h3'

/**
 * narduk-libs#164: Sign in with Apple on the local D1 backend, end to end over
 * a real SQLite `users` table and mocked Apple keys. Apple's JWKS fetch is the
 * only network call and it is stubbed with the test key.
 */

const state = vi.hoisted(() => ({
  cookies: new Map<string, string>(),
  cookieWrites: [] as Array<{ name: string; options: Record<string, unknown>; value: string }>,
  db: null as unknown,
  publicSignup: true,
  sessions: [] as Array<{ extras: Record<string, unknown>; user: { id: string } }>,
  sqlite: null as unknown,
  verified: new Map<string, string>(),
  recorded: [] as Array<{ email: string; userId: string }>,
}))

vi.mock('#layer/server/utils/database', () => ({
  executeDatabaseQuery: async (query: unknown) => query,
  getDatabaseRow: async (query: unknown) => {
    const rows = (await query) as unknown[]
    return rows[0]
  },
  useDatabase: () => state.db,
}))

vi.mock('@narduk-enterprises/narduk-app/server/http', () => ({
  deleteAppCookie: (_event: unknown, name: string, options: Record<string, unknown>) => {
    state.cookies.delete(name)
    state.cookieWrites.push({ name, options, value: '' })
  },
  readAppCookie: (_event: unknown, name: string) => state.cookies.get(name),
  readAppRequestHeader: (_event: unknown, name: string) =>
    name === 'host' ? 'app.example' : undefined,
  setAppCookie: (
    _event: unknown,
    name: string,
    value: string,
    options: Record<string, unknown>,
  ) => {
    state.cookies.set(name, value)
    state.cookieWrites.push({ name, options, value })
  },
}))

vi.mock('../server/utils/verified-email', () => ({
  getLocalEmailVerification: async (_event: unknown, userId: string, email: string) =>
    state.verified.get(`${userId}:${email}`) ?? null,
  recordLocalEmailVerification: async (
    _event: unknown,
    userId: string,
    email: string,
    at: string,
  ) => {
    state.recorded.push({ userId, email })
    state.verified.set(`${userId}:${email}`, at)
  },
}))

vi.mock('../server/lib/app-auth/session', () => ({
  establishLocalSessionUser: async (
    _event: unknown,
    user: { email: string; id: string; name: string },
    extras: Record<string, unknown>,
  ) => {
    state.sessions.push({ user, extras })
    return { id: user.id, email: user.email, name: user.name, isAdmin: false, ...extras }
  },
}))

vi.mock('../server/lib/app-auth/supabase-client', () => ({
  getAuthConfig: () => ({
    appUrl: 'https://app.example',
    publicSignup: state.publicSignup,
    redirectPath: '/dashboard/',
  }),
}))

const SERVICES_ID = 'com.example.web'
const APPLE: AppleSignInConfig = {
  nativeClientIds: ['com.example.ios'],
  nativeEnabled: true,
  servicesId: SERVICES_ID,
  webEnabled: true,
}
const event = { headers: new Headers({ host: 'app.example' }), context: {} } as unknown as H3Event

function sqlite(): DatabaseSync {
  return state.sqlite as DatabaseSync
}

async function load() {
  return import('../server/lib/app-auth/apple-local')
}

async function fetchJwks() {
  return { keys: [(await appleTestKeys()).publicJwk] }
}

async function appleToken(rawNonce: string, overrides: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000)
  return signAppleToken({
    iss: APPLE_ISSUER,
    aud: SERVICES_ID,
    sub: 'apple-sub-1',
    iat: now,
    exp: now + 600,
    nonce: await hashAppleNonce(rawNonce),
    email: 'person@example.com',
    email_verified: true,
    ...overrides,
  })
}

/** Runs /start, then returns the form Apple would post back for that browser. */
async function startAndAuthorize(overrides: Record<string, unknown> = {}, next = '/farm/1') {
  const { startLocalAppleWebSignIn } = await load()
  const url = new URL(await startLocalAppleWebSignIn(event, APPLE, next))
  const binding = JSON.parse(state.cookies.get('narduk_apple_signin')!) as { rawNonce: string }
  return {
    url,
    form: {
      state: url.searchParams.get('state')!,
      id_token: await appleToken(binding.rawNonce, overrides),
    },
  }
}

function userRows() {
  return sqlite().prepare('SELECT id, email, name, apple_id, password_hash FROM users').all()
}

describe('Sign in with Apple on the local backend (#164)', () => {
  beforeEach(async () => {
    vi.resetModules()
    const db = new DatabaseSync(':memory:')
    db.exec(`CREATE TABLE users (
      id text PRIMARY KEY NOT NULL, email text NOT NULL UNIQUE, password_hash text, name text,
      apple_id text UNIQUE, is_admin integer DEFAULT false,
      created_at text NOT NULL, updated_at text NOT NULL)`)
    state.sqlite = db
    state.db = drizzle(async (sql, params, method) => {
      const statement = db.prepare(sql)
      statement.setReturnArrays(true)
      if (method === 'run') {
        statement.run(...(params as never[]))
        return { rows: [] }
      }
      const rows = statement.all(...(params as never[])) as unknown[][]
      return { rows: method === 'get' ? (rows[0] as never) : rows }
    })
    state.cookies = new Map()
    state.cookieWrites = []
    state.publicSignup = true
    state.sessions = []
    state.verified = new Map()
    state.recorded = []
    const { resetAppleJwksCache } = await import('../server/lib/app-auth/apple-identity')
    resetAppleJwksCache()
  })

  afterEach(() => {
    sqlite().close()
  })

  it('redirects to Apple with form_post, a state and a hashed nonce bound in a cross-site cookie', async () => {
    const { url } = await startAndAuthorize()
    expect(`${url.origin}${url.pathname}`).toBe('https://appleid.apple.com/auth/authorize')
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: SERVICES_ID,
      redirect_uri: 'https://app.example/api/callbacks/auth/apple',
      response_type: 'code id_token',
      response_mode: 'form_post',
      scope: 'name email',
    })
    const binding = JSON.parse(state.cookies.get('narduk_apple_signin')!) as Record<string, string>
    expect(url.searchParams.get('state')).toBe(binding.state)
    expect(url.searchParams.get('nonce')).toBe(await hashAppleNonce(binding.rawNonce!))
    expect(url.searchParams.get('nonce')).not.toBe(binding.rawNonce)
    expect(binding.next).toBe('/farm/1')
    expect(state.cookieWrites[0]!.options).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      path: '/api',
      maxAge: 600,
    })
  })

  it('creates a password-less user with apple_id on first sign-in and returns to next', async () => {
    const { form } = await startAndAuthorize()
    const { completeLocalAppleWebSignIn } = await load()
    const result = await completeLocalAppleWebSignIn(
      event,
      APPLE,
      { ...form, user: '{"name":{"firstName":"Pat","lastName":"Lee"}}' },
      { fetchJwks },
    )
    expect(result.redirectTo).toBe('/farm/1')
    expect(userRows()).toEqual([
      expect.objectContaining({
        email: 'person@example.com',
        name: 'Pat Lee',
        apple_id: 'apple-sub-1',
        password_hash: null,
      }),
    ])
    expect(state.sessions[0]!.extras).toMatchObject({
      authProvider: 'apple',
      authProviders: ['apple'],
      needsPasswordSetup: true,
    })
    expect(state.recorded).toEqual([{ userId: result.user.id, email: 'person@example.com' }])
    // The binding is single-use.
    expect(state.cookies.has('narduk_apple_signin')).toBe(false)
  })

  it('signs a returning Apple user in by apple_id, even under a new relay email', async () => {
    const first = await startAndAuthorize()
    const { completeLocalAppleWebSignIn } = await load()
    const created = await completeLocalAppleWebSignIn(event, APPLE, first.form, { fetchJwks })
    const again = await startAndAuthorize({ email: undefined, email_verified: undefined })
    const result = await completeLocalAppleWebSignIn(event, APPLE, again.form, { fetchJwks })
    expect(result.user.id).toBe(created.user.id)
    expect(userRows()).toHaveLength(1)
  })

  it('refuses a callback whose state does not match this browser', async () => {
    const { form } = await startAndAuthorize()
    const { completeLocalAppleWebSignIn } = await load()
    await expect(
      completeLocalAppleWebSignIn(event, APPLE, { ...form, state: 'attacker' }, { fetchJwks }),
    ).rejects.toMatchObject({ statusCode: 400, data: { code: 'apple_state_mismatch' } })
    expect(userRows()).toEqual([])
  })

  it('refuses a callback with no binding cookie (login CSRF)', async () => {
    const { form } = await startAndAuthorize()
    state.cookies.clear()
    const { completeLocalAppleWebSignIn } = await load()
    await expect(
      completeLocalAppleWebSignIn(event, APPLE, form, { fetchJwks }),
    ).rejects.toMatchObject({ data: { code: 'apple_state_mismatch' } })
  })

  it('refuses a token minted for another nonce, even with the right state', async () => {
    const { form } = await startAndAuthorize()
    const { completeLocalAppleWebSignIn } = await load()
    await expect(
      completeLocalAppleWebSignIn(
        event,
        APPLE,
        { ...form, id_token: await appleToken('some-other-nonce') },
        { fetchJwks },
      ),
    ).rejects.toMatchObject({ statusCode: 401, data: { reason: 'nonce_mismatch' } })
    expect(userRows()).toEqual([])
  })

  it('refuses a native-audience token on the web flow', async () => {
    const { form } = await startAndAuthorize({ aud: 'com.example.ios' })
    const { completeLocalAppleWebSignIn } = await load()
    await expect(
      completeLocalAppleWebSignIn(event, APPLE, form, { fetchJwks }),
    ).rejects.toMatchObject({ data: { reason: 'wrong_audience' } })
  })

  it('links an existing account only when this app has proven its email', async () => {
    const now = new Date().toISOString()
    sqlite()
      .prepare(
        "INSERT INTO users (id, email, password_hash, name, created_at, updated_at) VALUES ('existing', 'person@example.com', 'hash', 'Person', ?, ?)",
      )
      .run(now, now)
    const { completeLocalAppleWebSignIn } = await load()

    const unproven = await startAndAuthorize()
    await expect(
      completeLocalAppleWebSignIn(event, APPLE, unproven.form, { fetchJwks }),
    ).rejects.toMatchObject({ statusCode: 409, data: { code: 'apple_link_refused' } })
    expect(userRows()).toEqual([expect.objectContaining({ id: 'existing', apple_id: null })])

    state.verified.set('existing:person@example.com', now)
    const proven = await startAndAuthorize()
    const result = await completeLocalAppleWebSignIn(event, APPLE, proven.form, { fetchJwks })
    expect(result.user.id).toBe('existing')
    expect(userRows()).toEqual([
      expect.objectContaining({ id: 'existing', apple_id: 'apple-sub-1' }),
    ])
    expect(state.sessions.at(-1)!.extras).toMatchObject({
      authProviders: ['apple', 'email'],
      needsPasswordSetup: false,
    })
  })

  it('refuses a new Apple user when public sign-up is closed', async () => {
    state.publicSignup = false
    const { form } = await startAndAuthorize()
    const { completeLocalAppleWebSignIn } = await load()
    await expect(
      completeLocalAppleWebSignIn(event, APPLE, form, { fetchJwks }),
    ).rejects.toMatchObject({ statusCode: 403 })
    expect(userRows()).toEqual([])
  })

  it('refuses a first sign-in without a verified email', async () => {
    const { form } = await startAndAuthorize({ email_verified: false })
    const { completeLocalAppleWebSignIn } = await load()
    await expect(
      completeLocalAppleWebSignIn(event, APPLE, form, { fetchJwks }),
    ).rejects.toMatchObject({ data: { code: 'apple_email_missing' } })
  })

  it('answers 501 when the app has no Services ID', async () => {
    const { startLocalAppleWebSignIn } = await load()
    await expect(
      startLocalAppleWebSignIn(event, { ...APPLE, webEnabled: false, servicesId: '' }, null),
    ).rejects.toMatchObject({ statusCode: 501 })
  })

  it('reads the display name Apple posts once, and never its email', async () => {
    const { appleFormDisplayName } = await load()
    expect(appleFormDisplayName('{"name":{"firstName":" Pat ","lastName":""},"email":"x@y"}')).toBe(
      'Pat',
    )
    expect(appleFormDisplayName('not json')).toBeNull()
    expect(appleFormDisplayName(undefined)).toBeNull()
  })
})
