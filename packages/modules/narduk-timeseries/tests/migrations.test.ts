/**
 * The migration files are the schema contract with a database that does not
 * exist yet, so these assertions stand in for the DDL nobody can run.
 *
 * They check four things a reviewer cannot check by eye: that the runner in
 * narduk-postgres will accept every file (name shape, ordering, load), that the
 * DDL docs/04 and ADR-0004 specify is actually present, that the one file
 * Timescale refuses to run inside a transaction carries the directive that
 * keeps it out of one AND reaches the database as one statement per round
 * trip, and that 0003 is byte-identical to what the library's own grant
 * builder emits.
 *
 * **What a text assertion proves, exactly.** These are presence checks on SQL
 * text. They prove this package ships the API it claims to ship -- `by_range`
 * rather than the positional `create_hypertable`, the columnstore API rather
 * than the 2.17 compression API, a UNIQUE constraint the writer's
 * `ON CONFLICT` depends on -- and they catch an edit that silently drops one.
 * They do NOT prove the DDL executes: only `tests/live-integration.test.ts`
 * against a real TimescaleDB 2.30 does that, and it is skipped until the
 * instance exists. Nothing here should be read as "the schema was applied".
 */
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  MIGRATION_NAME_PATTERN,
  NO_TRANSACTION_DIRECTIVE,
  applyMigrations,
  createMigrationSet,
  parseMigrationDirectives,
} from '@narduk-enterprises/narduk-postgres/migrate'
import { loadMigrationsFromDirectory } from '@narduk-enterprises/narduk-postgres/node'
import { createProtocolFake } from '@narduk-enterprises/narduk-postgres/testing'
import { describe, expect, it } from 'vitest'

import {
  TIMESCALE_MIGRATION_NAMES,
  buildSeriesResolveStatement,
  historyRoleGrantStatements,
  timescaleMigrationsUrl,
} from '../src/timescale/index.js'

const VESSEL = '11111111-1111-4111-8111-111111111111'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const migrationsDirectory = join(packageRoot, 'migrations')
const files = readdirSync(migrationsDirectory).sort()
const read = (name: string): string => readFileSync(join(migrationsDirectory, name), 'utf8')

describe('migration set', () => {
  it('is exactly the set the package advertises, in order', () => {
    expect(files).toEqual([...TIMESCALE_MIGRATION_NAMES])
    for (const name of files) expect(name).toMatch(MIGRATION_NAME_PATTERN)
  })

  it('loads through the runner from the URL the package exports', async () => {
    const loaded = await loadMigrationsFromDirectory(timescaleMigrationsUrl)
    expect(loaded.map((migration) => migration.name)).toEqual([...TIMESCALE_MIGRATION_NAMES])
    for (const migration of loaded) {
      expect(migration.checksum).toMatch(/^[0-9a-f]{64}$/u)
      expect(migration.sql.length).toBeGreaterThan(0)
    }
  })

  it('has stable checksums, so an applied file can never be edited in place', async () => {
    const first = await createMigrationSet(files.map((name) => ({ name, sql: read(name) })))
    const second = await createMigrationSet(files.map((name) => ({ name, sql: read(name) })))
    expect(first.map((m) => m.checksum)).toEqual(second.map((m) => m.checksum))
  })
})

describe('0001_history_core.sql', () => {
  const sql = read('0001_history_core.sql')

  it('creates the extensions the store needs', () => {
    expect(sql).toMatch(/CREATE EXTENSION IF NOT EXISTS timescaledb/iu)
    expect(sql).toMatch(/CREATE EXTENSION IF NOT EXISTS postgis/iu)
  })

  it('builds the hypertables through by_range, not the form deprecated in 2.13', () => {
    expect(sql).toMatch(
      /create_hypertable\(\s*'telemetry_numeric',\s*by_range\('ts', INTERVAL '1 day'\)/u,
    )
    expect(sql).toMatch(
      /create_hypertable\(\s*'track_points',\s*by_range\('ts', INTERVAL '7 days'\)/u,
    )
    // The positional dimension form still parses on 2.30 and is deprecated;
    // shipping it would be a migration nobody can re-run on a later major.
    expect(sql).not.toMatch(/create_hypertable\([^)]*chunk_time_interval\s*=>/u)
  })

  it('uses the columnstore API that superseded compression in 2.18', () => {
    expect(sql).toContain('timescaledb.enable_columnstore = true')
    // Every column of the UNIQUE key must be a segmentby or an orderby column
    // or TimescaleDB refuses to enable the columnstore at all, so the natural
    // key's `installation_role` has to be segmented on.
    expect(sql).toContain("timescaledb.segmentby = 'vessel_id, series_id, installation_role'")
    expect(sql).toContain("timescaledb.orderby   = 'ts DESC'")
    // A PROCEDURE in 2.30: `SELECT add_columnstore_policy(...)` fails with
    // "... is a procedure" and takes 0001 down with it. Its neighbours
    // (add_continuous_aggregate_policy, drop_chunks) are still functions.
    expect(sql).toMatch(
      /CALL add_columnstore_policy\('telemetry_numeric',\s*after => INTERVAL '3 days'/u,
    )
    expect(sql).not.toMatch(/SELECT\s+add_columnstore_policy/u)
    // The comment header names the superseded API; the executable SQL must not
    // use it.
    const executable = sql
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n')
    expect(executable).not.toContain('timescaledb.compress')
    expect(executable).not.toContain('add_compression_policy')
  })

  it('keeps every unique-key column inside segmentby or orderby', () => {
    // TimescaleDB cannot enforce a unique constraint inside a compressed chunk
    // over a column it did not segment or order by, so `enable_columnstore`
    // is rejected and 0001 rolls back on the real instance. This test is the
    // structural version of that rule: change the natural key without changing
    // the columnstore settings and it fails here rather than on deployment.
    const unique = /UNIQUE \(([^)]+)\)/u.exec(
      sql.slice(sql.indexOf('CREATE TABLE IF NOT EXISTS telemetry_numeric')),
    )
    const segmentby = /timescaledb\.segmentby = '([^']+)'/u.exec(sql)
    const orderby = /timescaledb\.orderby\s+= '([^']+)'/u.exec(sql)
    expect(unique?.[1]).toBeDefined()
    expect(segmentby?.[1]).toBeDefined()
    expect(orderby?.[1]).toBeDefined()

    const columns = (list: string): string[] =>
      list.split(',').map((entry) => entry.trim().split(/\s+/u)[0] ?? '')
    const covered = new Set([...columns(segmentby?.[1] ?? ''), ...columns(orderby?.[1] ?? '')])
    for (const column of columns(unique?.[1] ?? '')) {
      expect(covered.has(column)).toBe(true)
    }
  })

  it('gives both hypertables the natural key their writers rely on', () => {
    // The write path says ON CONFLICT DO NOTHING; without these constraints
    // that clause is a no-op that reads like idempotency. A hypertable's
    // unique index must include the partitioning column, which ts is.
    expect(sql).toContain('UNIQUE (vessel_id, series_id, ts, installation_role)')
    expect(sql).toContain('UNIQUE (vessel_id, ts)')
  })

  it('stores position as geography with a GIST index', () => {
    expect(sql).toContain('GEOGRAPHY(POINT, 4326)')
    expect(sql).toMatch(/USING GIST \(geom\)/u)
  })

  it('runs inside a transaction', () => {
    expect(parseMigrationDirectives(sql).transactional).toBe(true)
  })
})

describe('0002_history_rollups.sql', () => {
  const sql = read('0002_history_rollups.sql')

  it('declares itself non-transactional, because a CAgg cannot be created in one', () => {
    expect(sql.startsWith(NO_TRANSACTION_DIRECTIVE)).toBe(true)
    expect(parseMigrationDirectives(sql).transactional).toBe(false)
  })

  it('builds the whole 1m -> 15m -> 1h -> 1d ladder with refresh policies', () => {
    for (const bucket of ['1m', '15m', '1h', '1d']) {
      expect(sql).toContain(`telemetry_numeric_${bucket}`)
    }
    expect(
      sql.match(/WITH \(timescaledb\.continuous, timescaledb\.materialized_only = true\)/gu),
    ).toHaveLength(4)
    expect(sql.match(/add_continuous_aggregate_policy/gu)).toHaveLength(4)
  })

  it('aggregates the primary installation only, so shadow rows live in raw', () => {
    // A mean over two instruments is not the vessel's value. Round 24 (R24-2).
    expect(sql).toMatch(/FROM telemetry_numeric\s+WHERE installation_role = 0/u)
  })

  it('reconsiders the whole raw window at the two finest levels', () => {
    // A 2-hour start_offset never materializes a store-and-forward batch that
    // arrives three days late, and raw is dropped at 7 days -- so those points
    // would reach no rollup at all before disappearing.
    const offsets = [...sql.matchAll(/start_offset => INTERVAL '([^']+)'/gu)].map(
      (match) => match[1],
    )
    expect(offsets).toEqual(['7 days', '7 days', '7 days', '30 days'])
  })

  it('reaches the database one statement per round trip', async () => {
    // The directive is only half the fix: a multi-statement simple query is an
    // implicit transaction, and `CREATE MATERIALIZED VIEW ... WITH
    // (timescaledb.continuous)` is rejected inside one. Eight statements --
    // four views, four policies -- must arrive as eight queries.
    const set = await createMigrationSet([{ name: '0002_history_rollups.sql', sql }])
    const database = createProtocolFake()
      .respondTo(/to_regclass/u, [{ exists: false }])
      .respondTo(/pg_try_advisory_lock/u, [{ locked: true }])
      .respondTo(/pg_advisory_unlock/u, [{ unlocked: true }])
    await applyMigrations(database, set)

    const runnerOwn = /to_regclass|pg_try_advisory_lock|pg_advisory_unlock|schema_migrations/u
    const sent = database.texts.filter((text) => !runnerOwn.test(text))
    expect(sent).toHaveLength(8)
    expect(sent.filter((text) => text.includes('CREATE MATERIALIZED VIEW'))).toHaveLength(4)
    expect(sent.filter((text) => text.includes('add_continuous_aggregate_policy'))).toHaveLength(4)
    for (const statement of sent) expect(statement).not.toContain('BEGIN')
  })

  it('stores the components an average can be recomputed from, not an average', () => {
    // Chaining avg-of-avg across the ladder is wrong whenever buckets carry
    // different sample counts; sum and n recompute exactly at every level.
    expect(sql).toContain('sum_value')
    expect(sql).toContain('AS n')
    expect(sql).not.toMatch(/\bavg\(value\)\s+AS\s+avg_value/iu)
  })
})

describe('0003_history_roles.sql', () => {
  const sql = read('0003_history_roles.sql')
  const executableLines = sql
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('--'))

  it('is exactly what the library grant builder emits', () => {
    // Before this assertion the library exported a grant builder and this file
    // carried a hand-written copy of the same matrix, with nothing reporting a
    // disagreement between them.
    expect(executableLines).toEqual(historyRoleGrantStatements())
  })

  it('grants to the three least-privilege roles docs/09 names', () => {
    for (const role of ['ingest_writer', 'history_reader', 'ops']) {
      expect(sql).toContain(role)
    }
  })

  it('creates no role and sets no timeout: the deployment owns both', () => {
    // narduk-infrastructure#155's initdb creates the roles WITH LOGIN and sets
    // their statement_timeout. Both need superuser, and re-issuing the timeout
    // here would silently replace the deployment's 60 s with 15 s.
    const executable = executableLines.join('\n')
    expect(executable).not.toMatch(/CREATE ROLE/iu)
    expect(executable).not.toMatch(/ALTER ROLE/iu)
    expect(executable).not.toMatch(/statement_timeout/iu)
    for (const line of executableLines) expect(line).toMatch(/^GRANT /u)
  })

  it('grants no DELETE on a continuous aggregate', () => {
    // Rollup retention is a time-based drop_chunks on the materialization
    // hypertable, an owner operation. A DELETE grant on the view only looked
    // like the thing doing the work.
    for (const line of executableLines) {
      if (/telemetry_numeric_(?:1m|15m|1h|1d)/u.test(line)) {
        expect(line).toMatch(/^GRANT SELECT ON/u)
      }
    }
  })

  it('carries no credential of any kind', () => {
    const executable = executableLines.join('\n')
    expect(executable).not.toMatch(/PASSWORD/iu)
  })

  it('grants the writer exactly the UPDATE its own upsert parses against', () => {
    // This is the blocker fix pass 2 found: `resolveSeries` upserts with
    // ON CONFLICT ... DO UPDATE, PostgreSQL checks UPDATE at PARSE time, and
    // 0003 granted the writer only INSERT+SELECT -- so a consumer provisioning
    // from the library alone got "permission denied for table series" on every
    // resolve. The two facts are asserted together so neither can move alone.
    const resolve = buildSeriesResolveStatement([
      { path: 'navigation.speedOverGround', unit: 'm/s', valueKind: 'numeric', vesselId: VESSEL },
    ])
    const writerGrants = executableLines.filter((line) => line.includes('"ingest_writer"'))
    if (/DO UPDATE/u.test(resolve.text)) {
      expect(writerGrants).toContain('GRANT UPDATE ON "public"."series" TO "ingest_writer";')
    }
    // ...and no more than that: no DELETE, no TRUNCATE, no UPDATE on either
    // hypertable. A writer that can rewrite a unit string still cannot erase
    // a reading.
    for (const grant of writerGrants) {
      expect(grant).not.toMatch(/\b(DELETE|TRUNCATE)\b/u)
      if (/\bUPDATE\b/u.test(grant)) expect(grant).toContain('"public"."series"')
    }
  })

  it('gives the reader no write grant', () => {
    const readerGrants = sql
      .split('\n')
      .filter((line) => line.includes('history_reader') && line.trimStart().startsWith('GRANT'))
    expect(readerGrants.length).toBeGreaterThan(0)
    for (const grant of readerGrants) {
      expect(grant).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE)\b/u)
    }
  })
})
