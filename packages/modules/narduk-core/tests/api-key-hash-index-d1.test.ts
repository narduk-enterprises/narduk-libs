/**
 * Migration 0007 on the real D1 driver: it applies after every earlier core
 * migration, re-applies cleanly, and turns both API-key authentication
 * lookups from full scans of api_keys into index searches (narduk-libs#168).
 *
 * The drizzle lookup is `authenticateApiKey`'s expression, rendered with
 * `toSQL()`. The raw one is `authenticateD1ApiKey`'s statement.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  createD1QueryHarness,
  expectQueryPlan,
  splitSqlStatements,
} from '../../../tooling/narduk-testkit/src/d1'
import { apiKeys } from '../runtime/server/database/schema'

import type { D1QueryHarness } from '../../../tooling/narduk-testkit/src/d1'

const MIGRATIONS_DIR = fileURLToPath(new URL('../runtime/drizzle', import.meta.url))
const MIGRATION_0007 = fileURLToPath(
  new URL('../runtime/drizzle/0007_api_key_hash_index.sql', import.meta.url),
)
const BEFORE_0007 = [
  '0000_initial_schema.sql',
  '0001_kv_cache.sql',
  '0002_api_keys.sql',
  '0003_notifications.sql',
  '0004_api_key_scopes.sql',
  '0005_system_prompts.sql',
  '0006_user_id_indexes.sql',
].map((name) => fileURLToPath(new URL(`../runtime/drizzle/${name}`, import.meta.url)))

const D1_API_KEY_LOOKUP = `SELECT api_keys.id, users.id
  FROM api_keys
  INNER JOIN users ON users.id = api_keys.user_id
  WHERE api_keys.key_hash = ?
  LIMIT 1`
const KEY_HASH = 'a'.repeat(64)
const INDEX_SEARCH = /SEARCH api_keys USING INDEX api_keys_key_hash_idx \(key_hash=\?\)/u

describe('0007_api_key_hash_index', () => {
  let current: D1QueryHarness
  let previous: D1QueryHarness
  let drizzleLookup: { params: unknown[]; sql: string }

  beforeAll(async () => {
    current = await createD1QueryHarness({ migrations: MIGRATIONS_DIR })
    previous = await createD1QueryHarness({ migrations: BEFORE_0007 })
    drizzleLookup = drizzle(current.db)
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.keyHash, KEY_HASH))
      .limit(1)
      .toSQL()
  })

  afterAll(async () => {
    await current.dispose()
    await previous.dispose()
  })

  it('applies after every earlier core migration and creates a unique index', async () => {
    const index = await current.raw
      .prepare("SELECT tbl_name, sql FROM sqlite_master WHERE name = 'api_keys_key_hash_idx'")
      .first<{ sql: string; tbl_name: string }>()

    expect(index?.tbl_name).toBe('api_keys')
    expect(index?.sql).toMatch(/^CREATE UNIQUE INDEX/u)
  })

  it('re-applies without error (IF NOT EXISTS)', async () => {
    const statements = splitSqlStatements(readFileSync(MIGRATION_0007, 'utf8'))
    expect(statements).toHaveLength(1)
    await current.raw.batch(statements.map((statement) => current.raw.prepare(statement)))
  })

  it("finds authenticateApiKey's key with an index search, not a scan", async () => {
    const plan = await expectQueryPlan(current, drizzleLookup.sql, drizzleLookup.params, {
      forbidFullScanOf: ['api_keys'],
    })
    expect(plan.join('\n')).toMatch(INDEX_SEARCH)
  })

  it("finds authenticateD1ApiKey's key with an index search, not a scan", async () => {
    const plan = await expectQueryPlan(current, D1_API_KEY_LOOKUP, [KEY_HASH], {
      forbidFullScanOf: ['api_keys'],
    })
    expect(plan.join('\n')).toMatch(INDEX_SEARCH)
  })

  it('scanned api_keys before 0007 (control: the plan check can fail)', async () => {
    await expect(
      expectQueryPlan(previous, drizzleLookup.sql, drizzleLookup.params, {
        forbidFullScanOf: ['api_keys'],
      }),
    ).rejects.toThrow(/SCAN api_keys/u)
    await expect(
      expectQueryPlan(previous, D1_API_KEY_LOOKUP, [KEY_HASH], {
        forbidFullScanOf: ['api_keys'],
      }),
    ).rejects.toThrow(/SCAN api_keys/u)
  })
})
