import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { getTableConfig } from 'drizzle-orm/pg-core'
import { drizzle } from 'drizzle-orm/postgres-js'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import * as pgSchema from '../runtime/server/database/pg-schema'

import {
  applyMigrationDirectory,
  applyMigrationDirectoryInSchema,
  diffSchemaAgainstDatabase,
} from './helpers/pg-schema-parity'
import { startPostgres17, type TestDatabase, type TestPostgres } from './helpers/postgres17'

import type { PgTable } from 'drizzle-orm/pg-core'

const directory = join(dirname(fileURLToPath(import.meta.url)), '../runtime/drizzle-pg')
const isTable = (value: unknown): boolean =>
  typeof value === 'object' && value !== null && Symbol.for('drizzle:IsDrizzleTable') in value
const tablesOf = (schema: object) => Object.values(schema).filter(isTable) as unknown as PgTable[]
const tables = tablesOf(pgSchema)

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

/**
 * narduk-libs#1953: stonx owns `public.api_keys` in another shape. With
 * `postgresSchema: 'narduk'` the Drizzle tables are `narduk.*`, the shipped DDL
 * is applied into that schema by the real migration runner, and the app's table
 * is never read, written or altered.
 */
describe('core Postgres migrations in a named schema, beside an app-owned public.api_keys', () => {
  const SCHEMA = 'narduk'
  let server: TestPostgres
  let database: TestDatabase
  let schemaTables: PgTable[]
  let customSchema: typeof pgSchema

  const appApiKeyColumns = `SELECT column_name, data_type FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'api_keys' ORDER BY ordinal_position`
  const appApiKeyIndexes = `SELECT indexname, indexdef FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'api_keys' ORDER BY indexname`

  beforeAll(async () => {
    vi.resetModules()
    vi.doMock('#narduk-core/postgres-schema', () => ({ postgresSchema: SCHEMA }))
    customSchema = await import('../runtime/server/database/pg-schema')
    schemaTables = tablesOf(customSchema)
    server = await startPostgres17()
    database = await server.createDatabase()
    // The app's own table: same name, different shape (stonx's).
    await database.sql.unsafe(`
      CREATE TABLE public.api_keys (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL,
        scopes text[] NOT NULL DEFAULT '{}',
        is_active boolean NOT NULL DEFAULT true,
        created_by uuid
      );
      INSERT INTO public.api_keys (user_id, scopes) VALUES (gen_random_uuid(), '{read}')`)
  }, 120_000)

  afterAll(async () => {
    vi.doUnmock('#narduk-core/postgres-schema')
    await server?.stop()
  })

  it('declares every core table in the named schema, and none in public', () => {
    expect(schemaTables.length).toBeGreaterThanOrEqual(7)
    for (const table of schemaTables) expect(getTableConfig(table).schema).toBe(SCHEMA)
    for (const table of tables) expect(getTableConfig(table).schema).toBeUndefined()
  })

  it('applies every file into the schema and produces exactly the Drizzle schema', async () => {
    const before = await database.sql.unsafe(appApiKeyColumns)
    const indexesBefore = await database.sql.unsafe(appApiKeyIndexes)

    const applied = await applyMigrationDirectoryInSchema(database.sql, directory, {
      schema: SCHEMA,
      table: 'core_migrations',
    })
    expect(applied).toHaveLength(9)
    expect(
      await diffSchemaAgainstDatabase(database.sql, schemaTables, {
        ignoreTables: ['core_migrations'],
      }),
    ).toEqual([])

    // The ledger is in the schema, the default `public` ledger was never made.
    const [ledger] = await database.sql.unsafe(
      `SELECT count(*)::int AS n FROM ${SCHEMA}.core_migrations`,
    )
    expect(ledger?.n).toBe(9)
    expect(
      await database.sql.unsafe(`SELECT to_regclass('public.core_migrations') AS found`),
    ).toEqual([{ found: null }])

    // The app's table is exactly as it was: shape, indexes and data.
    expect(await database.sql.unsafe(appApiKeyColumns)).toEqual(before)
    expect(await database.sql.unsafe(appApiKeyIndexes)).toEqual(indexesBefore)
    expect(await database.sql.unsafe('SELECT scopes FROM public.api_keys')).toEqual([
      { scopes: ['read'] },
    ])
    // narduk's api_keys is the narduk shape, in the narduk schema.
    const narduk = await database.sql.unsafe(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = '${SCHEMA}' AND table_name = 'api_keys' ORDER BY ordinal_position`,
    )
    expect(narduk.map((row) => row.column_name)).toContain('key_hash')
    expect(narduk.map((row) => row.column_name)).not.toContain('is_active')
  })

  it('is idempotent: running the runner again applies nothing', async () => {
    const again = await applyMigrationDirectoryInSchema(database.sql, directory, {
      schema: SCHEMA,
      table: 'core_migrations',
    })
    expect(again).toEqual([])
    expect(
      await diffSchemaAgainstDatabase(database.sql, schemaTables, {
        ignoreTables: ['core_migrations'],
      }),
    ).toEqual([])
  })

  it('emits schema-qualified SQL, and reads and writes only narduk.api_keys', async () => {
    const db = drizzle(database.sql, { schema: customSchema })
    const { apiKeys, users } = customSchema
    expect(db.select().from(apiKeys).toSQL().sql).toContain(`from "${SCHEMA}"."api_keys"`)

    await db.insert(users).values({ id: 'u1', email: 'u1@example.com' })
    await db.insert(apiKeys).values({
      id: 'k1',
      userId: 'u1',
      name: 'cli',
      keyHash: 'h1',
      keyPrefix: 'nk_ab',
    })
    expect(await db.select().from(apiKeys)).toHaveLength(1)
    // The app's row is still the only one in its table.
    expect(await database.sql.unsafe('SELECT count(*)::int AS n FROM public.api_keys')).toEqual([
      { n: 1 },
    ])
  })

  it('without a schema the same collision is real: the file no-ops and then alters the app table', async () => {
    const collision = await server.createDatabase()
    await collision.sql.unsafe(`
      CREATE TABLE public.api_keys (id uuid PRIMARY KEY, user_id uuid NOT NULL, is_active boolean)`)
    // 0002 is a no-op against the app's table, 0004 then adds narduk's column
    // to it, and 0007 fails on the key_hash column that never existed.
    await expect(applyMigrationDirectory(collision.sql, directory)).rejects.toThrow(/key_hash/u)
    expect(
      await collision.sql.unsafe(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'api_keys' AND column_name = 'scopes_json'`,
      ),
    ).toHaveLength(1)
  })
})
