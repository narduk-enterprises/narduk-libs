/**
 * The personal API-key routes revoke instead of deleting (narduk-libs#806).
 *
 * `DELETE /api/auth/api-keys/:id` calls narduk-core's real `revokeApiKey`, so
 * the row survives with `revoked_at` set, and `GET /api/auth/api-keys` stops
 * listing it. Both run against a real Miniflare D1 database built from
 * narduk-core's own migrations.
 */
import { fileURLToPath } from 'node:url'

import { drizzle } from 'drizzle-orm/d1'
import { createEvent } from 'h3'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { createD1QueryHarness } from '../../../tooling/narduk-testkit/src/d1'

import type { D1QueryHarness } from '../../../tooling/narduk-testkit/src/d1'
import type { H3Event } from 'h3'
import type { IncomingMessage, ServerResponse } from 'node:http'

const harness = vi.hoisted(() => ({ database: null as unknown }))

vi.mock(
  '#narduk-core/schema',
  async () => await import('@narduk-enterprises/narduk-core/server/database/schema'),
)
vi.mock('#narduk-core/postgres-runtime', () => ({
  createPostgresDatabase: () => {
    throw new Error('Postgres must not be reached')
  },
}))
// The real narduk-core helpers the routes import: revokeApiKey is under test.
vi.mock(
  '#layer/server/utils/auth',
  async () => await import('../../narduk-core/runtime/server/utils/auth'),
)
vi.mock('#layer/server/utils/database', () => ({
  getDatabaseRows: async (query: unknown) => await (query as Promise<unknown[]>),
  useDatabase: () => harness.database,
}))
vi.mock('#layer/server/utils/mutation', () => {
  const capture = (_options: unknown, handler: unknown) => ({ __handler: handler })
  return { defineUserMutation: capture, defineUserQuery: capture }
})

type RouteHandler = (context: { event: H3Event; user: { id: string } }) => Promise<unknown>

// Miniflare start-up is slow on a loaded runner; the default 10 s hook timeout
// is tight for building a D1 database from every migration.
const HARNESS_TIMEOUT_MS = 30_000
const MIGRATIONS = fileURLToPath(new URL('../../narduk-core/runtime/drizzle', import.meta.url))
const OWNER = { id: 'user-1' }
const OTHER = { id: 'user-2' }
const LAST_USED_AT = '2026-09-01T00:00:00.000Z'

function routeEvent(params: Record<string, string> = {}): H3Event {
  const request = { headers: {}, method: 'GET', url: '/' } as unknown as IncomingMessage
  const response = { setHeader: vi.fn() } as unknown as ServerResponse
  const event = createEvent(request, response)
  event.context.params = params
  return event
}

async function route(path: string): Promise<RouteHandler> {
  const module = (await import(path)) as { default: { __handler: RouteHandler } }
  return module.default.__handler
}

describe('API-key routes revoke instead of deleting', () => {
  let d1: D1QueryHarness

  beforeAll(async () => {
    d1 = await createD1QueryHarness({ migrations: MIGRATIONS })
    harness.database = drizzle(d1.db)
  }, HARNESS_TIMEOUT_MS)

  afterAll(() => d1.dispose())

  beforeEach(async () => {
    await d1.clearData()
    const insertKey = (id: string, keyHash: string) =>
      d1.raw
        .prepare(
          `INSERT INTO api_keys (id, user_id, name, key_hash, key_prefix, scopes_json, last_used_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          id,
          OWNER.id,
          id,
          keyHash,
          `nk_${id}`,
          '["registry:read"]',
          LAST_USED_AT,
          LAST_USED_AT,
        )
    await d1.raw.batch([
      d1.raw
        .prepare('INSERT INTO users (id, email, created_at, updated_at) VALUES (?, ?, ?, ?)')
        .bind(OWNER.id, 'owner@example.com', LAST_USED_AT, LAST_USED_AT),
      d1.raw
        .prepare('INSERT INTO users (id, email, created_at, updated_at) VALUES (?, ?, ?, ?)')
        .bind(OTHER.id, 'other@example.com', LAST_USED_AT, LAST_USED_AT),
      insertKey('key-a', 'a'.repeat(64)),
      insertKey('key-b', 'b'.repeat(64)),
    ])
  })

  it('keeps the revoked row with its audit fields and drops it from the list', async () => {
    const revoke = await route('../server/api/auth/api-keys/[id].delete')
    const list = await route('../server/api/auth/api-keys.get')

    await expect(revoke({ event: routeEvent({ id: 'key-a' }), user: OWNER })).resolves.toEqual({
      success: true,
    })

    const row = await d1.raw
      .prepare(
        'SELECT key_prefix, last_used_at, scopes_json, revoked_at FROM api_keys WHERE id = ?',
      )
      .bind('key-a')
      .first<Record<string, string | null>>()
    expect(row).toMatchObject({
      key_prefix: 'nk_key-a',
      last_used_at: LAST_USED_AT,
      scopes_json: '["registry:read"]',
    })
    expect(row?.revoked_at).toMatch(/^\d{4}-\d{2}-\d{2}T/u)

    const listed = (await list({ event: routeEvent(), user: OWNER })) as Array<{ id: string }>
    expect(listed.map((key) => key.id)).toEqual(['key-b'])
  })

  it('answers 404 for an already-revoked key and for another user', async () => {
    const revoke = await route('../server/api/auth/api-keys/[id].delete')

    await revoke({ event: routeEvent({ id: 'key-a' }), user: OWNER })
    await expect(revoke({ event: routeEvent({ id: 'key-a' }), user: OWNER })).rejects.toMatchObject(
      { statusCode: 404 },
    )
    await expect(revoke({ event: routeEvent({ id: 'key-b' }), user: OTHER })).rejects.toMatchObject(
      { statusCode: 404 },
    )

    const liveKeyB = await d1.raw
      .prepare('SELECT revoked_at FROM api_keys WHERE id = ?')
      .bind('key-b')
      .first<{ revoked_at: string | null }>()
    expect(liveKeyB?.revoked_at).toBeNull()
  })
})
