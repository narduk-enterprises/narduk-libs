import { DatabaseSync } from 'node:sqlite'

import bcrypt from 'bcryptjs'
import { drizzle } from 'drizzle-orm/sqlite-proxy'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { H3Event } from 'h3'

/**
 * An app moving off Supabase imports `auth.users.encrypted_password` (bcrypt) into
 * `users.password_hash`. Local sign-in verifies it, rewrites the row as PBKDF2 in the
 * same request, and treats a failed check exactly like a failed PBKDF2 check. The
 * bcrypt fixtures are generated here; no real user's hash is used.
 */

const state = vi.hoisted(() => ({
  attempts: [] as string[],
  failWrites: false,
  db: null as unknown,
  sessions: [] as Array<{ id: string }>,
  sqlite: null as unknown,
}))

vi.mock('#layer/server/utils/logger', () => {
  const logger = { child: () => logger, debug() {}, error() {}, info() {}, warn() {} }
  return { useLogger: () => logger }
})

vi.mock('#layer/server/utils/database', () => ({
  executeDatabaseQuery: async (query: unknown) => {
    if (
      state.failWrites &&
      (query as { constructor: { name: string } }).constructor.name.includes('Update')
    ) {
      throw new Error('write failed')
    }
    return query
  },
  getDatabaseRow: async (query: unknown) => {
    const rows = (await query) as unknown[]
    return rows[0]
  },
  useDatabase: () => state.db,
}))

vi.mock('#narduk-auth-server/utils/auth-bridge-database', () => ({
  useAuthBridgeDatabase: () => state.db,
}))

vi.mock('../server/utils/verified-email', () => ({
  getLocalEmailVerification: async () => null,
}))

vi.mock('../server/lib/app-auth/session', () => ({
  establishLocalSessionUser: async (_event: unknown, user: { id: string }) => {
    state.sessions.push(user)
    return { id: user.id }
  },
}))

vi.mock('../server/lib/app-auth/local-email-throttle', () => ({
  assertLocalEmailAttemptAllowed: async () => {},
  clearLocalEmailAttempts: async (_event: unknown, kind: string) => {
    state.attempts.push(`clear:${kind}`)
  },
  recordLocalEmailAttemptFailure: async (_event: unknown, kind: string) => {
    state.attempts.push(`fail:${kind}`)
  },
}))

vi.mock('../server/lib/app-auth/supabase-client', () => ({
  getAuthConfig: () => ({ backend: 'local' }),
}))

const EMAIL = 'owner@example.com'
const PASSWORD = 'correct horse battery staple'
const event = { headers: new Headers(), context: {} } as unknown as H3Event
const PBKDF2_SHAPE = /^[0-9a-f]{32}:[0-9a-f]{64}$/u

function sqlite(): DatabaseSync {
  return state.sqlite as DatabaseSync
}

function storedHash(): string {
  const row = sqlite().prepare('SELECT password_hash FROM users WHERE email = ?').get(EMAIL) as {
    password_hash: string
  }
  return row.password_hash
}

function seed(passwordHash: string | null): void {
  sqlite()
    .prepare(
      `INSERT INTO users (id, email, password_hash, created_at, updated_at)
       VALUES ('user-1', ?, ?, '2026-01-01', '2026-01-01')`,
    )
    .run(EMAIL, passwordHash)
}

async function login(password: string) {
  const { loginUser } = await import('../server/lib/app-auth/auth-flows')
  return loginUser(event, { email: EMAIL, password })
}

describe('sign-in with an imported bcrypt hash', () => {
  beforeEach(() => {
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
    state.attempts = []
    state.failWrites = false
    state.sessions = []
  })

  afterEach(() => {
    sqlite().close()
  })

  it.each(['$2a$', '$2b$', '$2y$'])(
    'signs in with a %s hash and rewrites the row as PBKDF2',
    async (prefix) => {
      const bcryptHash = (await bcrypt.hash(PASSWORD, 10)).replace(/^\$2[aby]\$/u, prefix)
      seed(bcryptHash)

      const result = await login(PASSWORD)

      expect(result).toMatchObject({ nextStep: 'signed_in', user: { id: 'user-1' } })
      expect(state.attempts).toEqual(['clear:login'])
      expect(storedHash()).toMatch(PBKDF2_SHAPE)

      // The rewritten hash is a working PBKDF2 hash; the second sign-in never needs bcrypt.
      state.sessions = []
      await expect(login(PASSWORD)).resolves.toMatchObject({ nextStep: 'signed_in' })
      await expect(login('wrong password')).rejects.toMatchObject({ statusCode: 401 })
    },
  )

  it('rejects a wrong password like a failed PBKDF2 check and leaves the bcrypt hash alone', async () => {
    const bcryptHash = await bcrypt.hash(PASSWORD, 10)
    seed(bcryptHash)

    await expect(login('wrong password')).rejects.toMatchObject({
      statusCode: 401,
      statusMessage: 'Invalid email or password',
    })

    expect(state.attempts).toEqual(['fail:login'])
    expect(state.sessions).toEqual([])
    expect(storedHash()).toBe(bcryptHash)
  })

  it.each([
    ['truncated', '$2b$10$abcdefghijklmnopqrstuv'],
    ['bad alphabet', `$2b$10$${'!'.repeat(53)}`],
    ['unknown minor version', `$2x$10$${'a'.repeat(53)}`],
    ['cost above the cap', `$2b$31$${'a'.repeat(53)}`],
    ['prefix only', '$2b$'],
  ])('fails closed on a malformed hash (%s)', async (_label, malformed) => {
    seed(malformed)

    await expect(login(PASSWORD)).rejects.toMatchObject({
      statusCode: 401,
      statusMessage: 'Invalid email or password',
    })

    expect(state.attempts).toEqual(['fail:login'])
    expect(state.sessions).toEqual([])
    expect(storedHash()).toBe(malformed)
  })

  it('keeps PBKDF2 hashes working unchanged', async () => {
    const { hashUserPassword } = await import('../../narduk-core/runtime/server/utils/password')
    const pbkdf2 = await hashUserPassword(PASSWORD)
    seed(pbkdf2)

    await expect(login('wrong password')).rejects.toMatchObject({ statusCode: 401 })
    expect(state.attempts).toEqual(['fail:login'])

    await expect(login(PASSWORD)).resolves.toMatchObject({ nextStep: 'signed_in' })
    expect(storedHash()).toBe(pbkdf2)
  })

  it('still signs in when the PBKDF2 rewrite cannot be written, and keeps the bcrypt hash', async () => {
    const bcryptHash = await bcrypt.hash(PASSWORD, 10)
    seed(bcryptHash)
    state.failWrites = true

    await expect(login(PASSWORD)).resolves.toMatchObject({ nextStep: 'signed_in' })

    expect(storedHash()).toBe(bcryptHash)
  })

  it('does not overwrite a password changed between the check and the rewrite', async () => {
    const bcryptHash = await bcrypt.hash(PASSWORD, 10)
    seed(bcryptHash)
    const { upgradeImportedPasswordHash } = await import('../server/lib/app-auth/auth-flows')
    sqlite()
      .prepare('UPDATE users SET password_hash = ?')
      .run('0'.repeat(32) + ':' + '1'.repeat(64))

    await upgradeImportedPasswordHash(event, 'user-1', bcryptHash, PASSWORD)

    expect(storedHash()).toBe('0'.repeat(32) + ':' + '1'.repeat(64))
  })

  it('treats an unknown account like a failed check', async () => {
    await expect(login(PASSWORD)).rejects.toMatchObject({ statusCode: 401 })
    expect(state.attempts).toEqual(['fail:login'])
  })
})
