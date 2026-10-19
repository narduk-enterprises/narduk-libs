import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createFakeGoogleIssuer, type FakeGoogleIssuer } from '../fixtures/fake-google-issuer'

import type * as GoogleIdentity from '../../server/lib/app-auth/google-identity'
import type * as GoogleLocal from '../../server/lib/app-auth/google-local'
import type * as EmailFlow from '../../server/lib/app-auth/local-email-flow'
import type * as EmailSignIn from '../../server/lib/app-auth/local-email-signin'
import type { H3Event } from 'h3'

/**
 * Google sign-in (narduk-libs#1951) and passwordless email links (#1952) on
 * the local backend, written once and run on both databases: real D1 under
 * Miniflare and real PostgreSQL 17. Each file provides the database, the
 * mocks and the modules; nothing here knows which backend it is on.
 */

export const GOOGLE_CLIENT_ID = 'test-client.apps.googleusercontent.com'
// A fixture value for the fake issuer, not a Google credential.
export const GOOGLE_CLIENT_SECRET = 'fake-issuer-client-secret'
export const APP_URL = 'http://127.0.0.1:3000'

export interface ScenarioModules {
  emailFlow: typeof EmailFlow
  emailSignIn: typeof EmailSignIn
  google: typeof GoogleLocal
  googleIdentity: typeof GoogleIdentity
}

export interface ScenarioContext {
  backend: 'd1' | 'postgres'
  /** Per-test Worker env overrides; reset before each test. */
  env: Record<string, string>
  exec: (sql: string) => Promise<void>
  modules: ScenarioModules
  query: <T = Record<string, unknown>>(sql: string) => Promise<T[]>
  /** Empty every table the scenarios touch. */
  reset: () => Promise<void>
  visit: (options?: { cookie?: string; path?: string }) => H3Event
}

const BASE_ENV = {
  AUTH_LOCAL_PROVIDERS: 'google',
  AUTH_GOOGLE_CLIENT_ID: GOOGLE_CLIENT_ID,
  AUTH_GOOGLE_CLIENT_SECRET: GOOGLE_CLIENT_SECRET,
  AUTH_EMAIL_LINK_SIGNIN: 'true',
  AUTH_EMAIL_LINK_CREATE_USERS: 'true',
}

/** name=value for every cookie the response set (a delete sets an empty value). */
export function responseCookies(event: H3Event): Map<string, string> {
  const header = event.node.res.getHeader('set-cookie')
  const lines = Array.isArray(header) ? header : header ? [String(header)] : []
  const cookies = new Map<string, string>()
  for (const line of lines) {
    const [pair] = line.split(';')
    const index = pair!.indexOf('=')
    cookies.set(pair!.slice(0, index), pair!.slice(index + 1))
  }
  return cookies
}

function cookieHeader(event: H3Event, name: string): string {
  const value = responseCookies(event).get(name)
  if (!value) throw new Error(`the response set no ${name} cookie`)
  return `${name}=${value}`
}

function tokenFromLink(link: string): string {
  return new URLSearchParams(new URL(link).hash.slice(1)).get('token') ?? ''
}

export function describeGoogleAndEmailLinkScenarios(getContext: () => ScenarioContext): void {
  let ctx: ScenarioContext
  let issuer: FakeGoogleIssuer
  const sql = {
    count: async (table: string, where = '1 = 1') => {
      const [row] = await ctx.query<{ n: number | string }>(
        `SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`,
      )
      return Number(row?.n ?? 0)
    },
  }

  beforeEach(async () => {
    ctx = getContext()
    await ctx.reset()
    for (const key of Object.keys(ctx.env)) Reflect.deleteProperty(ctx.env, key)
    Object.assign(ctx.env, BASE_ENV)
    issuer = await createFakeGoogleIssuer({
      clientId: GOOGLE_CLIENT_ID,
      clientSecret: GOOGLE_CLIENT_SECRET,
    })
    vi.stubGlobal('fetch', issuer.fetch)
    ctx.modules.googleIdentity.resetGoogleJwksCache()
  })

  /** Start in this browser, consent at the fake Google, return the callback's inputs. */
  async function startAndConsent(
    profile: Parameters<FakeGoogleIssuer['authorize']>[1],
    tamper: Parameters<FakeGoogleIssuer['authorize']>[2] = {},
    next = '/after?tab=1',
  ) {
    const start = ctx.visit({ path: '/api/auth/google/start' })
    const authorizeUrl = await ctx.modules.google.startLocalGoogleWebSignIn(
      start,
      googleConfig(),
      next,
    )
    const cookie = cookieHeader(start, 'narduk_google_signin')
    return { cookie, query: issuer.authorize(authorizeUrl, profile, tamper), authorizeUrl }
  }

  function googleConfig() {
    return {
      clientId: GOOGLE_CLIENT_ID,
      clientSecret: GOOGLE_CLIENT_SECRET,
      webEnabled: true,
    }
  }

  async function callback(cookie: string | undefined, query: { code?: string; state?: string }) {
    const event = ctx.visit({ path: '/api/callbacks/auth/google', cookie })
    const result = await ctx.modules.google.completeLocalGoogleWebSignIn(
      event,
      googleConfig(),
      query,
    )
    return { event, result }
  }

  describe('Google sign-in', () => {
    it('sends PKCE, a hashed nonce and state, and signs a new user up with no password', async () => {
      const { cookie, query, authorizeUrl } = await startAndConsent({
        sub: 'google-sub-1',
        email: 'New.User@Example.com',
        name: 'New User',
      })
      const authorize = new URL(authorizeUrl)
      expect(authorize.searchParams.get('client_id')).toBe(GOOGLE_CLIENT_ID)
      expect(authorize.searchParams.get('redirect_uri')).toBe(
        `${APP_URL}/api/callbacks/auth/google`,
      )
      expect(authorize.searchParams.get('nonce')).toMatch(/^[0-9a-f]{64}$/u)
      expect(authorize.searchParams.get('code_challenge')).toMatch(/^[\w-]{43}$/u)
      // The secret and the raw nonce never leave the server.
      expect(authorizeUrl).not.toContain(GOOGLE_CLIENT_SECRET)
      expect(cookie).toContain('narduk_google_signin=')

      const { event, result } = await callback(cookie, query)
      expect(result.redirectTo).toBe('/after?tab=1')
      expect(result.user).toMatchObject({
        email: 'new.user@example.com',
        name: 'New User',
        authProvider: 'google',
        needsPasswordSetup: true,
      })
      expect(responseCookies(event).get('nuxt-session')).toBeTruthy()
      // The binding cookie is spent.
      expect(responseCookies(event).get('narduk_google_signin')).toBe('')

      const users = await ctx.query<{ id: string; password_hash: string | null }>(
        "SELECT id, password_hash FROM users WHERE email = 'new.user@example.com'",
      )
      expect(users).toHaveLength(1)
      expect(users[0]!.password_hash).toBeNull()
      const identities = await ctx.query<{ provider: string; subject: string; user_id: string }>(
        'SELECT provider, subject, user_id FROM auth_identities',
      )
      expect(identities).toEqual([
        { provider: 'google', subject: 'google-sub-1', user_id: users[0]!.id },
      ])
      expect(await sql.count('auth_verified_emails')).toBe(1)
      expect(issuer.calls.token).toBe(1)
    })

    it('finds the same user by Google subject next time, whatever the address now is', async () => {
      const first = await startAndConsent({ sub: 'google-sub-2', email: 'two@example.com' })
      const signedUp = await callback(first.cookie, first.query)

      const again = await startAndConsent({ sub: 'google-sub-2', email: 'renamed@example.com' })
      const signedIn = await callback(again.cookie, again.query)

      expect(signedIn.result.user.id).toBe(signedUp.result.user.id)
      expect(await sql.count('users')).toBe(1)
      expect(await sql.count('auth_identities', 'last_sign_in_at IS NOT NULL')).toBe(1)
    })

    it('signs an imported Supabase Google identity into the same user id', async () => {
      // What the stonx importer writes: the users row it already migrated, and
      // one auth_identities row per Supabase auth.identities row with
      // provider = 'google' (subject = identities.provider_id).
      await ctx.exec(
        `INSERT INTO users (id, email, name, created_at, updated_at)
         VALUES ('supabase-user-uuid', 'imported@example.com', 'Imported', 'x', 'x')`,
      )
      await ctx.exec(
        `INSERT INTO auth_identities (id, provider, subject, user_id, email, created_at)
         VALUES ('identity-1', 'google', '108234567890', 'supabase-user-uuid',
                 'imported@example.com', '2025-01-01T00:00:00.000Z')`,
      )
      const { cookie, query } = await startAndConsent({
        sub: '108234567890',
        email: 'imported@example.com',
      })
      const { result } = await callback(cookie, query)
      expect(result.user.id).toBe('supabase-user-uuid')
      expect(await sql.count('users')).toBe(1)
      expect(await sql.count('auth_identities')).toBe(1)
    })

    it('links to an existing account only when the app has proven its address', async () => {
      await ctx.exec(
        `INSERT INTO users (id, email, password_hash, name, created_at, updated_at)
         VALUES ('u-unproven', 'linker@example.com', 'aa:bb', 'Linker', 'x', 'x')`,
      )
      const refused = await startAndConsent({ sub: 'google-sub-3', email: 'linker@example.com' })
      await expect(callback(refused.cookie, refused.query)).rejects.toMatchObject({
        statusCode: 409,
        data: { code: 'google_link_refused' },
      })
      expect(await sql.count('auth_identities')).toBe(0)

      await ctx.exec(
        `INSERT INTO auth_verified_emails (user_id, email, verified_at)
         VALUES ('u-unproven', 'linker@example.com', '2026-01-01T00:00:00.000Z')`,
      )
      const linked = await startAndConsent({ sub: 'google-sub-3', email: 'linker@example.com' })
      const { result } = await callback(linked.cookie, linked.query)
      expect(result.user).toMatchObject({
        id: 'u-unproven',
        authProviders: ['google', 'email'],
        needsPasswordSetup: false,
      })

      // A second Google account cannot claim the same user.
      const other = await startAndConsent({ sub: 'google-sub-4', email: 'linker@example.com' })
      await expect(callback(other.cookie, other.query)).rejects.toMatchObject({
        statusCode: 409,
      })
      expect(await sql.count('auth_identities')).toBe(1)
    })

    it('refuses an address Google has not verified', async () => {
      const unverified = await startAndConsent({
        sub: 'google-sub-5',
        email: 'unverified@example.com',
        emailVerified: false,
      })
      await expect(callback(unverified.cookie, unverified.query)).rejects.toMatchObject({
        statusCode: 400,
        data: { code: 'google_email_missing' },
      })
      expect(await sql.count('users')).toBe(0)
    })

    it.each([
      [
        'a token for another client (bad aud)',
        { aud: 'someone-else.apps.googleusercontent.com' },
        'wrong_audience',
      ],
      ['a token for another request (bad nonce)', { nonce: 'f'.repeat(64) }, 'nonce_mismatch'],
      ['an expired token', { expiresIn: -3600 }, 'expired'],
      ['a token from another issuer', { iss: 'https://evil.example' }, 'wrong_issuer'],
    ])('refuses %s and writes nothing', async (_label, tamper, reason) => {
      const { cookie, query } = await startAndConsent({ sub: 'google-sub-6' }, tamper)
      await expect(callback(cookie, query)).rejects.toMatchObject({
        statusCode: 401,
        data: { code: 'google_token_invalid', reason },
      })
      expect(await sql.count('users')).toBe(0)
      expect(await sql.count('auth_identities')).toBe(0)
    })

    it('refuses a replayed state: no binding, a foreign binding, or a spent code', async () => {
      const { cookie, query } = await startAndConsent({ sub: 'google-sub-7' })
      const { event } = await callback(cookie, query)
      expect(responseCookies(event).get('narduk_google_signin')).toBe('')

      // The browser no longer holds the binding: the replay is a state mismatch.
      await expect(callback(undefined, query)).rejects.toMatchObject({
        statusCode: 400,
        data: { code: 'google_state_mismatch' },
      })
      // Another browser's binding does not match this state.
      const elsewhere = await startAndConsent({ sub: 'google-sub-7' })
      await expect(callback(elsewhere.cookie, query)).rejects.toMatchObject({
        data: { code: 'google_state_mismatch' },
      })
      // A captured cookie replayed with its own state: Google spent the code.
      await expect(callback(cookie, query)).rejects.toMatchObject({
        statusCode: 400,
        data: { code: 'google_code_rejected' },
      })
      expect(await sql.count('users')).toBe(1)
    })

    it('refuses a code redeemed without the PKCE verifier this browser holds', async () => {
      const first = await startAndConsent({ sub: 'google-sub-8' })
      const second = await startAndConsent({ sub: 'google-sub-8' })
      // A code minted for the first browser, carried in the second browser's
      // state: its verifier does not match the first code's challenge.
      const forged = { code: first.query.code, state: second.query.state }
      await expect(callback(second.cookie, forged)).rejects.toMatchObject({
        data: { code: 'google_code_rejected' },
      })
      expect(await sql.count('users')).toBe(0)
    })

    it('reports a cancel at Google as a cancel', async () => {
      const { cookie, query } = await startAndConsent({ sub: 'google-sub-9' })
      const event = ctx.visit({ path: '/api/callbacks/auth/google', cookie })
      await expect(
        ctx.modules.google.completeLocalGoogleWebSignIn(event, googleConfig(), {
          error: 'access_denied',
          state: query.state,
        }),
      ).rejects.toMatchObject({ data: { code: 'google_cancelled' } })
    })

    it('is off when the app has no Google client', async () => {
      const event = ctx.visit({ path: '/api/auth/google/start' })
      await expect(
        ctx.modules.google.startLocalGoogleWebSignIn(
          event,
          { clientId: '', clientSecret: '', webEnabled: false },
          null,
        ),
      ).rejects.toMatchObject({ statusCode: 501 })
    })
  })

  describe('email sign-in links', () => {
    async function request(email: string, next?: string) {
      return ctx.modules.emailSignIn.requestLocalEmailSignInLink(
        ctx.visit({ path: '/api/auth/email-link/request' }),
        { email, next },
      )
    }

    async function redeem(token: string) {
      const event = ctx.visit({ path: '/api/auth/email-link/redeem' })
      const result = await ctx.modules.emailSignIn.redeemLocalEmailSignInLink(event, { token })
      return { event, result }
    }

    it('signs an existing user in once, stores only a digest and records the proof', async () => {
      await ctx.exec(
        `INSERT INTO users (id, email, password_hash, name, created_at, updated_at)
         VALUES ('u-link', 'member@example.com', 'aa:bb', 'Member', 'x', 'x')`,
      )
      await ctx.exec(
        `INSERT INTO auth_verified_emails (user_id, email, verified_at)
         VALUES ('u-link', 'member@example.com', 'x')`,
      )
      const issued = await request('Member@Example.com', '/inbox?x=1')
      expect(issued).toMatchObject({ user: null, nextStep: 'email_link_sent' })
      const link = new URL(issued.selfServeLink!)
      expect(link.pathname).toBe('/auth/email-link')
      expect(link.searchParams.get('next')).toBe('/inbox?x=1')
      // The token rides in the fragment, never the query.
      expect(link.searchParams.get('token')).toBeNull()
      const token = tokenFromLink(issued.selfServeLink!)
      expect(token).toMatch(/^[\w-]{43}$/u)

      const [row] = await ctx.query<{ consumed_at: unknown; purpose: string; token_hash: string }>(
        "SELECT purpose, token_hash, consumed_at FROM auth_email_links WHERE email = 'member@example.com'",
      )
      expect(row).toMatchObject({ purpose: 'signin', consumed_at: null })
      expect(row!.token_hash).toMatch(/^[0-9a-f]{64}$/u)
      expect(row!.token_hash).not.toContain(token)

      const { event, result } = await redeem(token)
      expect(result).toMatchObject({ nextStep: 'signed_in', redirectTo: '/inbox?x=1' })
      expect(result.user).toMatchObject({
        id: 'u-link',
        authProvider: 'email',
        needsPasswordSetup: false,
      })
      expect(responseCookies(event).get('nuxt-session')).toBeTruthy()
      expect(await sql.count('auth_verified_emails', "user_id = 'u-link'")).toBe(1)
      // A proven account keeps its password.
      expect(await sql.count('users', "id = 'u-link' AND password_hash = 'aa:bb'")).toBe(1)

      await expect(redeem(token)).rejects.toMatchObject({ statusCode: 400 })
    })

    it('takes back an account registered under an address the app never proved (pre-hijack)', async () => {
      // Someone else registered the address with their own password and holds a session.
      await ctx.exec(
        `INSERT INTO users (id, email, password_hash, name, created_at, updated_at)
         VALUES ('u-squat', 'owner@example.com', 'attacker:hash', 'Owner', 'x', 'x')`,
      )
      await ctx.exec(
        `INSERT INTO auth_sessions (id, local_user_id, auth_user_id, access_token, refresh_token, expires_at)
         VALUES ('s-attacker', 'u-squat', 'u-squat', 'a', 'r', 4102444800)`,
      )
      const issued = await request('owner@example.com')
      const { result } = await redeem(tokenFromLink(issued.selfServeLink!))

      expect(result.user).toMatchObject({ id: 'u-squat', needsPasswordSetup: true })
      expect(await sql.count('users', "id = 'u-squat' AND password_hash IS NULL")).toBe(1)
      expect(await sql.count('auth_sessions', "id = 's-attacker'")).toBe(0)
      expect(await sql.count('auth_verified_emails', "user_id = 'u-squat'")).toBe(1)
    })

    it('signs a new address up on redemption when the app allows it', async () => {
      const issued = await request('fresh@example.com')
      expect(await sql.count('users')).toBe(0)
      const { result } = await redeem(tokenFromLink(issued.selfServeLink!))
      expect(result.user).toMatchObject({
        email: 'fresh@example.com',
        needsPasswordSetup: true,
        emailConfirmedAt: expect.any(String),
      })
      const [created] = await ctx.query<{ password_hash: string | null }>(
        "SELECT password_hash FROM users WHERE email = 'fresh@example.com'",
      )
      expect(created).toMatchObject({ password_hash: null })
    })

    it('answers an unknown address the same, and issues nothing, when sign-up by link is off', async () => {
      await ctx.exec(
        `INSERT INTO users (id, email, password_hash, name, created_at, updated_at)
         VALUES ('u-known', 'known@example.com', 'aa:bb', 'Known', 'x', 'x')`,
      )
      ctx.env.AUTH_EMAIL_LINK_CREATE_USERS = 'false'
      const known = await request('known@example.com')
      const unknown = await request('nobody@example.com')
      const shape = ({ message, nextStep, user }: typeof known) => ({ message, nextStep, user })
      expect(shape(unknown)).toEqual(shape(known))
      expect(await sql.count('auth_email_links', "email = 'nobody@example.com'")).toBe(0)
      await expect(redeem(tokenFromLink(unknown.selfServeLink!))).rejects.toMatchObject({
        statusCode: 400,
      })
      expect(await sql.count('users')).toBe(1)
    })

    it('refuses an expired link', async () => {
      const issued = await request('late@example.com')
      await ctx.exec('UPDATE auth_email_links SET expires_at = 1')
      await expect(redeem(tokenFromLink(issued.selfServeLink!))).rejects.toMatchObject({
        statusCode: 400,
      })
      expect(await sql.count('users')).toBe(0)
    })

    it('keeps sign-in and password links apart: neither spends the other', async () => {
      await ctx.exec(
        `INSERT INTO users (id, email, password_hash, name, created_at, updated_at)
         VALUES ('u-both', 'both@example.com', 'aa:bb', 'Both', 'x', 'x')`,
      )
      const signin = tokenFromLink((await request('both@example.com')).selfServeLink!)
      await expect(
        ctx.modules.emailFlow.completeLocalEmailPassword(ctx.visit(), {
          token: signin,
          newPassword: 'a new password 1',
        }),
      ).rejects.toMatchObject({ statusCode: 400 })
      expect(await sql.count('auth_email_links', 'consumed_at IS NULL')).toBe(1)
      // Still good for what it was issued for.
      await expect(redeem(signin)).resolves.toMatchObject({
        result: { nextStep: 'signed_in' },
      })

      const reset = await ctx.modules.emailFlow.requestLocalEmailPasswordLink(ctx.visit(), {
        email: 'both@example.com',
      })
      const resetToken = new URL(reset.selfServeLink!).searchParams.get('token')!
      await expect(redeem(resetToken)).rejects.toMatchObject({ statusCode: 400 })
      expect(await sql.count('auth_email_links', "purpose = 'reset' AND consumed_at IS NULL")).toBe(
        1,
      )
    })

    it('replaces an outstanding link with the newest one', async () => {
      const first = tokenFromLink((await request('twice@example.com')).selfServeLink!)
      const second = tokenFromLink((await request('twice@example.com')).selfServeLink!)
      await expect(redeem(first)).rejects.toMatchObject({ statusCode: 400 })
      await expect(redeem(second)).resolves.toMatchObject({ result: { nextStep: 'signed_in' } })
    })

    it('is off unless the app turns it on', async () => {
      ctx.env.AUTH_EMAIL_LINK_SIGNIN = 'false'
      await expect(request('member@example.com')).rejects.toMatchObject({ statusCode: 501 })
      await expect(redeem('x'.repeat(43))).rejects.toMatchObject({ statusCode: 501 })
    })
  })
}
