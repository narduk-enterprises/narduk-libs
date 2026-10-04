/**
 * `authenticateApiKey` answers every key the same way whether it reads the key
 * and its user in two statements or in one (narduk-libs#1396), on the real D1
 * driver.
 *
 * The table pins each outcome: the success row, and every refusal the function
 * can make (unknown key, revoked key, expired key, a key whose user row is
 * gone, and a revoked key whose user row is gone). A refusal returns `null`,
 * never a distinct error, so the boundary reports the same 401 for all of them.
 * The statement-count test pins that the lookup is one read.
 */
import { fileURLToPath } from 'node:url'

import { drizzle } from 'drizzle-orm/d1'
import { createEvent } from 'h3'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { createD1QueryHarness } from '../../../tooling/narduk-testkit/src/d1'
import * as schema from '../runtime/server/database/schema'
import { authenticateApiKey } from '../runtime/server/utils/auth'
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

const HARNESS_TIMEOUT_MS = 30_000
const MIGRATIONS_DIR = fileURLToPath(new URL('../runtime/drizzle', import.meta.url))

const RAW_KEY = `nk_${'c'.repeat(64)}`
const KEY_ID = 'api-key-1'
const USER_ID = 'user-1'
const SCOPES_JSON = JSON.stringify(['control:operator'])
const CREATED_AT = '2026-09-01T00:00:00.000Z'
const PAST_SECONDS = Math.floor(Date.now() / 1000) - 3600
const FUTURE_SECONDS = Math.floor(Date.now() / 1000) + 3600

interface Case {
  name: string
  /** Rows to seed; the default seeds a live key and its user. */
  expiresAt?: number | null
  keyHash?: 'unknown'
  orphan?: boolean
  revoked?: boolean
  expect: 'authenticated' | 'refused'
}

const CASES: Case[] = [
  { name: 'a live key with its user', expect: 'authenticated' },
  {
    name: 'a live key that has not reached its expiry',
    expiresAt: FUTURE_SECONDS,
    expect: 'authenticated',
  },
  { name: 'an unknown key', keyHash: 'unknown', expect: 'refused' },
  { name: 'a revoked key whose user exists', revoked: true, expect: 'refused' },
  { name: 'an expired key whose user exists', expiresAt: PAST_SECONDS, expect: 'refused' },
  { name: 'a live key whose user row is missing', orphan: true, expect: 'refused' },
  {
    name: 'a revoked key whose user row is missing',
    orphan: true,
    revoked: true,
    expect: 'refused',
  },
]

function bearerEvent(db: LayerDatabase): H3Event {
  const request = {
    headers: { authorization: `Bearer ${RAW_KEY}` },
    method: 'GET',
    url: '/api/protected',
  } as unknown as IncomingMessage
  const response = { setHeader: vi.fn() } as unknown as ServerResponse
  const event = createEvent(request, response)
  ;(event.context as { _db?: LayerDatabase })._db = db
  return event
}

async function seed(harness: D1QueryHarness, testCase: Case): Promise<void> {
  const keyHash =
    testCase.keyHash === 'unknown'
      ? await hashApiKeyText(`nk_${'d'.repeat(64)}`)
      : await hashApiKeyText(RAW_KEY)
  await harness.raw.batch([
    harness.raw
      .prepare(
        'INSERT INTO users (id, email, name, is_admin, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .bind(USER_ID, 'owner@example.com', 'Owner', 1, CREATED_AT, CREATED_AT),
    harness.raw
      .prepare(
        `INSERT INTO api_keys (id, user_id, name, key_hash, key_prefix, scopes_json, expires_at, revoked_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        KEY_ID,
        USER_ID,
        'operator',
        keyHash,
        RAW_KEY.slice(0, 11),
        SCOPES_JSON,
        testCase.expiresAt ?? null,
        testCase.revoked ? '2026-09-24T12:00:00.000Z' : null,
        CREATED_AT,
      ),
  ])
  if (testCase.orphan) {
    // The key's user is gone, as after a restore or an unenforced delete.
    await harness.raw.prepare('DELETE FROM users WHERE id = ?').bind(USER_ID).run()
    const left = await harness.raw
      .prepare(
        'SELECT (SELECT COUNT(*) FROM api_keys) AS keys, (SELECT COUNT(*) FROM users) AS users',
      )
      .first<{ keys: number; users: number }>()
    expect(left).toEqual({ keys: 1, users: 0 })
  }
}

/**
 * The migrated `api_keys.user_id` cascades on delete, so a key can never
 * outlive its user there. Rebuild the table without that one foreign key so
 * the orphan rows exist; every column and the unique hash index are kept.
 */
async function dropApiKeyUserForeignKey(harness: D1QueryHarness): Promise<void> {
  await harness.raw.batch(
    [
      'DROP TABLE api_keys',
      `CREATE TABLE api_keys (
        id text PRIMARY KEY NOT NULL,
        user_id text NOT NULL,
        name text NOT NULL,
        key_hash text NOT NULL,
        key_prefix text NOT NULL,
        last_used_at text,
        expires_at integer,
        created_at text NOT NULL,
        scopes_json text NOT NULL DEFAULT '[]',
        revoked_at text
      )`,
      'CREATE UNIQUE INDEX api_keys_key_hash_idx ON api_keys (key_hash)',
    ].map((statement) => harness.raw.prepare(statement)),
  )
}

describe('authenticateApiKey answers', () => {
  let harness: D1QueryHarness
  let db: LayerDatabase

  beforeAll(async () => {
    harness = await createD1QueryHarness({ migrations: MIGRATIONS_DIR })
    await dropApiKeyUserForeignKey(harness)
    db = drizzle(harness.db, { schema })
  }, HARNESS_TIMEOUT_MS)

  afterAll(async () => {
    await harness.dispose()
  })

  beforeEach(async () => {
    await harness.clearData()
    harness.reset()
  })

  it.each(CASES)('$name: $expect', async (testCase) => {
    await seed(harness, testCase)
    const result = await authenticateApiKey(bearerEvent(db))

    if (testCase.expect === 'refused') {
      expect(result).toBeNull()
      return
    }

    expect(result).toMatchObject({
      apiKey: { id: KEY_ID, userId: USER_ID, revokedAt: null },
      scopes: ['control:operator'],
      user: { id: USER_ID, email: 'owner@example.com', name: 'Owner', isAdmin: true },
    })
  })
})
