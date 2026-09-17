import { readFileSync } from 'node:fs'

import { drizzle } from 'drizzle-orm/d1'
import { Miniflare } from 'miniflare'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { EXPIRED_AUTH_SESSION_SWEEP_LIMIT } from '../server/lib/app-auth/session'

import type { User as LocalUser } from '#narduk-core/schema'
import type { User as SupabaseUser } from '@supabase/auth-js'
import type { H3Event } from 'h3'

const harness = vi.hoisted(() => ({
  database: null as unknown,
}))

vi.mock('#layer/server/utils/user-session', () => ({
  clearLayerUserSession: vi.fn(),
  getLayerUserSession: vi.fn(),
  replaceLayerUserSession: vi.fn(),
  setLayerUserSession: vi.fn(),
}))

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

const LOCAL_USER: LocalUser = {
  id: 'user-1',
  email: 'parent@example.com',
  name: 'Parent',
  isAdmin: false,
  appleId: null,
  passwordHash: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const AUTH_USER = {
  id: 'auth-1',
  email: 'parent@example.com',
  app_metadata: { provider: 'email', providers: ['email'] },
  user_metadata: {},
} as SupabaseUser

function event(): H3Event {
  return { context: {} } as H3Event
}

function readSql(name: string): string[] {
  return readFileSync(new URL(`../drizzle/${name}`, import.meta.url), { encoding: 'utf8' })
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean)
}

function readCoreSql(name: string): string[] {
  return readFileSync(new URL(`../../narduk-core/runtime/drizzle/${name}`, import.meta.url), {
    encoding: 'utf8',
  })
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean)
}

type D1 = Awaited<ReturnType<Miniflare['getD1Database']>>

describe('expired auth_sessions sweep on login', () => {
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
    ]) {
      await binding.prepare(statement).run()
    }
    harness.database = drizzle(binding)
  })

  afterAll(() => runtime.dispose())

  beforeEach(async () => {
    await binding.prepare('DELETE FROM auth_sessions').run()
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

  async function seedSession(id: string, expiresAt: number) {
    await binding
      .prepare(
        `INSERT INTO auth_sessions (
          id, local_user_id, auth_user_id, session_identifier,
          access_token, refresh_token, expires_at, providers_json, recovery_mode,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, '[]', 0, ?, ?)`,
      )
      .bind(
        id,
        LOCAL_USER.id,
        LOCAL_USER.id,
        id,
        `token-${id}`,
        `refresh-${id}`,
        expiresAt,
        LOCAL_USER.createdAt,
        LOCAL_USER.updatedAt,
      )
      .run()
  }

  async function sessionIds(): Promise<string[]> {
    const { results } = await binding.prepare('SELECT id FROM auth_sessions ORDER BY id').all<{
      id: string
    }>()
    return (results ?? []).map((row) => row.id)
  }

  async function sessionExpiresAt(id: string): Promise<number | undefined> {
    const row = await binding
      .prepare('SELECT expires_at FROM auth_sessions WHERE id = ?')
      .bind(id)
      .first<{ expires_at: number }>()
    return row?.expires_at
  }

  it('deletes a bounded batch of expired rows when a local login writes a session', async () => {
    const now = Math.floor(Date.now() / 1000)
    await seedSession('live-1', now + 3600)
    for (let index = 0; index < EXPIRED_AUTH_SESSION_SWEEP_LIMIT + 3; index += 1) {
      await seedSession(`expired-${String(index).padStart(2, '0')}`, now - 10 - index)
    }

    const { persistLocalAuthSession } = await import('../server/lib/app-auth/session')
    const persisted = await persistLocalAuthSession(event(), LOCAL_USER)

    const ids = await sessionIds()
    const expiredRemaining = ids.filter((id) => id.startsWith('expired-'))

    expect(ids).toContain('live-1')
    expect(ids).toContain(persisted.authSessionId)
    expect(expiredRemaining).toHaveLength(3)
    expect(ids).toHaveLength(5)
  })

  it('does not sweep on a supabase token refresh', async () => {
    const now = Math.floor(Date.now() / 1000)
    await seedSession('refresh-me', now + 3600)
    await seedSession('expired-keep', now - 30)

    const { persistSupabaseSession } = await import('../server/lib/app-auth/session')
    await persistSupabaseSession(event(), {
      authUser: AUTH_USER,
      localUser: LOCAL_USER,
      sessionId: 'refresh-me',
      session: {
        access_token: 'a.eyJhbGciOiJub25lIn0.b',
        refresh_token: 'refresh',
        expires_in: 3600,
        expires_at: now + 3600,
        token_type: 'bearer',
        user: AUTH_USER,
      },
    })

    expect(await sessionIds()).toEqual(['expired-keep', 'refresh-me'])
  })

  it('gives a new supabase session a 30-day absolute expiry, not the access-token TTL', async () => {
    const now = Math.floor(Date.now() / 1000)
    const { persistSupabaseSession } = await import('../server/lib/app-auth/session')
    const persisted = await persistSupabaseSession(event(), {
      authUser: AUTH_USER,
      localUser: LOCAL_USER,
      session: {
        access_token: 'a.eyJhbGciOiJub25lIn0.b',
        refresh_token: 'refresh',
        expires_in: 3600,
        expires_at: now + 3600,
        token_type: 'bearer',
        user: AUTH_USER,
      },
    })

    const expiresAt = await sessionExpiresAt(persisted.authSessionId)
    expect(expiresAt).toBeGreaterThan(now + 29 * 86400)
    expect(expiresAt).toBeLessThanOrEqual(now + 30 * 86400 + 5)
  })
})
