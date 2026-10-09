/**
 * Cache versions on the real D1 driver (narduk-libs#1716).
 *
 * `readCacheVersion` / `bumpCacheVersion` / `prepareCacheVersionBump` keep one
 * row per name in the `kv_cache` table core already migrates, and
 * `withWorkerCache` keyed on that version re-reads D1 only when a write bumps
 * it.
 */
import { fileURLToPath } from 'node:url'

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { createD1QueryHarness } from '../../../tooling/narduk-testkit/src/d1'
import { resetWorkerCacheStore } from '../runtime/internal/worker-cache-store'
import { cleanExpiredCache } from '../runtime/server/utils/d1Cache'
import {
  bumpCacheVersion,
  prepareCacheVersionBump,
  readCacheVersion,
  withWorkerCache,
} from '../runtime/server/utils/workerCache'

import type { D1QueryHarness } from '../../../tooling/narduk-testkit/src/d1'
import type { H3Event } from 'h3'

vi.mock('nitropack/runtime', () => ({ useRuntimeConfig: () => ({}) }))

const HARNESS_TIMEOUT_MS = 30_000
const MIGRATIONS_DIR = fileURLToPath(new URL('../runtime/drizzle', import.meta.url))

describe('cache versions on D1', () => {
  let harness: D1QueryHarness
  let db: D1Database

  beforeAll(async () => {
    harness = await createD1QueryHarness({ migrations: MIGRATIONS_DIR })
    db = harness.db as unknown as D1Database
  }, HARNESS_TIMEOUT_MS)

  afterAll(async () => {
    await harness.dispose()
  })

  beforeEach(async () => {
    await harness.clearData()
    harness.reset()
    resetWorkerCacheStore()
  })

  it('reads 0 for a name that was never bumped', async () => {
    await expect(readCacheVersion(db, 'stations')).resolves.toBe('0')
  })

  it('counts up one per bump and keeps names apart', async () => {
    await expect(bumpCacheVersion(db, 'stations')).resolves.toBe('1')
    await expect(bumpCacheVersion(db, 'stations')).resolves.toBe('2')
    await expect(bumpCacheVersion(db, 'orders')).resolves.toBe('1')
    await expect(readCacheVersion(db, 'stations')).resolves.toBe('2')
  })

  it('reads a version with one primary-key lookup', async () => {
    await readCacheVersion(db, 'stations')
    expect(harness.statements).toHaveLength(1)
    const plan = await harness.raw
      .prepare('EXPLAIN QUERY PLAN SELECT value FROM kv_cache WHERE key = ?')
      .bind('cache-version:stations')
      .all<{ detail: string }>()
    expect(plan.results.map((row) => row.detail).join(' ')).toMatch(
      /SEARCH kv_cache USING .*INDEX .*\(key=\?\)/,
    )
  })

  it('bumps atomically with the write it covers', async () => {
    await harness.raw.exec('CREATE TABLE IF NOT EXISTS stations (id TEXT PRIMARY KEY, status TEXT)')
    await db.batch([
      db.prepare('INSERT INTO stations (id, status) VALUES (?, ?)').bind('s1', 'open'),
      prepareCacheVersionBump(db, 'stations'),
    ])
    await expect(readCacheVersion(db, 'stations')).resolves.toBe('1')

    await expect(
      db.batch([
        db.prepare('INSERT INTO stations (id, status) VALUES (?, ?)').bind('s1', 'dup'),
        prepareCacheVersionBump(db, 'stations'),
      ]),
    ).rejects.toThrow()
    await expect(readCacheVersion(db, 'stations')).resolves.toBe('1')
  })

  it('survives the expired-row sweep', async () => {
    await bumpCacheVersion(db, 'stations')
    await db
      .prepare('INSERT INTO kv_cache (key, value, expires_at) VALUES (?, ?, ?)')
      .bind('weather:austin', '{}', 1)
      .run()
    const event = { context: { cloudflare: { env: { DB: db } } } } as unknown as H3Event
    await expect(cleanExpiredCache(event)).resolves.toBe(1)
    await expect(readCacheVersion(db, 'stations')).resolves.toBe('1')
  })

  it('rejects an empty name', async () => {
    await expect(readCacheVersion(db, '')).rejects.toThrow(/name/)
    expect(() => prepareCacheVersionBump(db, '')).toThrow(/name/)
  })

  it('re-runs the D1 read only after a write bumps the version', async () => {
    await harness.raw.exec('CREATE TABLE IF NOT EXISTS stations (id TEXT PRIMARY KEY, status TEXT)')
    await db.prepare('INSERT INTO stations (id, status) VALUES (?, ?)').bind('s1', 'open').run()
    const event = { context: {}, method: 'GET', path: '/api/stations' } as unknown as H3Event
    let reads = 0
    const listStations = async () => {
      reads += 1
      const { results } = await db.prepare('SELECT id, status FROM stations ORDER BY id').all()
      return results
    }
    const read = () =>
      withWorkerCache(
        event,
        {
          freshSeconds: 300,
          key: 'stations:list',
          scope: 'private',
          version: () => readCacheVersion(db, 'stations'),
        },
        listStations,
      )

    await expect(read()).resolves.toEqual([{ id: 's1', status: 'open' }])
    await read()
    await read()
    expect(reads).toBe(1)

    await db.batch([
      db.prepare('UPDATE stations SET status = ? WHERE id = ?').bind('closed', 's1'),
      prepareCacheVersionBump(db, 'stations'),
    ])
    await expect(read()).resolves.toEqual([{ id: 's1', status: 'closed' }])
    expect(reads).toBe(2)
    await read()
    expect(reads).toBe(2)
  })
})
