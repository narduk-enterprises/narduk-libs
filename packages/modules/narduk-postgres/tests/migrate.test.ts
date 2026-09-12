import { describe, expect, it } from 'vitest'

import {
  MIGRATION_LOCK_NAMESPACE,
  applyMigrations,
  createMigration,
  createMigrationSet,
  migrationLockKey,
  parseMigrationDirectives,
  planMigrations,
} from '../src/migrate.js'
import { type ProtocolFake, createProtocolFake } from '../src/testing.js'
import type { SqlExecutor } from '../src/types.js'

const CORE = { name: '0001_history_core.sql', sql: 'CREATE TABLE series ();' }
const ROLLUPS = { name: '0002_history_rollups.sql', sql: 'CREATE MATERIALIZED VIEW m AS SELECT 1;' }

/**
 * A fake standing in for a database that has already applied `applied`. It
 * answers the three reads the runner performs -- does the table exist, what is
 * in it, and did the advisory lock succeed -- and records everything else.
 */
function databaseWith(
  applied: Array<{ checksum: string; name: string }>,
  options: { locked?: boolean; tableExists?: boolean } = {},
): ProtocolFake {
  return createProtocolFake()
    .respondTo(/to_regclass/u, [{ exists: options.tableExists ?? applied.length > 0 }])
    .respondTo(
      /FROM schema_migrations/u,
      applied.map((row) => ({ ...row, applied_at: null })),
    )
    .respondTo(/pg_try_advisory_lock/u, [{ locked: options.locked ?? true }])
    .respondTo(/pg_advisory_unlock/u, [{ unlocked: true }])
}

describe('migration sources', () => {
  it('requires NNNN_lower_snake_case.sql', async () => {
    await expect(createMigration({ name: 'core.sql', sql: '' })).rejects.toThrow(
      /MIGRATION_NAME_INVALID/u,
    )
    await expect(createMigration({ name: '0001_History.sql', sql: '' })).rejects.toThrow(
      /MIGRATION_NAME_INVALID/u,
    )
    await expect(createMigration(CORE)).resolves.toMatchObject({ name: CORE.name })
  })

  it('checksums the exact bytes', async () => {
    const first = await createMigration(CORE)
    const again = await createMigration(CORE)
    const changed = await createMigration({ ...CORE, sql: `${CORE.sql}\n` })
    expect(first.checksum).toBe(again.checksum)
    expect(first.checksum).not.toBe(changed.checksum)
    expect(first.checksum).toMatch(/^[0-9a-f]{64}$/u)
  })

  it('sorts by name and refuses a duplicate', async () => {
    const set = await createMigrationSet([ROLLUPS, CORE])
    expect(set.map((migration) => migration.name)).toEqual([CORE.name, ROLLUPS.name])
    await expect(createMigrationSet([CORE, { ...CORE, sql: 'other' }])).rejects.toThrow(
      /MIGRATION_DUPLICATE/u,
    )
  })

  it('reads the no-transaction directive', () => {
    expect(parseMigrationDirectives('SELECT 1').transactional).toBe(true)
    expect(
      parseMigrationDirectives('-- narduk:no-transaction\nCREATE INDEX CONCURRENTLY i ON t (a);')
        .transactional,
    ).toBe(false)
  })

  it('derives a stable, namespaced 32-bit lock pair', () => {
    const key = migrationLockKey()
    expect(key).toEqual(migrationLockKey(MIGRATION_LOCK_NAMESPACE))
    expect(key).not.toEqual(migrationLockKey('another-namespace'))
    for (const part of key) {
      expect(Number.isInteger(part)).toBe(true)
      expect(part).toBeGreaterThanOrEqual(-2_147_483_648)
      expect(part).toBeLessThanOrEqual(2_147_483_647)
    }
  })
})

describe('immutability of an applied migration', () => {
  // mybo-at-v2#81/#82: editing an applied migration left every deployed
  // environment on the old bytes and the next fresh one on the new bytes, with
  // nothing anywhere reporting the fork.
  it('fails when an applied file was edited', async () => {
    const [core] = await createMigrationSet([CORE])
    const database = databaseWith([{ checksum: 'a-different-checksum', name: CORE.name }])
    await expect(planMigrations(database, [core!])).rejects.toThrow(/MIGRATION_MODIFIED/u)
  })

  it('fails when the database applied a migration this artifact does not carry', async () => {
    const [core] = await createMigrationSet([CORE])
    const database = databaseWith([
      { checksum: core!.checksum, name: CORE.name },
      { checksum: 'x', name: '0002_history_rollups.sql' },
    ])
    await expect(planMigrations(database, [core!])).rejects.toThrow(/MIGRATION_MISSING/u)
  })

  it('fails when a new file sorts below the highest applied migration', async () => {
    const set = await createMigrationSet([
      CORE,
      ROLLUPS,
      { name: '0001_zz_late_arrival.sql', sql: 'SELECT 1;' },
    ])
    const applied = set.filter((migration) => migration.name === ROLLUPS.name)
    const database = databaseWith(
      applied.map((migration) => ({ checksum: migration.checksum, name: migration.name })),
    )
    await expect(planMigrations(database, set)).rejects.toThrow(/MIGRATION_OUT_OF_ORDER/u)
  })

  it('plans everything as pending against an empty database', async () => {
    const set = await createMigrationSet([CORE, ROLLUPS])
    const database = databaseWith([], { tableExists: false })
    const plan = await planMigrations(database, set)
    expect(plan.tableExists).toBe(false)
    expect(plan.applied).toEqual([])
    expect(plan.pending.map((migration) => migration.name)).toEqual([CORE.name, ROLLUPS.name])
  })
})

describe('applyMigrations', () => {
  it('takes the lock, creates the table, applies in order, records and unlocks', async () => {
    const set = await createMigrationSet([CORE, ROLLUPS])
    const database = databaseWith([], { tableExists: false })
    const result = await applyMigrations(database, set)

    expect(result.applied).toEqual([CORE.name, ROLLUPS.name])
    expect(result.dryRun).toBe(false)

    const texts = database.texts
    expect(texts[0]).toContain('pg_try_advisory_lock')
    expect(texts[1]).toContain('CREATE TABLE IF NOT EXISTS schema_migrations')
    expect(texts.at(-1)).toContain('pg_advisory_unlock')
    expect(texts.filter((text) => text.startsWith('INSERT INTO schema_migrations'))).toHaveLength(2)
    // The transactional migration is bracketed; the one that opted out is not.
    expect(texts.filter((text) => text === 'BEGIN')).toHaveLength(2)
  })

  it('runs a no-transaction migration outside BEGIN/COMMIT', async () => {
    const set = await createMigrationSet([
      { name: '0001_cagg.sql', sql: '-- narduk:no-transaction\nCREATE MATERIALIZED VIEW m;' },
    ])
    const database = databaseWith([], { tableExists: false })
    await applyMigrations(database, set)
    expect(database.texts).not.toContain('BEGIN')
    expect(database.texts.join('\n')).toContain('CREATE MATERIALIZED VIEW m;')
  })

  // A dry run is what a deploy job prints before it is allowed to change
  // anything, so it must not create the ledger table or take the lock.
  it('dry-run reads the plan and writes nothing', async () => {
    const set = await createMigrationSet([CORE, ROLLUPS])
    const database = databaseWith([], { tableExists: false })
    const result = await applyMigrations(database, set, { dryRun: true })

    expect(result.dryRun).toBe(true)
    expect(result.applied).toEqual([])
    expect(result.skipped).toEqual([CORE.name, ROLLUPS.name])
    const joined = database.texts.join('\n')
    expect(joined).not.toContain('pg_try_advisory_lock')
    expect(joined).not.toContain('CREATE TABLE IF NOT EXISTS')
    expect(joined).not.toContain('INSERT INTO schema_migrations')
  })

  it('applies only what is pending', async () => {
    const set = await createMigrationSet([CORE, ROLLUPS])
    const database = databaseWith([{ checksum: set[0]!.checksum, name: CORE.name }])
    const result = await applyMigrations(database, set)
    expect(result.applied).toEqual([ROLLUPS.name])
  })

  it('gives up with a named error when another run holds the lock', async () => {
    const set = await createMigrationSet([CORE])
    const database = databaseWith([], { locked: false, tableExists: false })
    const slept: number[] = []
    await expect(
      applyMigrations(database, set, {
        lockRetryDelayMs: 100,
        lockTimeoutMs: 250,
        sleep: async (milliseconds) => {
          slept.push(milliseconds)
        },
      }),
    ).rejects.toThrow(/MIGRATION_LOCK_TIMEOUT/u)
    expect(slept.length).toBeGreaterThan(0)
    expect(database.texts.join('\n')).not.toContain('CREATE TABLE IF NOT EXISTS')
  })

  it('releases the lock when a migration fails', async () => {
    const set = await createMigrationSet([CORE])
    const database = databaseWith([], { tableExists: false }).respondTo(/CREATE TABLE series/u, [])
    const failing: SqlExecutor = {
      query: async <Row>(text: string, params?: readonly unknown[]) => {
        if (text.includes('CREATE TABLE series')) throw new Error('relation exists')
        return database.query<Row>(text, params)
      },
    }
    await expect(applyMigrations(failing, set)).rejects.toThrow('relation exists')
    expect(database.texts.at(-1)).toContain('pg_advisory_unlock')
  })
})
