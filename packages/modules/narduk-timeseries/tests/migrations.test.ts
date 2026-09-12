/**
 * The migration files are the schema contract with a database that does not
 * exist yet, so these assertions stand in for the DDL nobody can run.
 *
 * They check three things a reviewer cannot check by eye: that the runner in
 * narduk-postgres will accept every file (name shape, ordering, load), that the
 * DDL docs/04 and ADR-0004 specify is actually present, and that the one file
 * Timescale refuses to run inside a transaction carries the directive that
 * keeps it out of one.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  MIGRATION_NAME_PATTERN,
  NO_TRANSACTION_DIRECTIVE,
  createMigrationSet,
  parseMigrationDirectives,
} from '@narduk-enterprises/narduk-postgres/migrate'
import { loadMigrationsFromDirectory } from '@narduk-enterprises/narduk-postgres/node'
import { describe, expect, it } from 'vitest'

import { TIMESCALE_MIGRATION_NAMES, timescaleMigrationsUrl } from '../src/timescale/index.js'

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

  it('builds the docs/04 hypertables with the chunk intervals ADR-0004 states', () => {
    expect(sql).toMatch(/create_hypertable\(\s*'telemetry_numeric'[^)]*1 day/u)
    expect(sql).toMatch(/create_hypertable\(\s*'track_points'[^)]*7 days/u)
  })

  it('compresses raw telemetry by vessel and series after three days', () => {
    expect(sql).toContain("timescaledb.compress_segmentby = 'vessel_id, series_id'")
    expect(sql).toMatch(/add_compression_policy\('telemetry_numeric',\s*INTERVAL '3 days'/u)
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
    expect(sql.match(/WITH \(timescaledb\.continuous\)/gu)).toHaveLength(4)
    expect(sql.match(/add_continuous_aggregate_policy/gu)).toHaveLength(4)
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

  it('creates the three least-privilege roles docs/09 names', () => {
    for (const role of ['ingest_writer', 'history_reader', 'ops']) {
      expect(sql).toContain(role)
    }
  })

  it('carries no credential of any kind', () => {
    // Comments are allowed to say the roles have no password; the executable
    // SQL is what must never mention one.
    const executable = sql
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n')
    expect(executable).not.toMatch(/PASSWORD/iu)
    expect(executable).toContain('NOLOGIN')
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
