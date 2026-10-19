import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import * as pgSchema from '../runtime/server/database/pg-schema'

import { applyMigrationDirectory, diffSchemaAgainstDatabase } from './helpers/pg-schema-parity'
import { startPostgres17, type TestDatabase, type TestPostgres } from './helpers/postgres17'

import type { PgTable } from 'drizzle-orm/pg-core'

const directory = join(dirname(fileURLToPath(import.meta.url)), '../runtime/drizzle-pg')
const tables = Object.values(pgSchema).filter(
  (value) =>
    typeof value === 'object' && value !== null && Symbol.for('drizzle:IsDrizzleTable') in value,
) as unknown as PgTable[]

describe('core Postgres migrations match pg-schema.ts on a real PostgreSQL 17', () => {
  let server: TestPostgres
  let database: TestDatabase

  beforeAll(async () => {
    server = await startPostgres17()
    database = await server.createDatabase()
  }, 120_000)

  afterAll(async () => {
    await server?.stop()
  })

  it('runs against PostgreSQL 17', () => {
    expect(server.version.startsWith('17.')).toBe(true)
  })

  it('applies every file in order and produces exactly the Drizzle schema', async () => {
    const applied = await applyMigrationDirectory(database.sql, directory)
    expect(applied).toHaveLength(9)
    expect(tables.length).toBeGreaterThanOrEqual(7)
    expect(await diffSchemaAgainstDatabase(database.sql, tables)).toEqual([])
  })

  it('is idempotent: applying every file again changes nothing and errors nowhere', async () => {
    await applyMigrationDirectory(database.sql, directory)
    expect(await diffSchemaAgainstDatabase(database.sql, tables)).toEqual([])
  })

  it('carries one Postgres file for each core D1 migration, under the same name', async () => {
    const { readdirSync } = await import('node:fs')
    const d1 = readdirSync(join(directory, '../drizzle')).filter((name) =>
      /^\d{4}_.*\.sql$/u.test(name),
    )
    expect(readdirSync(directory).sort()).toEqual(d1.sort())
  })

  it('detects drift: a column the schema lacks is reported', async () => {
    const drift = await server.createDatabase()
    await applyMigrationDirectory(drift.sql, directory)
    await drift.sql.unsafe(
      'ALTER TABLE api_keys ADD COLUMN surprise text; DROP INDEX api_keys_key_hash_idx',
    )
    const problems = await diffSchemaAgainstDatabase(drift.sql, tables)
    expect(problems).toContain('database has column api_keys.surprise the schema does not declare')
    expect(problems).toContain('api_keys: missing index api_keys_key_hash_idx')
  })
})
