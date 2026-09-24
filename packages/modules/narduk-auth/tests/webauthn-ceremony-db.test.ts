import { readFileSync } from 'node:fs'

import { isoBase64URL } from '@simplewebauthn/server/helpers'
import { drizzle } from 'drizzle-orm/d1'
import { Miniflare } from 'miniflare'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { hashLocalEmailValue } from '../server/lib/app-auth/local-email-core'
import { issueWebauthnChallenge } from '../server/lib/app-auth/webauthn-challenges'

import type { User as LocalUser } from '#narduk-core/schema'
import type { H3Event } from 'h3'

const verifyMocks = vi.hoisted(() => ({
  verifyAuthenticationResponse: vi.fn(),
  verifyRegistrationResponse: vi.fn(),
}))

const harness = vi.hoisted(() => ({
  database: null as unknown,
}))

const SESSION_USER = {
  authMethod: 'session',
  email: 'parent@example.com',
  id: 'user-1',
  isAdmin: false,
  name: 'Parent',
}

vi.mock('#layer/server/utils/database', () => {
  async function runQuery(query: unknown) {
    if (
      query &&
      typeof query === 'object' &&
      'execute' in query &&
      typeof (query as { execute?: unknown }).execute === 'function'
    ) {
      return (query as { execute: () => Promise<unknown> }).execute()
    }
    return query
  }

  return {
    createAppDatabase: () => () => harness.database,
    executeDatabaseQuery: async (query: unknown) => await runQuery(query),
    getDatabaseRow: async (query: unknown) => {
      const result = await runQuery(query)
      return Array.isArray(result) ? result[0] : result
    },
    getDatabaseRows: async (query: unknown) => {
      const result = await runQuery(query)
      return Array.isArray(result) ? result : result == null ? [] : [result]
    },
    useDatabase: () => harness.database,
  }
})

vi.mock('#narduk-auth-server/utils/auth-runtime-env', () => ({
  readAuthRuntimeEnv: () => ({
    AUTH_BACKEND: 'local',
    AUTH_LOCAL_PROVIDERS: 'passkey',
    AUTH_WEBAUTHN_ORIGIN: 'http://localhost',
    AUTH_WEBAUTHN_RP_ID: 'localhost',
  }),
  resolveAuthEnvironmentForEvent: () => ({
    appBackendPreset: 'default',
    authAuthorityUrl: '',
    authBackend: 'local',
    authProviders: ['email', 'passkey'],
    supabasePublishableKey: '',
    supabaseServiceRoleKey: '',
    supabaseUrl: '',
  }),
}))

vi.mock('../server/lib/app-auth/session', () => ({
  establishLocalSessionUser: vi.fn(
    async (_event: H3Event, user: { email: string; id: string }) => ({
      ...SESSION_USER,
      email: user.email,
      id: user.id,
    }),
  ),
}))

vi.mock('@simplewebauthn/server', () => ({
  generateAuthenticationOptions: vi.fn(),
  generateRegistrationOptions: vi.fn(),
  verifyAuthenticationResponse: verifyMocks.verifyAuthenticationResponse,
  verifyRegistrationResponse: verifyMocks.verifyRegistrationResponse,
}))

const { finishPasskeyAuthentication, finishPasskeyRegistration } =
  await import('../server/lib/app-auth/webauthn-core')

const LOCAL_USER: LocalUser = {
  appleId: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  email: 'parent@example.com',
  id: 'user-1',
  isAdmin: false,
  name: 'Parent',
  passwordHash: null,
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const PUBLIC_KEY = isoBase64URL.fromBuffer(new Uint8Array([1, 2, 3, 4]))

function event(): H3Event {
  return { context: {} } as H3Event
}

function statusOf(error: unknown): { statusCode?: number; statusMessage?: string } {
  if (!error || typeof error !== 'object') return {}
  const record = error as { statusCode?: unknown; statusMessage?: unknown }
  return {
    statusCode: typeof record.statusCode === 'number' ? record.statusCode : undefined,
    statusMessage: typeof record.statusMessage === 'string' ? record.statusMessage : undefined,
  }
}

function clientData(challenge: string): string {
  return isoBase64URL.fromBuffer(
    new TextEncoder().encode(
      JSON.stringify({ challenge, origin: 'http://localhost', type: 'webauthn.get' }),
    ),
  )
}

function registrationResponse(challenge: string, id = 'cred-new') {
  return {
    id,
    rawId: id,
    response: {
      attestationObject: 'attestation',
      clientDataJSON: clientData(challenge),
    },
    type: 'public-key' as const,
  }
}

function authenticationResponse(challenge: string, id = 'cred-1') {
  return {
    id,
    rawId: id,
    response: {
      authenticatorData: 'authdata',
      clientDataJSON: clientData(challenge),
      signature: 'signature',
    },
    type: 'public-key' as const,
  }
}

/**
 * D1 rejects comment-only chunks, and `0003_webauthn_credentials.sql` has a
 * semicolon inside a `--` header (`narduk-libs#94); a Postgres-backed`).
 * Strip comments before splitting so only real statements run.
 */
function sqlStatements(source: string): string[] {
  return source
    .split('\n')
    .filter((line) => !/^\s*--/u.test(line))
    .join('\n')
    .split(';')
    .map((statement) => statement.trim())
    .filter((statement) => /^(?:ALTER|CREATE|INSERT)\b/iu.test(statement))
}

function readSql(name: string): string[] {
  return sqlStatements(
    readFileSync(new URL(`../drizzle/${name}`, import.meta.url), { encoding: 'utf8' }),
  )
}

function readCoreSql(name: string): string[] {
  return sqlStatements(
    readFileSync(new URL(`../../narduk-core/runtime/drizzle/${name}`, import.meta.url), {
      encoding: 'utf8',
    }),
  )
}

type D1 = Awaited<ReturnType<Miniflare['getD1Database']>>

describe('passkey ceremony database paths on D1 (narduk-libs#165)', () => {
  const runtime = new Miniflare({
    compatibilityDate: '2026-07-01',
    d1Databases: ['DB'],
    modules: true,
    script: 'export default { fetch() { return new Response("ok") } }',
  })
  let binding: D1

  beforeAll(async () => {
    binding = await runtime.getD1Database('DB')
    for (const statement of [
      ...readCoreSql('0000_initial_schema.sql'),
      ...readSql('0001_auth_bridge.sql'),
      ...readSql('0003_webauthn_credentials.sql'),
    ]) {
      await binding.prepare(statement).run()
    }
    harness.database = drizzle(binding)
  })

  afterAll(() => runtime.dispose())

  beforeEach(async () => {
    verifyMocks.verifyAuthenticationResponse.mockReset()
    verifyMocks.verifyRegistrationResponse.mockReset()
    await binding.prepare('DELETE FROM auth_webauthn_challenges').run()
    await binding.prepare('DELETE FROM auth_webauthn_credentials').run()
    await binding.prepare('DELETE FROM auth_sessions').run()
    await binding.prepare('DELETE FROM auth_user_links').run()
    await binding.prepare('DELETE FROM users').run()
    await binding
      .prepare(
        'INSERT INTO users (id, email, password_hash, name, is_admin, created_at, updated_at) VALUES (?, ?, NULL, ?, 0, ?, ?)',
      )
      .bind(
        LOCAL_USER.id,
        LOCAL_USER.email,
        LOCAL_USER.name,
        LOCAL_USER.createdAt,
        LOCAL_USER.updatedAt,
      )
      .run()
  })

  async function seedCredential(params?: { counter?: number; id?: string }) {
    await binding
      .prepare(
        `INSERT INTO auth_webauthn_credentials (
          id, user_id, public_key, counter, transports, device_type, backed_up, rp_id, name, created_at
        ) VALUES (?, ?, ?, ?, '[]', 'multiDevice', 1, 'localhost', 'YubiKey', ?)`,
      )
      .bind(
        params?.id ?? 'cred-1',
        LOCAL_USER.id,
        PUBLIC_KEY,
        params?.counter ?? 5,
        LOCAL_USER.createdAt,
      )
      .run()
  }

  async function credentialCount(id = 'cred-1'): Promise<number> {
    const row = await binding
      .prepare('SELECT COUNT(*) AS value FROM auth_webauthn_credentials WHERE id = ?')
      .bind(id)
      .first<{ value: number }>()
    return row?.value ?? 0
  }

  async function credentialCounter(id = 'cred-1'): Promise<number> {
    const row = await binding
      .prepare('SELECT counter FROM auth_webauthn_credentials WHERE id = ?')
      .bind(id)
      .first<{ counter: number }>()
    return row?.counter ?? -1
  }

  it('enforces D1 foreign keys so deleting a user cascades passkey and session rows', async () => {
    const pragma = await binding.prepare('PRAGMA foreign_keys').first<Record<string, number>>()
    const flag = pragma ? Object.values(pragma)[0] : undefined
    expect(flag).toBe(1)

    await seedCredential()
    await issueWebauthnChallenge(event(), {
      challenge: 'live-challenge',
      purpose: 'registration',
      ttlSeconds: 300,
      userId: LOCAL_USER.id,
    })
    await binding
      .prepare(
        `INSERT INTO auth_user_links (
          local_user_id, auth_user_id, primary_email, providers_json, created_at, updated_at
        ) VALUES (?, ?, ?, '[]', ?, ?)`,
      )
      .bind(LOCAL_USER.id, 'auth-1', LOCAL_USER.email, LOCAL_USER.createdAt, LOCAL_USER.updatedAt)
      .run()
    await binding
      .prepare(
        `INSERT INTO auth_sessions (
          id, local_user_id, auth_user_id, session_identifier,
          access_token, refresh_token, expires_at, providers_json, recovery_mode,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, '[]', 0, ?, ?)`,
      )
      .bind(
        'sess-1',
        LOCAL_USER.id,
        LOCAL_USER.id,
        'sess-1',
        'access',
        'refresh',
        1_800_000_000,
        LOCAL_USER.createdAt,
        LOCAL_USER.updatedAt,
      )
      .run()

    await binding.prepare('DELETE FROM users WHERE id = ?').bind(LOCAL_USER.id).run()

    expect(await credentialCount()).toBe(0)
    const leftover = await binding
      .prepare(
        `SELECT
          (SELECT COUNT(*) FROM auth_webauthn_challenges) AS challenges,
          (SELECT COUNT(*) FROM auth_sessions) AS sessions,
          (SELECT COUNT(*) FROM auth_user_links) AS links`,
      )
      .first<{ challenges: number; links: number; sessions: number }>()
    expect(leftover).toEqual({ challenges: 0, links: 0, sessions: 0 })

    await binding
      .prepare(
        'INSERT INTO users (id, email, password_hash, name, is_admin, created_at, updated_at) VALUES (?, ?, NULL, ?, 0, ?, ?)',
      )
      .bind(
        LOCAL_USER.id,
        LOCAL_USER.email,
        LOCAL_USER.name,
        LOCAL_USER.createdAt,
        LOCAL_USER.updatedAt,
      )
      .run()

    await expect(
      binding
        .prepare(
          `INSERT INTO auth_webauthn_credentials (
            id, user_id, public_key, counter, transports, device_type, backed_up, rp_id, created_at
          ) VALUES ('orphan', 'missing-user', ?, 0, '[]', 'singleDevice', 0, 'localhost', ?)`,
        )
        .bind(PUBLIC_KEY, LOCAL_USER.createdAt)
        .run(),
    ).rejects.toThrow(/foreign key/iu)
  })

  it('finishPasskeyRegistration returns 409 on a duplicate credential ID instead of rebinding', async () => {
    await seedCredential({ id: 'already-registered' })
    await issueWebauthnChallenge(event(), {
      challenge: 'reg-dup',
      purpose: 'registration',
      ttlSeconds: 300,
      userId: LOCAL_USER.id,
    })
    verifyMocks.verifyRegistrationResponse.mockResolvedValue({
      registrationInfo: {
        credential: {
          counter: 0,
          id: 'already-registered',
          publicKey: new Uint8Array([9, 8, 7]),
          transports: ['internal'],
        },
        credentialBackedUp: false,
        credentialDeviceType: 'singleDevice',
      },
      verified: true,
    })

    try {
      await finishPasskeyRegistration(event(), LOCAL_USER, {
        name: 'Attacker',
        response: registrationResponse('reg-dup', 'already-registered'),
      })
      expect.unreachable('duplicate credential insert must fail')
    } catch (error) {
      expect(statusOf(error)).toEqual({
        statusCode: 409,
        statusMessage: 'This passkey is already registered.',
      })
    }

    const row = await binding
      .prepare('SELECT user_id, name, public_key FROM auth_webauthn_credentials WHERE id = ?')
      .bind('already-registered')
      .first<{ name: string; public_key: string; user_id: string }>()
    expect(row).toEqual({
      name: 'YubiKey',
      public_key: PUBLIC_KEY,
      user_id: LOCAL_USER.id,
    })
  })

  it('lets only one of two concurrent verifies consume the same challenge', async () => {
    await seedCredential()
    await issueWebauthnChallenge(event(), {
      challenge: 'shared-challenge',
      purpose: 'authentication',
      ttlSeconds: 300,
      userId: null,
    })
    verifyMocks.verifyAuthenticationResponse.mockResolvedValue({
      authenticationInfo: {
        credentialBackedUp: true,
        credentialDeviceType: 'multiDevice',
        newCounter: 6,
      },
      verified: true,
    })

    const results = await Promise.allSettled([
      finishPasskeyAuthentication(event(), authenticationResponse('shared-challenge')),
      finishPasskeyAuthentication(event(), authenticationResponse('shared-challenge')),
    ])

    const fulfilled = results.filter((result) => result.status === 'fulfilled')
    const rejected = results.filter((result) => result.status === 'rejected')
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect(
      statusOf(rejected[0] && rejected[0].status === 'rejected' ? rejected[0].reason : null),
    ).toEqual({
      statusCode: 401,
      statusMessage: 'Passkey sign-in failed.',
    })
    expect(await credentialCounter()).toBe(6)

    const hash = await hashLocalEmailValue('webauthn-challenge\u0000shared-challenge')
    const leftover = await binding
      .prepare('SELECT COUNT(*) AS value FROM auth_webauthn_challenges WHERE challenge_hash = ?')
      .bind(hash)
      .first<{ value: number }>()
    expect(leftover?.value).toBe(0)
  })

  it('rejects the loser of a concurrent counter update against the same stale value', async () => {
    await seedCredential({ counter: 5 })
    await issueWebauthnChallenge(event(), {
      challenge: 'counter-a',
      purpose: 'authentication',
      ttlSeconds: 300,
      userId: null,
    })
    await issueWebauthnChallenge(event(), {
      challenge: 'counter-b',
      purpose: 'authentication',
      ttlSeconds: 300,
      userId: null,
    })
    verifyMocks.verifyAuthenticationResponse.mockResolvedValue({
      authenticationInfo: {
        credentialBackedUp: true,
        credentialDeviceType: 'multiDevice',
        newCounter: 6,
      },
      verified: true,
    })

    const results = await Promise.allSettled([
      finishPasskeyAuthentication(event(), authenticationResponse('counter-a')),
      finishPasskeyAuthentication(event(), authenticationResponse('counter-b')),
    ])

    const fulfilled = results.filter((result) => result.status === 'fulfilled')
    const rejected = results.filter((result) => result.status === 'rejected')
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect(
      statusOf(rejected[0] && rejected[0].status === 'rejected' ? rejected[0].reason : null),
    ).toEqual({
      statusCode: 401,
      statusMessage: 'Passkey sign-in failed.',
    })
    expect(await credentialCounter()).toBe(6)
  })
})
