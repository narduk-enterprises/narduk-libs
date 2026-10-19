import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'

import bcrypt from 'bcryptjs'
import { eq } from 'drizzle-orm'
import { createEvent } from 'h3'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  applyMigrationDirectory,
  diffSchemaAgainstDatabase,
} from '../../narduk-core/tests/helpers/pg-schema-parity'
import {
  startPostgres17,
  type TestDatabase,
  type TestPostgres,
} from '../../narduk-core/tests/helpers/postgres17'

import type { H3Event } from 'h3'

/**
 * narduk-auth's local backend running on PostgreSQL 17 (the stonx / Hyperdrive
 * path), end to end.
 *
 * Nothing about the database is faked. `#layer/server/utils/database` is
 * narduk-core's real module, so `createAppDatabase`, the `postgres.js`
 * `prepare: false, max: 1` client Hyperdrive requires and the `.get()/.all()`
 * compatibility proxy all run for real; the tables come from the shipped
 * `drizzle-pg/*.sql` files, never from Drizzle's own DDL, and the schemas are
 * the pg ones the nuxt module selects when `databaseBackend` is `'postgres'`.
 * Only Nitro's runtime config and the logger (both outside the database) are
 * replaced.
 */

const runtime = vi.hoisted(() => ({
  config: {} as Record<string, unknown>,
}))

vi.mock('nitropack/runtime', () => ({
  defineNitroPlugin: <T>(plugin: T) => plugin,
  useRuntimeConfig: () => runtime.config,
}))
vi.mock('#layer/server/utils/database', async () => {
  return await import('../../narduk-core/runtime/server/utils/database')
})
vi.mock('#narduk-core/schema', async () => {
  return await import('../../narduk-core/runtime/server/database/pg-schema')
})
vi.mock('#narduk-auth/schema', async () => {
  return await import('../server/database/app-pg-schema')
})

const SESSION_PASSWORD = 'narduk-postgres-integration-session-password-32+chars'
const APP_URL = 'http://127.0.0.1:3000'
const OWNER_EMAIL = 'owner@example.com'

let server: TestPostgres
let database: TestDatabase

function baseConfig(url: string): Record<string, unknown> {
  return {
    databaseBackend: 'postgres',
    databaseBackendSource: 'option',
    hyperdriveBinding: 'HYPERDRIVE',
    authBackend: 'local',
    authLocalEmailVerification: true,
    session: { name: 'nuxt-session' },
    public: {
      appName: 'Postgres test',
      appUrl: APP_URL,
      authBackend: 'local',
      authProviders: ['email'],
      authPublicSignup: true,
      authRequireMfa: false,
    },
    __url: url,
  }
}

interface Visit {
  cookie?: string
  path?: string
}

function visit({ cookie, path = '/api/auth/login' }: Visit = {}): H3Event {
  const request = new IncomingMessage(new Socket())
  request.url = path
  request.method = 'POST'
  request.headers = { host: '127.0.0.1:3000', ...(cookie ? { cookie } : {}) }
  const response = new ServerResponse(request)
  const event = createEvent(request, response)
  event.context.cloudflare = {
    env: { HYPERDRIVE: { connectionString: runtime.config.__url as string } },
  }
  return event
}

function sessionCookie(event: H3Event): string | undefined {
  const header = event.node.res.getHeader('set-cookie')
  const cookies = Array.isArray(header) ? header : header ? [String(header)] : []
  const last = cookies.findLast((value) => value.startsWith('nuxt-session='))
  return last?.split(';')[0]
}

async function loadModules() {
  const flows = await import('../server/lib/app-auth/auth-flows')
  const session = await import('../server/lib/app-auth/session')
  const emailFlow = await import('../server/lib/app-auth/local-email-flow')
  const apple = await import('../server/lib/app-auth/apple-local')
  const challenges = await import('../server/lib/app-auth/webauthn-challenges')
  const schema = await import('../server/database/app-pg-schema')
  const core = await import('../../narduk-core/runtime/server/database/pg-schema')
  const authDb = await import('../server/utils/auth-bridge-database')
  const coreDb = await import('../../narduk-core/runtime/server/utils/database')
  const throttle = await import('../server/lib/app-auth/local-email-throttle')
  const password = await import('../../narduk-core/runtime/server/utils/password')
  const kv = await import('../server/lib/mcp-oauth/d1-kv')
  const native = await import('../server/lib/app-auth/native-core')
  const verified = await import('../server/utils/verified-email')
  const core2 = await import('../server/lib/app-auth/local-email-core')
  const coreAuth = await import('../../narduk-core/runtime/server/utils/auth')
  const notifications = await import('../server/utils/notifications')
  return {
    coreAuth,
    notifications,
    apple,
    authDb,
    challenges,
    core,
    core2,
    coreDb,
    emailFlow,
    flows,
    kv,
    native,
    password,
    schema,
    session,
    throttle,
    verified,
  }
}

let m: Awaited<ReturnType<typeof loadModules>>

beforeAll(async () => {
  process.env.NUXT_SESSION_PASSWORD = SESSION_PASSWORD
  process.env.AUTH_EMAIL_SELF_SERVE_LINKS = 'true'
  process.env.AUTH_EMAIL_APP_URL = APP_URL
  process.env.AUTH_EMAIL_ALLOWLIST = OWNER_EMAIL
  server = await startPostgres17()
  database = await server.createDatabase()
  await applyMigrationDirectory(database.sql, '../narduk-core/runtime/drizzle-pg')
  await applyMigrationDirectory(database.sql, 'drizzle-pg')
  runtime.config = baseConfig(database.url)
  m = await loadModules()
}, 180_000)

afterAll(async () => {
  await server?.stop()
})

beforeEach(async () => {
  await database.sql.unsafe(`TRUNCATE users, auth_local_email_attempts, auth_email_links,
    auth_oauth_kv, auth_webauthn_challenges CASCADE`)
  await database.sql.unsafe('TRUNCATE kv_cache')
})

const rows = <T = Record<string, unknown>>(query: string, ...params: unknown[]) =>
  database.sql.unsafe(query, params as never[]) as unknown as Promise<T[]>

describe('the migrations are what this suite runs on', () => {
  it('matches the Drizzle schema (guards the suite against a drifted fixture)', async () => {
    expect(server.version.startsWith('17.')).toBe(true)
    const tables = Object.values(m.schema).filter(
      (value) =>
        typeof value === 'object' &&
        value !== null &&
        Symbol.for('drizzle:IsDrizzleTable') in value,
    )
    const coreTables = [
      'api_keys',
      'kv_cache',
      'notifications',
      'sessions',
      'system_prompts',
      'todos',
      'users',
    ]
    expect(
      await diffSchemaAgainstDatabase(database.sql, tables as never, {
        collations: { 'auth_oauth_kv.key': 'C' },
        ignoreTables: coreTables,
      }),
    ).toEqual([])
  })
})

describe('local backend sign-in on PostgreSQL', () => {
  it('registers, opens a session, reads it back and signs out', async () => {
    const registered = visit({ path: '/api/auth/register' })
    const result = await m.flows.registerUser(registered, {
      email: 'Parent@Example.com',
      name: ' Parent ',
      password: 'correct horse battery',
    })
    expect(result.nextStep).toBe('signed_in')

    const [user] = await rows<{
      email: string
      id: string
      is_admin: boolean | null
      name: string
      password_hash: string
    }>('SELECT * FROM users')
    expect(user).toMatchObject({ email: 'parent@example.com', name: 'Parent' })
    expect(user!.password_hash).toMatch(/^[0-9a-f]{32}:[0-9a-f]{64}$/u)

    const [authSession] = await rows<{
      created_at: string
      expires_at: string
      id: string
      local_user_id: string
      recovery_mode: boolean
    }>('SELECT * FROM auth_sessions')
    expect(authSession).toMatchObject({ local_user_id: user!.id, recovery_mode: false })
    expect(Number(authSession!.expires_at)).toBeGreaterThan(Date.now() / 1000 + 29 * 86400)
    expect(new Date(authSession!.created_at).toISOString()).toBe(authSession!.created_at)

    // The cookie alone identifies the session on a later request, and the
    // auth_sessions row reads back with real booleans and numbers.
    const cookie = sessionCookie(registered)
    expect(cookie).toBeTruthy()
    const later = visit({ cookie, path: '/api/auth/session' })
    const current = await m.session.getCurrentSessionUser(later)
    expect(current).toMatchObject({ email: 'parent@example.com', authBackend: 'local' })
    const row = await m.session.loadAuthSessionRow(later, authSession!.id)
    expect(row).toMatchObject({ recoveryMode: false })
    expect(typeof row?.expiresAt).toBe('number')
    expect(row?.expiresAt).toBe(Number(authSession!.expires_at))

    await m.session.clearCurrentSession(later)
    expect(await rows('SELECT * FROM auth_sessions')).toHaveLength(0)
  })

  it('rejects a duplicate registration with 409 and signs in with the password', async () => {
    await m.flows.registerUser(visit(), {
      email: 'a@example.com',
      name: 'A',
      password: 'password-one-1',
    })
    await expect(
      m.flows.registerUser(visit(), {
        email: 'A@example.com',
        name: 'A',
        password: 'password-one-1',
      }),
    ).rejects.toMatchObject({ statusCode: 409 })

    const login = await m.flows.loginUser(visit(), {
      email: 'a@example.com',
      password: 'password-one-1',
    })
    expect(login).toMatchObject({ nextStep: 'signed_in', user: { email: 'a@example.com' } })
    expect(await rows('SELECT 1 FROM auth_sessions')).toHaveLength(2)
  })

  it('locks the account after repeated failures, then lets the right password in once the lock lapses', async () => {
    await m.flows.registerUser(visit(), {
      email: 'b@example.com',
      name: 'B',
      password: 'right-password-1',
    })
    const wrong = () =>
      m.flows.loginUser(visit(), { email: 'b@example.com', password: 'wrong-password' })

    for (let attempt = 0; attempt < 4; attempt += 1) {
      await expect(wrong()).rejects.toMatchObject({ statusCode: 401 })
    }
    const [attempts] = await rows<{
      failures: number
      locked_until: string | null
      window_started_at: string
    }>('SELECT * FROM auth_local_email_attempts')
    expect(attempts!.failures).toBe(4)

    // Past the threshold the account is refused with 429 and Retry-After,
    // even for the correct password.
    let locked: { statusCode: number } | undefined
    for (let attempt = 0; attempt < 6 && !locked; attempt += 1) {
      await wrong().catch((error: { statusCode: number }) => {
        if (error.statusCode === 429) locked = error
      })
    }
    expect(locked?.statusCode).toBe(429)
    const [lockRow] = await rows<{ failures: number; locked_until: string }>(
      'SELECT failures, locked_until FROM auth_local_email_attempts',
    )
    expect(Number(lockRow!.locked_until)).toBeGreaterThan(Date.now() / 1000)
    await expect(
      m.flows.loginUser(visit(), { email: 'b@example.com', password: 'right-password-1' }),
    ).rejects.toMatchObject({ statusCode: 429 })

    // Lapse the lock: the correct password signs in and clears the counter.
    await database.sql.unsafe(
      'UPDATE auth_local_email_attempts SET locked_until = locked_until - 100000, window_started_at = window_started_at',
    )
    const ok = await m.flows.loginUser(visit(), {
      email: 'b@example.com',
      password: 'right-password-1',
    })
    expect(ok.nextStep).toBe('signed_in')
    expect(await rows('SELECT * FROM auth_local_email_attempts')).toHaveLength(0)
  })

  it('starts a new failure window instead of locking on stale counts', async () => {
    const principal = 'stale@example.com'
    const event = visit()
    for (let i = 0; i < 3; i += 1)
      await m.throttle.recordLocalEmailAttemptFailure(event, 'login', principal)
    await database.sql.unsafe(
      'UPDATE auth_local_email_attempts SET window_started_at = window_started_at - 86400',
    )
    await m.throttle.recordLocalEmailAttemptFailure(event, 'login', principal)
    const [row] = await rows<{ failures: number; locked_until: string | null }>(
      'SELECT failures, locked_until FROM auth_local_email_attempts',
    )
    expect(row).toMatchObject({ failures: 1, locked_until: null })
  })

  it('verifies an imported Supabase bcrypt hash as-is and rehashes it to PBKDF2 on login', async () => {
    const supabaseHash = bcrypt.hashSync('from-supabase-pw', 10).replace(/^\$2b\$/u, '$2a$')
    expect(supabaseHash).toMatch(/^\$2a\$10\$/u)
    await database.sql.unsafe(
      `INSERT INTO users (id, email, password_hash, name, created_at, updated_at)
       VALUES ('u-bcrypt', 'migrated@example.com', $1, 'Migrated', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
      [supabaseHash],
    )

    await expect(
      m.flows.loginUser(visit(), { email: 'migrated@example.com', password: 'wrong' }),
    ).rejects.toMatchObject({ statusCode: 401 })
    const [stillBcrypt] = await rows<{ password_hash: string }>(
      "SELECT password_hash FROM users WHERE id = 'u-bcrypt'",
    )
    expect(stillBcrypt!.password_hash).toBe(supabaseHash)

    const result = await m.flows.loginUser(visit(), {
      email: 'migrated@example.com',
      password: 'from-supabase-pw',
    })
    expect(result.nextStep).toBe('signed_in')
    const [rehashed] = await rows<{ password_hash: string; updated_at: string }>(
      "SELECT password_hash, updated_at FROM users WHERE id = 'u-bcrypt'",
    )
    expect(rehashed!.password_hash).toMatch(/^[0-9a-f]{32}:[0-9a-f]{64}$/u)
    expect(rehashed!.updated_at).not.toBe('2026-01-01T00:00:00.000Z')
    // And the new hash is what verifies now.
    await expect(
      m.password.verifyUserPassword('from-supabase-pw', rehashed!.password_hash),
    ).resolves.toBe(true)
    await expect(
      m.flows.loginUser(visit(), { email: 'migrated@example.com', password: 'from-supabase-pw' }),
    ).resolves.toMatchObject({ nextStep: 'signed_in' })
  })
})

describe('email links on PostgreSQL', () => {
  it('issues a setup link for a preauthorized address, redeems it once and records the proof', async () => {
    const asked = visit({ path: '/api/auth/password/request' })
    const issued = await m.emailFlow.requestLocalEmailPasswordLink(asked, {
      email: 'Owner@Example.com',
    })
    const link = issued.selfServeLink as string
    expect(link).toContain(APP_URL)
    const token = new URL(link).searchParams.get('token') ?? new URL(link).hash.split('token=')[1]
    expect(token).toBeTruthy()

    const [stored] = await rows<{
      consumed_at: string | null
      expires_at: string
      purpose: string
      token_hash: string
    }>('SELECT * FROM auth_email_links')
    expect(stored).toMatchObject({ purpose: 'setup', consumed_at: null })
    expect(stored!.token_hash).toBe(await m.core2.hashLocalEmailValue(token!))
    expect(stored!.token_hash).not.toContain(token!)
    expect(Number(stored!.expires_at)).toBeGreaterThan(Date.now() / 1000)

    const completed = await m.emailFlow.completeLocalEmailPassword(visit(), {
      token: token!,
      newPassword: 'a brand new password',
    })
    expect(completed).toMatchObject({ nextStep: 'signed_in', user: { email: OWNER_EMAIL } })
    const [verified] = await rows<{ email: string; verified_at: string }>(
      'SELECT * FROM auth_verified_emails',
    )
    expect(verified!.email).toBe(OWNER_EMAIL)

    // Single use.
    await expect(
      m.emailFlow.completeLocalEmailPassword(visit(), {
        token: token!,
        newPassword: 'another password!',
      }),
    ).rejects.toMatchObject({ statusCode: 400 })

    // The proof upserts (ON CONFLICT DO UPDATE) rather than failing the second time.
    const [user] = await rows<{ id: string }>('SELECT id FROM users WHERE email = $1', OWNER_EMAIL)
    await m.verified.recordLocalEmailVerification(
      visit(),
      user!.id,
      OWNER_EMAIL,
      '2030-01-01T00:00:00.000Z',
    )
    const [after] = await rows<{ verified_at: string }>('SELECT * FROM auth_verified_emails')
    expect(after!.verified_at).toBe('2030-01-01T00:00:00.000Z')
  })

  it('resets an existing account password with a link and revokes its other sessions', async () => {
    await m.flows.registerUser(visit(), {
      email: OWNER_EMAIL,
      name: 'Owner',
      password: 'old password 12',
    })
    expect(await rows('SELECT 1 FROM auth_sessions')).toHaveLength(1)

    const issued = await m.emailFlow.requestLocalEmailPasswordLink(visit(), {
      email: OWNER_EMAIL,
    })
    const link = new URL(issued.selfServeLink as string)
    const token = link.searchParams.get('token') ?? link.hash.split('token=')[1]
    const [{ purpose }] = await rows<{ purpose: string }>(
      'SELECT purpose FROM auth_email_links WHERE consumed_at IS NULL',
    )
    expect(purpose).toBe('reset')

    // A newer request supersedes the older link (UPDATE ... SET consumed_at).
    const second = await m.emailFlow.requestLocalEmailPasswordLink(visit(), {
      email: OWNER_EMAIL,
    })
    const secondToken =
      new URL(second.selfServeLink as string).searchParams.get('token') ??
      new URL(second.selfServeLink as string).hash.split('token=')[1]
    await expect(
      m.emailFlow.completeLocalEmailPassword(visit(), {
        token: token!,
        newPassword: 'whatever password',
      }),
    ).rejects.toMatchObject({ statusCode: 400 })

    await m.emailFlow.completeLocalEmailPassword(visit(), {
      token: secondToken!,
      newPassword: 'new password 1234',
    })
    expect(await rows('SELECT 1 FROM auth_sessions')).toHaveLength(1) // old one revoked, new one opened
    await expect(
      m.flows.loginUser(visit(), { email: OWNER_EMAIL, password: 'old password 12' }),
    ).rejects.toMatchObject({ statusCode: 401 })
    await expect(
      m.flows.loginUser(visit(), { email: OWNER_EMAIL, password: 'new password 1234' }),
    ).resolves.toMatchObject({ nextStep: 'signed_in' })
  })

  it('refuses an expired link', async () => {
    const issued = await m.emailFlow.requestLocalEmailPasswordLink(visit(), {
      email: OWNER_EMAIL,
    })
    const link = new URL(issued.selfServeLink as string)
    const token = link.searchParams.get('token') ?? link.hash.split('token=')[1]
    await database.sql.unsafe('UPDATE auth_email_links SET expires_at = expires_at - 7200')
    await expect(
      m.emailFlow.completeLocalEmailPassword(visit(), {
        token: token!,
        newPassword: 'whatever password',
      }),
    ).rejects.toMatchObject({ statusCode: 400 })
  })
})

describe('account linking on PostgreSQL', () => {
  const claims = (overrides: Record<string, unknown> = {}) => ({
    appleId: 'apple-001',
    email: 'linker@example.com',
    emailVerified: true,
    isPrivateEmail: false,
    ...overrides,
  })

  it('creates, then re-finds, an account by its Apple ID', async () => {
    const first = await m.apple.signInWithAppleIdentity(visit(), claims() as never, {
      displayName: 'Linker',
    })
    expect(first).toMatchObject({
      email: 'linker@example.com',
      authProvider: 'apple',
      needsPasswordSetup: true,
    })
    const [created] = await rows<{
      apple_id: string
      is_admin: boolean | null
      password_hash: string | null
    }>('SELECT apple_id, password_hash, is_admin FROM users')
    expect(created).toMatchObject({ apple_id: 'apple-001', password_hash: null })

    const again = await m.apple.signInWithAppleIdentity(
      visit(),
      claims({ email: 'changed@example.com' }) as never,
    )
    expect(again.id).toBe(first.id)
    expect(await rows('SELECT 1 FROM users')).toHaveLength(1)
    expect(await rows('SELECT 1 FROM auth_verified_emails')).toHaveLength(1)
  })

  it('links Apple to an existing password account with the same verified address', async () => {
    await database.sql.unsafe(
      `INSERT INTO users (id, email, password_hash, name, created_at, updated_at)
       VALUES ('u-existing', 'linker@example.com', 'aa:bb', 'Linker', 'x', 'x')`,
    )
    await database.sql.unsafe(
      `INSERT INTO auth_verified_emails (user_id, email, verified_at)
       VALUES ('u-existing', 'linker@example.com', '2026-01-01T00:00:00.000Z')`,
    )
    const user = await m.apple.signInWithAppleIdentity(visit(), claims() as never)
    expect(user.id).toBe('u-existing')
    const [row] = await rows<{ apple_id: string }>(
      "SELECT apple_id FROM users WHERE id = 'u-existing'",
    )
    expect(row!.apple_id).toBe('apple-001')
  })
})

describe('session housekeeping and cascades on PostgreSQL', () => {
  async function seedUser(id: string) {
    await database.sql.unsafe(
      `INSERT INTO users (id, email, name, created_at, updated_at) VALUES ($1, $2, 'U', 'x', 'x')`,
      [id, `${id}@example.com`],
    )
  }

  it('sweeps only expired auth_sessions on login, in a bounded batch', async () => {
    await seedUser('u1')
    for (let i = 0; i < 3; i += 1) {
      await database.sql.unsafe(
        `INSERT INTO auth_sessions (id, local_user_id, auth_user_id, access_token, refresh_token, expires_at)
         VALUES ($1, 'u1', 'u1', 't', 't', $2)`,
        [`old-${i}`, Math.floor(Date.now() / 1000) - 60],
      )
    }
    await database.sql.unsafe(
      `INSERT INTO auth_sessions (id, local_user_id, auth_user_id, access_token, refresh_token, expires_at)
       VALUES ('live', 'u1', 'u1', 't', 't', $1)`,
      [Math.floor(Date.now() / 1000) + 3600],
    )
    await m.session.sweepExpiredAuthSessions(visit())
    const left = await rows<{ id: string }>('SELECT id FROM auth_sessions')
    expect(left.map((row) => row.id)).toEqual(['live'])
  })

  it("revokes every session of a user except the caller's", async () => {
    await seedUser('u2')
    for (const id of ['keep', 'drop-1', 'drop-2']) {
      await database.sql.unsafe(
        `INSERT INTO auth_sessions (id, local_user_id, auth_user_id, access_token, refresh_token, expires_at)
         VALUES ($1, 'u2', 'u2', 't', 't', 9999999999)`,
        [id],
      )
    }
    await m.session.revokeUserAuthSessions(visit(), 'u2', { exceptSessionId: 'keep' })
    expect(
      (await rows<{ id: string }>('SELECT id FROM auth_sessions')).map((row) => row.id),
    ).toEqual(['keep'])
  })

  it('stores far-future epoch seconds that a 32-bit integer column could not hold', async () => {
    await seedUser('u3')
    const farFuture = 4_102_444_800 // 2100-01-01
    await database.sql.unsafe(
      `INSERT INTO auth_sessions (id, local_user_id, auth_user_id, access_token, refresh_token, expires_at)
       VALUES ('far', 'u3', 'u3', 't', 't', $1)`,
      [farFuture],
    )
    const row = await m.session.loadAuthSessionRow(visit(), 'far')
    expect(row?.expiresAt).toBe(farFuture)
  })

  it('cascades a user delete through every auth table', async () => {
    await seedUser('u4')
    await database.sql.unsafe(
      `INSERT INTO auth_sessions (id, local_user_id, auth_user_id, access_token, refresh_token, expires_at) VALUES ('s4', 'u4', 'u4', 't', 't', 1);
       INSERT INTO auth_user_links (local_user_id, auth_user_id, primary_email) VALUES ('u4', 'a4', 'u4@example.com');
       INSERT INTO auth_verified_emails (user_id, email, verified_at) VALUES ('u4', 'u4@example.com', 'x');
       INSERT INTO auth_webauthn_credentials (id, user_id, public_key, rp_id) VALUES ('c4', 'u4', 'k', 'example.com');
       INSERT INTO auth_native_sessions (id, user_id, client_id, redirect_uri, code_challenge, code_expires_at, expires_at, created_at)
         VALUES ('n4', 'u4', 'c', 'https://x', 'ch', 1, 1, 1);`,
    )
    await m.coreDb.getDatabaseRow(
      m.coreDb.useDatabase(visit()).delete(m.core.users).where(eq(m.core.users.id, 'u4')),
    )
    for (const table of [
      'auth_sessions',
      'auth_user_links',
      'auth_verified_emails',
      'auth_webauthn_credentials',
      'auth_native_sessions',
    ]) {
      expect(await rows(`SELECT 1 FROM ${table}`)).toHaveLength(0)
    }
  })
})

describe('passkey ceremony storage on PostgreSQL', () => {
  it('issues a challenge once, claims it once and burns it on a purpose mismatch', async () => {
    const event = visit()
    await m.challenges.issueWebauthnChallenge(event, {
      challenge: 'c-1',
      purpose: 'authentication',
      ttlSeconds: 300,
    })
    await m.challenges.issueWebauthnChallenge(event, {
      challenge: 'c-2',
      purpose: 'registration',
      ttlSeconds: 300,
    })
    expect(await rows('SELECT 1 FROM auth_webauthn_challenges')).toHaveLength(2)

    expect(
      await m.challenges.consumeWebauthnChallenge(event, {
        challenge: 'c-1',
        purpose: 'authentication',
      }),
    ).toMatchObject({
      purpose: 'authentication',
      userId: null,
    })
    expect(
      await m.challenges.consumeWebauthnChallenge(event, {
        challenge: 'c-1',
        purpose: 'authentication',
      }),
    ).toBeNull()
    expect(
      await m.challenges.consumeWebauthnChallenge(event, {
        challenge: 'c-2',
        purpose: 'authentication',
      }),
    ).toBeNull()
    expect(await rows('SELECT 1 FROM auth_webauthn_challenges')).toHaveLength(0)
  })

  it('rejects an out-of-enum purpose at the database', async () => {
    await expect(
      database.sql.unsafe(
        `INSERT INTO auth_webauthn_challenges (challenge_hash, purpose, expires_at) VALUES ('h', 'bogus', 1)`,
      ),
    ).rejects.toMatchObject({ code: '23514' })
  })

  it('holds an unsigned 32-bit authenticator counter and a boolean backed_up', async () => {
    await database.sql.unsafe(
      `INSERT INTO users (id, email, created_at, updated_at) VALUES ('pk', 'pk@example.com', 'x', 'x')`,
    )
    const pg = await import('drizzle-orm/postgres-js')
    const { default: postgres } = await import('postgres')
    const client = postgres(database.url, { max: 1, prepare: false })
    const db = pg.drizzle(client, { schema: m.schema })
    await db.insert(m.schema.authWebauthnCredentials).values({
      id: 'cred-1',
      userId: 'pk',
      publicKey: 'pub',
      counter: 4_000_000_000,
      backedUp: true,
      rpId: 'example.com',
    })
    const [row] = await db.select().from(m.schema.authWebauthnCredentials)
    expect(row).toMatchObject({
      counter: 4_000_000_000,
      backedUp: true,
      deviceType: 'singleDevice',
      transports: '[]',
    })
    await client.end()
  })
})

describe('MCP OAuth KV and native sessions on PostgreSQL', () => {
  it('implements Workers KV semantics: put, get, expire, list, claim-once and purge', async () => {
    const db = m.authDb.useAuthBridgeDatabase(visit())
    let now = 1_800_000_000
    const kv = m.kv.createD1KvNamespace(db as never, () => now)

    await kv.put('client:a', JSON.stringify({ n: 1 }), { metadata: { x: 1 } })
    await kv.put('client:a', JSON.stringify({ n: 2 })) // upsert
    await kv.put('grant:1', 'g1', { expirationTtl: 60 })
    await kv.put('grant:2', 'g2', { expiration: now + 3600 })
    expect(await kv.get('client:a', 'json')).toEqual({ n: 2 })
    expect(await kv.get('grant:1')).toBe('g1')

    const listed = await kv.list({ prefix: 'grant:' })
    expect(listed.keys.map((key) => key.name)).toEqual(['grant:1', 'grant:2'])
    expect(listed.keys[1]).toMatchObject({ expiration: now + 3600 })

    expect(await kv.claimOnce('replay:1', 60)).toBe(true)
    expect(await kv.claimOnce('replay:1', 60)).toBe(false)

    now += 120
    expect(await kv.get('grant:1')).toBeNull()
    expect((await kv.list({ prefix: 'grant:' })).keys.map((key) => key.name)).toEqual(['grant:2'])
    await kv.purgeExpired()
    expect(
      (await rows<{ key: string }>('SELECT key FROM auth_oauth_kv ORDER BY key COLLATE "C"')).map(
        (row) => row.key,
      ),
    ).toEqual(['client:a', 'grant:2'])
    await kv.delete('client:a')
    expect(await kv.get('client:a')).toBeNull()
  })

  it('lists a key prefix by bytes, not by the database collation', async () => {
    // The test database is en-US (as the stock postgres image is), where a
    // text range comparison ignores case and punctuation. The store's prefix
    // range and paging must still behave as SQLite's BINARY order does.
    const [{ linguistic }] = await rows<{ linguistic: boolean }>(
      `SELECT (datlocprovider = 'i' OR datcollate NOT IN ('C', 'POSIX')) AS linguistic
       FROM pg_database WHERE datname = current_database()`,
    )
    expect(linguistic).toBe(true)
    const db = m.authDb.useAuthBridgeDatabase(visit())
    const kv = m.kv.createD1KvNamespace(db as never, () => 1_800_000_000)
    const keys = [
      'grant:1',
      'grant:2',
      'Grant:3',
      'grant-2',
      'grant:zzz',
      'grants',
      'grant ',
      'a',
      'B',
    ]
    for (const key of keys) await kv.put(key, key)

    const listed = await kv.list({ prefix: 'grant:' })
    expect(listed.keys.map((key) => key.name)).toEqual(['grant:1', 'grant:2', 'grant:zzz'])

    const first = await kv.list({ limit: 4 })
    expect(first.list_complete).toBe(false)
    const second = await kv.list({ limit: 100, cursor: first.cursor })
    expect([...first.keys, ...second.keys].map((key) => key.name)).toEqual(
      [...keys].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
    )
  })

  it('walks a native PKCE session from code to access to refresh to revocation', async () => {
    await database.sql.unsafe(
      `INSERT INTO users (id, email, created_at, updated_at) VALUES ('nat', 'nat@example.com', 'x', 'x')`,
    )
    let now = 1_800_000_000
    const auth = m.native.createNativeAuth(
      m.authDb.useAuthBridgeDatabase(visit()) as never,
      [{ id: 'ios', redirectUris: ['app.example://callback'] }] as never,
      () => now,
    )
    const verifier = 'v'.repeat(64)
    const challenge = await m.native.nativeAuthDigest(verifier)
    const redirect = await auth.issueCode('nat', {
      clientId: 'ios',
      redirectUri: 'app.example://callback',
      codeChallenge: challenge,
      codeChallengeMethod: 'S256',
      state: 's'.repeat(32),
    } as never)
    const code = new URL(redirect).searchParams.get('code')!

    const tokens = await auth.exchange({
      clientId: 'ios',
      code,
      codeVerifier: verifier,
      redirectUri: 'app.example://callback',
    })
    expect(tokens.tokenType).toBe('Bearer')
    expect(await auth.resolve(tokens.accessToken)).toMatchObject({ userId: 'nat', clientId: 'ios' })
    // A code redeems once.
    await expect(
      auth.exchange({
        clientId: 'ios',
        code,
        codeVerifier: verifier,
        redirectUri: 'app.example://callback',
      }),
    ).rejects.toMatchObject({ statusCode: 401 })

    now += 10
    const refreshed = await auth.refresh({ clientId: 'ios', refreshToken: tokens.refreshToken })
    expect(await auth.resolve(tokens.accessToken)).toBeNull() // rotated
    expect(await auth.resolve(refreshed.accessToken)).not.toBeNull()
    await auth.revokeUser('nat')
    expect(await auth.resolve(refreshed.accessToken)).toBeNull()
    const [row] = await rows<{ access_hash: string | null; revoked_at: string }>(
      'SELECT revoked_at, access_hash FROM auth_native_sessions',
    )
    expect(Number(row!.revoked_at)).toBe(now)
    expect(row!.access_hash).toBeNull()
  })
})

const OWNER = 'owner'

describe('core tables the auth module leans on, on PostgreSQL', () => {
  async function seedOwner() {
    await database.sql.unsafe(
      `INSERT INTO users (id, email, is_admin, created_at, updated_at) VALUES ('${OWNER}', 'o@example.com', true, 'x', 'x')`,
    )
  }
  const bearer = (rawKey: string) => {
    const event = visit({ path: '/api/things' })
    event.node.req.headers.authorization = `Bearer ${rawKey}`
    return event
  }

  it('authenticates an API key, stamps last_used_at once, honours expiry and revocation', async () => {
    await seedOwner()
    const { rawKey, keyHash, keyPrefix } = await m.coreAuth.generateApiKey()
    await database.sql.unsafe(
      `INSERT INTO api_keys (id, user_id, name, key_hash, key_prefix, scopes_json, created_at)
       VALUES ('k1', '${OWNER}', 'ci', $1, $2, '["a:read"]', 'x')`,
      [keyHash, keyPrefix],
    )

    const found = await m.coreAuth.authenticateApiKey(bearer(rawKey))
    expect(found).toMatchObject({ scopes: ['a:read'], user: { id: OWNER, isAdmin: true } })
    await vi.waitFor(async () => {
      const [row] = await rows<{ last_used_at: string | null }>(
        "SELECT last_used_at FROM api_keys WHERE id = 'k1'",
      )
      expect(row!.last_used_at).not.toBeNull()
    })
    expect(await m.coreAuth.authenticateApiKey(bearer('nk_' + '0'.repeat(64)))).toBeNull()

    await database.sql.unsafe("UPDATE api_keys SET expires_at = 1 WHERE id = 'k1'")
    expect(await m.coreAuth.authenticateApiKey(bearer(rawKey))).toBeNull()
    await database.sql.unsafe("UPDATE api_keys SET expires_at = 4102444800 WHERE id = 'k1'")
    expect(await m.coreAuth.authenticateApiKey(bearer(rawKey))).not.toBeNull()

    const db = m.coreDb.useDatabase(visit())
    expect(await m.coreAuth.revokeApiKey(db, 'k1', { userId: 'someone-else' })).toBe(false)
    expect(await m.coreAuth.revokeApiKey(db, 'k1', { userId: OWNER })).toBe(true)
    expect(await m.coreAuth.revokeApiKey(db, 'k1')).toBe(false)
    expect(await m.coreAuth.authenticateApiKey(bearer(rawKey))).toBeNull()
  })

  it('rejects a second API key row with the same hash (unique index)', async () => {
    await seedOwner()
    await database.sql.unsafe(
      `INSERT INTO api_keys (id, user_id, name, key_hash, key_prefix, created_at) VALUES ('a', '${OWNER}', 'n', 'h', 'p', 'x')`,
    )
    await expect(
      database.sql.unsafe(
        `INSERT INTO api_keys (id, user_id, name, key_hash, key_prefix, created_at) VALUES ('b', '${OWNER}', 'n', 'h', 'p', 'x')`,
      ),
    ).rejects.toMatchObject({ code: '23505' })
  })

  it('creates, lists, counts, marks read and deletes notifications with real booleans', async () => {
    await seedOwner()
    const event = visit({ path: '/api/notifications' })
    const first = await m.notifications.createNotification(event, {
      userId: OWNER,
      kind: 'info',
      title: 'One',
      body: 'b',
    })
    await m.notifications.createNotification(event, {
      userId: OWNER,
      kind: 'info',
      title: 'Two',
      body: 'b',
    })
    expect(await m.notifications.getUnreadCount(event, OWNER)).toBe(2)
    expect(
      await m.notifications.getUserNotifications(event, OWNER, { unreadOnly: true, limit: 1 }),
    ).toHaveLength(1)

    await m.notifications.markNotificationAsRead(event, first, OWNER)
    expect(await m.notifications.getUnreadCount(event, OWNER)).toBe(1)
    await expect(
      m.notifications.markNotificationAsRead(event, first, 'intruder'),
    ).rejects.toMatchObject({ statusCode: 404 })
    await m.notifications.markAllNotificationsAsRead(event, OWNER)
    expect(await m.notifications.getUnreadCount(event, OWNER)).toBe(0)
    const listed = await m.notifications.getUserNotifications(event, OWNER)
    expect(listed.every((row) => row.isRead === true && typeof row.readAt === 'string')).toBe(true)
    await m.notifications.deleteNotification(event, first, OWNER)
    expect(await rows('SELECT 1 FROM notifications')).toHaveLength(1)
  })

  it('opens and resolves a core session by cookie, ignoring an expired one', async () => {
    await seedOwner()
    const opened = visit({ path: '/login' })
    const id = await m.coreAuth.createSession(opened, OWNER)
    const cookieName = 'app_session'
    const read = visit({ cookie: `${cookieName}=${id}` })
    expect(await m.coreAuth.getSessionUser(read)).toMatchObject({ id: OWNER })
    await database.sql.unsafe('UPDATE sessions SET expires_at = 1')
    expect(await m.coreAuth.getSessionUser(visit({ cookie: `${cookieName}=${id}` }))).toBeNull()
  })
})
