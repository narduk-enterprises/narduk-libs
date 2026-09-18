/**
 * Migration 0006 on the real D1 driver: it applies after every earlier core
 * migration, re-applies cleanly, and turns the api_keys listing and the
 * sessions cascade lookup from full scans into index searches.
 *
 * The query checked for api_keys is the one narduk-auth's
 * `GET /api/auth/api-keys` builds — the same drizzle expression, rendered with
 * `toSQL()` — so a change to how drizzle renders it is checked too.
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
const MIGRATION_0006 = fileURLToPath(
  new URL('../runtime/drizzle/0006_user_id_indexes.sql', import.meta.url),
)
const BEFORE_0006 = [
  '0000_initial_schema.sql',
  '0001_kv_cache.sql',
  '0002_api_keys.sql',
  '0003_notifications.sql',
  '0004_api_key_scopes.sql',
  '0005_system_prompts.sql',
].map((name) => fileURLToPath(new URL(`../runtime/drizzle/${name}`, import.meta.url)))

const SESSIONS_CASCADE_LOOKUP = 'SELECT 1 FROM sessions WHERE user_id = ?'

describe('0006_user_id_indexes', () => {
  let current: D1QueryHarness
  let previous: D1QueryHarness
  let apiKeysListing: { params: unknown[]; sql: string }

  beforeAll(async () => {
    current = await createD1QueryHarness({ migrations: MIGRATIONS_DIR })
    previous = await createD1QueryHarness({ migrations: BEFORE_0006 })
    apiKeysListing = drizzle(current.db)
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.userId, 'user-1'))
      .toSQL()
  })

  afterAll(async () => {
    await current.dispose()
    await previous.dispose()
  })

  it('applies after every earlier core migration and creates both indexes', async () => {
    const indexes = await current.raw
      .prepare(
        "SELECT tbl_name, name FROM sqlite_master WHERE type = 'index' AND name LIKE '%_user_id_idx' ORDER BY name",
      )
      .all<{ name: string; tbl_name: string }>()

    expect(indexes.results).toEqual([
      { name: 'api_keys_user_id_idx', tbl_name: 'api_keys' },
      { name: 'sessions_user_id_idx', tbl_name: 'sessions' },
    ])
  })

  it('re-applies without error (IF NOT EXISTS)', async () => {
    const statements = splitSqlStatements(readFileSync(MIGRATION_0006, 'utf8'))
    expect(statements).toHaveLength(2)
    await current.raw.batch(statements.map((statement) => current.raw.prepare(statement)))
  })

  it('lists a user’s API keys with an index search, not a scan', async () => {
    const plan = await expectQueryPlan(current, apiKeysListing.sql, apiKeysListing.params, {
      forbidFullScanOf: ['api_keys'],
    })
    expect(plan.join('\n')).toMatch(/SEARCH api_keys USING INDEX api_keys_user_id_idx/u)
  })

  it('finds a user’s sessions (the ON DELETE CASCADE lookup) with an index search', async () => {
    const plan = await expectQueryPlan(current, SESSIONS_CASCADE_LOOKUP, ['user-1'], {
      forbidFullScanOf: ['sessions'],
    })
    expect(plan.join('\n')).toMatch(
      /SEARCH sessions USING (?:COVERING )?INDEX sessions_user_id_idx/u,
    )
  })

  it('scanned both tables before 0006 (control: the plan check can fail)', async () => {
    await expect(
      expectQueryPlan(previous, apiKeysListing.sql, apiKeysListing.params, {
        forbidFullScanOf: ['api_keys'],
      }),
    ).rejects.toThrow(/SCAN api_keys/u)
    await expect(
      expectQueryPlan(previous, SESSIONS_CASCADE_LOOKUP, ['user-1'], {
        forbidFullScanOf: ['sessions'],
      }),
    ).rejects.toThrow(/SCAN sessions/u)
  })
})
