/**
 * API-key revocation keeps the row (narduk-libs#806), on the real D1 driver.
 *
 * Migration 0008 adds `api_keys.revoked_at`. `revokeApiKey` stamps it instead
 * of deleting the row, so `last_used_at`, `key_prefix` and the scopes survive
 * for audit, and both `authenticateApiKey` (drizzle) and `authenticateD1ApiKey`
 * (raw D1) refuse the key afterwards.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { drizzle } from 'drizzle-orm/d1'
import { createEvent } from 'h3'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { createD1QueryHarness, splitSqlStatements } from '../../../tooling/narduk-testkit/src/d1'
import * as schema from '../runtime/server/database/schema'
import { authenticateApiKey, revokeApiKey } from '../runtime/server/utils/auth'
import { authenticateD1ApiKey } from '../runtime/server/utils/authApiKeyD1'
import { hashApiKeyText } from '../runtime/server/utils/authApiKeyText'

import type { D1QueryHarness } from '../../../tooling/narduk-testkit/src/d1'
import type { LayerDatabase } from '../runtime/server/utils/database'
import type { H3Event } from 'h3'
import type { IncomingMessage, ServerResponse } from 'node:http'

vi.mock('nitropack/runtime', () => ({ useRuntimeConfig: () => ({ databaseBackend: 'd1' }) }))
vi.mock('#narduk-core/postgres-runtime', () => ({
  createPostgresDatabase: () => {
    throw new Error('Postgres must not be reached')
  },
}))
vi.mock('#narduk-core/schema', async () => await import('../runtime/server/database/schema'))

// Miniflare start-up is slow on a loaded runner; the default 10 s hook timeout
// is tight for building a D1 database from every migration.
const HARNESS_TIMEOUT_MS = 30_000
const MIGRATIONS_DIR = fileURLToPath(new URL('../runtime/drizzle', import.meta.url))
const BEFORE_0008 = [
  '0000_initial_schema.sql',
  '0001_kv_cache.sql',
  '0002_api_keys.sql',
  '0003_notifications.sql',
  '0004_api_key_scopes.sql',
  '0005_system_prompts.sql',
  '0006_user_id_indexes.sql',
  '0007_api_key_hash_index.sql',
].map((name) => fileURLToPath(new URL(`../runtime/drizzle/${name}`, import.meta.url)))
const MIGRATION_0008 = fileURLToPath(
  new URL('../runtime/drizzle/0008_api_key_revoked_at.sql', import.meta.url),
)

const RAW_KEY = `nk_${'b'.repeat(64)}`
const KEY_ID = 'api-key-1'
const KEY_PREFIX = RAW_KEY.slice(0, 11)
const SCOPES_JSON = JSON.stringify(['control:operator'])
const LAST_USED_AT = '2026-09-01T00:00:00.000Z'
const OWNER_ID = 'user-1'
const OTHER_USER_ID = 'user-2'

interface ApiKeyRow {
  key_prefix: string
  last_used_at: string | null
  revoked_at: string | null
  scopes_json: string
}

function bearerEvent(db: LayerDatabase): H3Event {
  const request = {
    headers: { authorization: `Bearer ${RAW_KEY}` },
    method: 'GET',
    url: '/api/protected',
  } as unknown as IncomingMessage
  const response = { setHeader: vi.fn() } as unknown as ServerResponse
  const event = createEvent(request, response)
  // useDatabase memoizes on context._db; hand it the harness-backed drizzle.
  ;(event.context as { _db?: LayerDatabase })._db = db
  return event
}

async function seed(harness: D1QueryHarness): Promise<void> {
  const keyHash = await hashApiKeyText(RAW_KEY)
  await harness.raw.batch([
    harness.raw
      .prepare('INSERT INTO users (id, email, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .bind(OWNER_ID, 'owner@example.com', LAST_USED_AT, LAST_USED_AT),
    harness.raw
      .prepare('INSERT INTO users (id, email, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .bind(OTHER_USER_ID, 'other@example.com', LAST_USED_AT, LAST_USED_AT),
    harness.raw
      .prepare(
        `INSERT INTO api_keys (id, user_id, name, key_hash, key_prefix, scopes_json, last_used_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        KEY_ID,
        OWNER_ID,
        'operator',
        keyHash,
        KEY_PREFIX,
        SCOPES_JSON,
        LAST_USED_AT,
        LAST_USED_AT,
      ),
  ])
}

async function readKey(harness: D1QueryHarness): Promise<ApiKeyRow | null> {
  return await harness.raw
    .prepare('SELECT key_prefix, last_used_at, revoked_at, scopes_json FROM api_keys WHERE id = ?')
    .bind(KEY_ID)
    .first<ApiKeyRow>()
}

describe('0008_api_key_revoked_at', () => {
  let previous: D1QueryHarness

  beforeAll(async () => {
    previous = await createD1QueryHarness({ migrations: BEFORE_0008 })
  }, HARNESS_TIMEOUT_MS)

  afterAll(async () => {
    await previous.dispose()
  })

  it('adds a nullable revoked_at that leaves every existing key live', async () => {
    await seed(previous)
    const statements = splitSqlStatements(readFileSync(MIGRATION_0008, 'utf8'))
    expect(statements).toHaveLength(1)
    await previous.raw.batch(statements.map((statement) => previous.raw.prepare(statement)))

    const columns = await previous.raw
      .prepare('SELECT name, type, "notnull" FROM pragma_table_info(\'api_keys\')')
      .all<{ name: string; notnull: number; type: string }>()
    expect(columns.results.find((column) => column.name === 'revoked_at')).toEqual({
      name: 'revoked_at',
      notnull: 0,
      type: 'TEXT',
    })
    await expect(readKey(previous)).resolves.toMatchObject({ revoked_at: null })
  })
})

describe('API-key revocation', () => {
  let harness: D1QueryHarness
  let db: LayerDatabase

  beforeAll(async () => {
    harness = await createD1QueryHarness({ migrations: MIGRATIONS_DIR })
    db = drizzle(harness.db, { schema })
  }, HARNESS_TIMEOUT_MS)

  afterAll(async () => {
    await harness.dispose()
  })

  beforeEach(async () => {
    await harness.clearData()
    await seed(harness)
  })

  it('authenticates a live key through both paths', async () => {
    await expect(authenticateApiKey(bearerEvent(db))).resolves.toMatchObject({
      apiKey: { id: KEY_ID, revokedAt: null },
      user: { id: OWNER_ID },
    })
    await expect(
      authenticateD1ApiKey(harness.raw, RAW_KEY, { updateLastUsed: false }),
    ).resolves.toMatchObject({ ok: true, apiKey: { id: KEY_ID } })
  })

  it('refuses a revoked key and keeps its row and audit trail', async () => {
    const revokedAt = new Date('2026-09-24T12:00:00.000Z')
    await expect(revokeApiKey(db, KEY_ID, { now: revokedAt })).resolves.toBe(true)

    await expect(authenticateApiKey(bearerEvent(db))).resolves.toBeNull()
    await expect(authenticateD1ApiKey(harness.raw, RAW_KEY)).resolves.toEqual({
      ok: false,
      reason: 'revoked',
    })

    // Neither refusal touched last_used_at; the row is intact.
    await expect(readKey(harness)).resolves.toEqual({
      key_prefix: KEY_PREFIX,
      last_used_at: LAST_USED_AT,
      revoked_at: revokedAt.toISOString(),
      scopes_json: SCOPES_JSON,
    })
  })

  it('revokes once: a second call reports false and keeps the first revoked_at', async () => {
    const first = new Date('2026-09-24T12:00:00.000Z')
    await expect(revokeApiKey(db, KEY_ID, { now: first })).resolves.toBe(true)
    await expect(
      revokeApiKey(db, KEY_ID, { now: new Date('2026-09-25T12:00:00.000Z') }),
    ).resolves.toBe(false)
    await expect(readKey(harness)).resolves.toMatchObject({ revoked_at: first.toISOString() })
  })

  it("will not revoke another user's key when userId is given", async () => {
    await expect(revokeApiKey(db, KEY_ID, { userId: OTHER_USER_ID })).resolves.toBe(false)
    await expect(revokeApiKey(db, 'missing-key', { userId: OWNER_ID })).resolves.toBe(false)
    await expect(readKey(harness)).resolves.toMatchObject({ revoked_at: null })

    await expect(revokeApiKey(db, KEY_ID, { userId: OWNER_ID })).resolves.toBe(true)
    await expect(authenticateApiKey(bearerEvent(db))).resolves.toBeNull()
  })
})
