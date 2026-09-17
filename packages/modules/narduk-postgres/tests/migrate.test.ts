import { describe, expect, it } from 'vitest'

import {
  MIGRATION_LOCK_NAMESPACE,
  applyMigrations,
  createMigration,
  createMigrationSet,
  migrationLockKey,
  parseMigrationDirectives,
  planMigrations,
  splitSqlStatements,
} from '../src/migrate.js'
import { type ProtocolFake, createProtocolFake } from '../src/testing.js'
import type { QueryResult, SqlExecutor } from '../src/types.js'

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

  // A multi-command simple query runs in an IMPLICIT transaction, so sending a
  // no-transaction file as one string fails on exactly the DDL the directive
  // exists for. One statement per round trip is the whole point.
  it('sends a no-transaction migration one statement at a time, outside BEGIN', async () => {
    const set = await createMigrationSet([
      {
        name: '0001_cagg.sql',
        sql: [
          '-- narduk:no-transaction',
          'CREATE MATERIALIZED VIEW a WITH (timescaledb.continuous) AS SELECT 1;',
          '-- a comment with a ; semicolon in it',
          "SELECT add_continuous_aggregate_policy('a', start_offset => INTERVAL '7 days');",
          'DO $$ BEGIN PERFORM 1; PERFORM 2; END $$;',
        ].join('\n'),
      },
    ])
    const database = databaseWith([], { tableExists: false })
    await applyMigrations(database, set)

    expect(database.texts).not.toContain('BEGIN')
    // Everything the runner itself issues, subtracted -- what is left is the
    // migration, and it arrived as three separate queries, not one.
    const runnerOwn = /to_regclass|pg_try_advisory_lock|pg_advisory_unlock|schema_migrations/u
    const migrationStatements = database.texts.filter((text) => !runnerOwn.test(text))
    expect(migrationStatements).toHaveLength(3)
    // A leading comment rides with its statement, the directive line included.
    expect(migrationStatements[0]).toBe(
      '-- narduk:no-transaction\nCREATE MATERIALIZED VIEW a WITH (timescaledb.continuous) AS SELECT 1',
    )
    expect(migrationStatements[1]).toContain('add_continuous_aggregate_policy')
    expect(migrationStatements[2]).toBe('DO $$ BEGIN PERFORM 1; PERFORM 2; END $$')
  })

  it('reports an unlock that says this session never held the lock', async () => {
    const set = await createMigrationSet([CORE])
    const database = createProtocolFake()
      .respondTo(/to_regclass/u, [{ exists: false }])
      .respondTo(/pg_try_advisory_lock/u, [{ locked: true }])
      .respondTo(/pg_advisory_unlock/u, [{ unlocked: false }])

    await expect(applyMigrations(database, set)).rejects.toThrow(/MIGRATION_UNLOCK_FAILED/u)
  })

  it('lets the migration error through when the unlock also fails', async () => {
    const set = await createMigrationSet([CORE])
    const database = databaseWith([], { tableExists: false })
      .respondTo(/CREATE TABLE series/u, () => {
        throw new Error('relation exists')
      })
      .respondTo(/pg_advisory_unlock/u, [{ unlocked: false }])

    // The primary failure is the one an operator has to see.
    await expect(applyMigrations(database, set)).rejects.toThrow(/relation exists/u)
  })

  it('keeps a second migration set in its own table', async () => {
    const set = await createMigrationSet([CORE])
    const database = createProtocolFake()
      .respondTo(/to_regclass/u, [{ exists: false }])
      .respondTo(/pg_try_advisory_lock/u, [{ locked: true }])
      .respondTo(/pg_advisory_unlock/u, [{ unlocked: true }])
    await applyMigrations(database, set, { table: 'history_migrations' })

    const joined = database.texts.join('\n')
    expect(joined).toContain('CREATE TABLE IF NOT EXISTS history_migrations')
    expect(joined).toContain('INSERT INTO history_migrations')
    expect(joined).not.toContain('schema_migrations')
  })

  it('refuses a table name that is not a bare lower_snake_case identifier', async () => {
    const set = await createMigrationSet([CORE])
    await expect(
      applyMigrations(createProtocolFake(), set, { table: 'public.migrations; DROP TABLE x' }),
    ).rejects.toThrow(/MIGRATION_TABLE_INVALID/u)
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

  it('rolls back a transactional file on a plain SqlExecutor when a later statement fails', async () => {
    const committed = new Set<string>()
    let open: Set<string> | null = null
    const ledger: string[] = []
    let openLedger: string | null = null

    const mark = (key: string): void => {
      if (open) open.add(key)
      else committed.add(key)
    }

    const executor: SqlExecutor = {
      async query<Row = Record<string, unknown>>(
        text: string,
        params: readonly unknown[] = [],
      ): Promise<QueryResult<Row>> {
        const normalized = text.replaceAll(/\s+/gu, ' ').trim()
        if (/pg_try_advisory_lock/u.test(text)) {
          return { rowCount: 1, rows: [{ locked: true }] as Row[] }
        }
        if (/pg_advisory_unlock/u.test(text)) {
          return { rowCount: 1, rows: [{ unlocked: true }] as Row[] }
        }
        if (/to_regclass/u.test(text)) {
          return { rowCount: 1, rows: [{ exists: false }] as Row[] }
        }
        if (normalized === 'BEGIN') {
          open = new Set()
          openLedger = null
          return { rowCount: 0, rows: [] }
        }
        if (normalized === 'COMMIT') {
          if (open) for (const key of open) committed.add(key)
          if (openLedger !== null) ledger.push(openLedger)
          open = null
          openLedger = null
          return { rowCount: 0, rows: [] }
        }
        if (normalized === 'ROLLBACK') {
          open = null
          openLedger = null
          return { rowCount: 0, rows: [] }
        }
        if (/CREATE TABLE first/u.test(text)) {
          mark('first')
          return { rowCount: 0, rows: [] }
        }
        if (/CREATE TABLE second/u.test(text)) {
          throw new Error('relation exists')
        }
        if (/INSERT INTO schema_migrations/u.test(text)) {
          const name = String(params[0])
          if (open) openLedger = name
          else ledger.push(name)
          return { rowCount: 1, rows: [] }
        }
        return { rowCount: 0, rows: [] }
      },
    }

    const set = await createMigrationSet([
      {
        name: '0001_two_steps.sql',
        sql: 'CREATE TABLE first (); CREATE TABLE second ();',
      },
    ])

    await expect(applyMigrations(executor, set)).rejects.toThrow(/relation exists/u)
    expect(committed.has('first')).toBe(false)
    expect(ledger).toEqual([])
  })

  function plainLockingExecutor(): SqlExecutor & { texts: string[] } {
    const texts: string[] = []
    return {
      texts,
      async query<Row = Record<string, unknown>>(text: string): Promise<QueryResult<Row>> {
        texts.push(text)
        if (/pg_try_advisory_lock/u.test(text)) {
          return { rowCount: 1, rows: [{ locked: true }] as Row[] }
        }
        if (/pg_advisory_unlock/u.test(text)) {
          return { rowCount: 1, rows: [{ unlocked: true }] as Row[] }
        }
        if (/to_regclass/u.test(text)) {
          return { rowCount: 1, rows: [{ exists: false }] as Row[] }
        }
        return { rowCount: 0, rows: [] }
      },
    }
  }

  it('refuses CONCURRENTLY in a default-transactional file before running SQL', async () => {
    const executor = plainLockingExecutor()
    const set = await createMigrationSet([
      {
        name: '0001_concurrent_idx.sql',
        sql: 'CREATE INDEX CONCURRENTLY idx ON t (a);',
      },
    ])

    await expect(applyMigrations(executor, set)).rejects.toThrow(
      /0001_concurrent_idx\.sql[\s\S]*-- narduk:no-transaction/u,
    )
    const joined = executor.texts.join('\n')
    expect(joined).not.toMatch(/\bBEGIN\b/u)
    expect(joined).not.toMatch(/CREATE INDEX CONCURRENTLY/iu)
    expect(joined).toContain('pg_advisory_unlock')
  })

  it('allows ALTER TYPE ADD VALUE, which Postgres 12+ permits in a transaction', async () => {
    const executor = plainLockingExecutor()
    const set = await createMigrationSet([
      { name: '0001_add_value.sql', sql: "ALTER TYPE mood ADD VALUE 'sad';" },
    ])

    await expect(applyMigrations(executor, set)).resolves.toBeDefined()
    const joined = executor.texts.join('\n')
    expect(joined).toMatch(/\bBEGIN\b/u)
    expect(joined).toMatch(/ALTER TYPE mood ADD VALUE/iu)
  })

  it('refuses VACUUM and the rest of the CONCURRENTLY family', async () => {
    for (const [name, sql] of [
      ['0001_vacuum.sql', 'VACUUM ANALYZE t;'],
      ['0001_drop_idx.sql', 'DROP INDEX CONCURRENTLY idx;'],
      ['0001_reindex.sql', 'REINDEX INDEX CONCURRENTLY idx;'],
    ] as const) {
      const executor = plainLockingExecutor()
      const set = await createMigrationSet([{ name, sql }])
      await expect(applyMigrations(executor, set)).rejects.toThrow(/-- narduk:no-transaction/u)
      expect(executor.texts.join('\n')).not.toMatch(/\bBEGIN\b/u)
      expect(executor.texts.some((text) => text.includes(sql.split(' ')[0] ?? ''))).toBe(false)
    }
  })

  it('still applies CONCURRENTLY when the file opts out on the first line', async () => {
    const executor = plainLockingExecutor()
    const set = await createMigrationSet([
      {
        name: '0001_concurrent_idx.sql',
        sql: '-- narduk:no-transaction\nCREATE INDEX CONCURRENTLY idx ON t (a);',
      },
    ])

    await expect(applyMigrations(executor, set)).resolves.toMatchObject({
      applied: ['0001_concurrent_idx.sql'],
    })
    const joined = executor.texts.join('\n')
    expect(joined).not.toMatch(/\bBEGIN\b/u)
    expect(joined).toMatch(/CREATE INDEX CONCURRENTLY/iu)
  })
})

describe('splitSqlStatements', () => {
  it('splits on top-level semicolons only', () => {
    expect(splitSqlStatements('SELECT 1; SELECT 2;')).toEqual(['SELECT 1', 'SELECT 2'])
  })

  it('ignores semicolons inside a dollar-quoted body', () => {
    const sql = 'DO $$ BEGIN IF TRUE THEN PERFORM 1; END IF; END $$;\nSELECT 2;'
    expect(splitSqlStatements(sql)).toEqual([
      'DO $$ BEGIN IF TRUE THEN PERFORM 1; END IF; END $$',
      'SELECT 2',
    ])
  })

  it('ignores semicolons inside tagged dollar quotes, literals and identifiers', () => {
    expect(splitSqlStatements("DO $body$ SELECT ';'; $body$; SELECT 2;")).toHaveLength(2)
    expect(splitSqlStatements("SELECT 'a;b'; SELECT 2;")).toEqual(["SELECT 'a;b'", 'SELECT 2'])
    expect(splitSqlStatements('SELECT "a;b"; SELECT 2;')).toEqual(['SELECT "a;b"', 'SELECT 2'])
    expect(splitSqlStatements("SELECT 'it''s; fine';")).toEqual(["SELECT 'it''s; fine'"])
  })

  it('accepts a dollar tag containing digits', () => {
    // A tag follows identifier rules: no leading digit, digits allowed after.
    // Excluding every digit meant `$func1$` was not an opener, so the body was
    // cut at its first internal semicolon into two syntax errors.
    expect(splitSqlStatements('DO $func1$ BEGIN PERFORM 1; END $func1$; SELECT 2;')).toEqual([
      'DO $func1$ BEGIN PERFORM 1; END $func1$',
      'SELECT 2',
    ])
    expect(splitSqlStatements('DO $x_9$ SELECT 1; $x_9$;')).toHaveLength(1)
    // A leading digit is still not a tag, so `$1` stays a bind placeholder.
    expect(splitSqlStatements('SELECT $1; SELECT $2;')).toEqual(['SELECT $1', 'SELECT $2'])
  })

  it('honours backslash escapes inside an E-string and only there', () => {
    // E'...' turns on backslash escaping, so E'it\'s; fine' is one literal.
    // Read as a plain literal, the closing quote lands early and the rest of
    // the statement is split at a semicolon that is inside a string.
    expect(splitSqlStatements("SELECT E'it\\'s; fine'; SELECT 2;")).toEqual([
      "SELECT E'it\\'s; fine'",
      'SELECT 2',
    ])
    expect(splitSqlStatements("SELECT e'a\\'; b'; SELECT 2;")).toHaveLength(2)
    // In a standard literal a backslash is an ordinary character
    // (standard_conforming_strings has been on since 9.1), so a trailing one
    // must NOT swallow the closing quote.
    expect(splitSqlStatements("SELECT 'C:\\'; SELECT 2;")).toEqual(["SELECT 'C:\\'", 'SELECT 2'])
    // The E only counts as its own token, never as the tail of an identifier.
    expect(splitSqlStatements("SELECT valueE'a\\'; SELECT 2;")).toHaveLength(2)
  })

  it('ignores semicolons inside line and nested block comments', () => {
    expect(splitSqlStatements('-- one; two\nSELECT 1;')).toEqual(['-- one; two\nSELECT 1'])
    expect(splitSqlStatements('/* a; /* b; */ c; */ SELECT 1;')).toEqual([
      '/* a; /* b; */ c; */ SELECT 1',
    ])
  })

  it('drops comment-only and empty trailing fragments', () => {
    expect(splitSqlStatements('SELECT 1;\n-- trailing note\n')).toEqual(['SELECT 1'])
    expect(splitSqlStatements(';;\n')).toEqual([])
  })

  it('refuses an unterminated quote or dollar body rather than guessing', () => {
    expect(() => splitSqlStatements("SELECT 'unclosed")).toThrow(
      /MIGRATION_STATEMENT_UNTERMINATED/u,
    )
    expect(() => splitSqlStatements('DO $$ SELECT 1')).toThrow(/MIGRATION_STATEMENT_UNTERMINATED/u)
  })
})

describe('parseMigrationDirectives', () => {
  it('reads the directive from the first line only', () => {
    expect(parseMigrationDirectives('-- narduk:no-transaction\nSELECT 1;').transactional).toBe(
      false,
    )
    // A file that merely mentions the directive further down still runs wrapped.
    expect(
      parseMigrationDirectives('SELECT 1;\n-- see -- narduk:no-transaction for CAggs\n')
        .transactional,
    ).toBe(true)
  })
})
