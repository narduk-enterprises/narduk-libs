import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { getTableConfig as getPgTableConfig, type PgTable } from 'drizzle-orm/pg-core'
import { getTableConfig as getSqliteTableConfig, type SQLiteTable } from 'drizzle-orm/sqlite-core'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import {
  applyMigrationDirectory,
  applyMigrationDirectoryInSchema,
  diffSchemaAgainstDatabase,
} from '../../narduk-core/tests/helpers/pg-schema-parity'
import {
  startPostgres17,
  type TestDatabase,
  type TestPostgres,
} from '../../narduk-core/tests/helpers/postgres17'
import * as pgSchema from '../server/database/app-pg-schema'
import * as sqliteAppSchema from '../server/database/app-schema'
import * as sqliteSchema from '../server/database/auth-bridge-schema'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const AUTH_MIGRATIONS_DIR = join(packageRoot, 'drizzle-pg')

describe('auth bridge schema migration parity', () => {
  it('narrows auth_email_links.purpose to the values the latest migration CHECK enforces', () => {
    // 0002 created the table; 0006 rebuilt it with 'signin' (narduk-libs#1952).
    const original = readFileSync(join(packageRoot, 'drizzle/0002_local_email_auth.sql'), 'utf8')
    const rebuilt = readFileSync(
      join(packageRoot, 'drizzle/0006_identities_and_signin_links.sql'),
      'utf8',
    )
    const values = (sql: string) => {
      const check = /CHECK \(purpose IN \(([^)]+)\)\)/u.exec(sql)
      expect(check).not.toBeNull()
      return [...(check?.[1] ?? '').matchAll(/'([^']+)'/gu)].map((match) => match[1])
    }

    expect(values(original)).toEqual(['setup', 'reset'])
    expect(values(rebuilt)).toEqual(['setup', 'reset', 'signin'])
    expect(sqliteSchema.authEmailLinks.purpose.enumValues).toEqual(values(rebuilt))
  })

  it('narrows auth_identities.provider to the values the migration CHECK enforces', () => {
    const migration = readFileSync(
      join(packageRoot, 'drizzle/0006_identities_and_signin_links.sql'),
      'utf8',
    )
    const check = /CHECK \(provider IN \(([^)]+)\)\)/u.exec(migration)
    expect(check).not.toBeNull()
    const migrationValues = [...(check?.[1] ?? '').matchAll(/'([^']+)'/gu)].map((match) => match[1])

    expect(migrationValues).toEqual(['google'])
    expect(sqliteAppSchema.authIdentities.provider.enumValues).toEqual(migrationValues)
  })

  it('narrows auth_webauthn_challenges.purpose to the values the migration CHECK enforces', () => {
    const migration = readFileSync(
      join(packageRoot, 'drizzle/0003_webauthn_credentials.sql'),
      'utf8',
    )
    const check = /purpose TEXT NOT NULL CHECK \(purpose IN \(([^)]+)\)\)/u.exec(migration)
    expect(check).not.toBeNull()
    const migrationValues = [...(check?.[1] ?? '').matchAll(/'([^']+)'/gu)].map((match) => match[1])

    expect(migrationValues).toEqual(['registration', 'authentication'])
    expect(sqliteSchema.authWebauthnChallenges.purpose.enumValues).toEqual(migrationValues)
  })

  it('narrows auth_webauthn_credentials.device_type to the values the migration CHECK enforces', () => {
    const migration = readFileSync(
      join(packageRoot, 'drizzle/0003_webauthn_credentials.sql'),
      'utf8',
    )
    const check = /device_type IN \(([^)]+)\)/u.exec(migration)
    expect(check).not.toBeNull()
    const migrationValues = [...(check?.[1] ?? '').matchAll(/'([^']+)'/gu)].map((match) => match[1])

    expect(migrationValues).toEqual(['singleDevice', 'multiDevice'])
    expect(sqliteSchema.authWebauthnCredentials.deviceType.enumValues).toEqual(migrationValues)
  })

  it('keeps the passkey D1 migration additive and SQLite-only (Postgres has drizzle-pg/)', () => {
    const migration = readFileSync(
      join(packageRoot, 'drizzle/0003_webauthn_credentials.sql'),
      'utf8',
    )
    // Comments in the file describe these constructs, so assert against the
    // statements only.
    const statements = migration
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n')
    // Additive: a rolled-back Worker must be able to ignore these tables, and
    // re-running the migration must be safe.
    expect(statements.match(/CREATE TABLE IF NOT EXISTS/gu)).toHaveLength(2)
    expect(statements).not.toMatch(/DROP TABLE/iu)
    expect(statements).not.toMatch(/ALTER TABLE/iu)
    // The D1 file is SQLite dialect only; its Postgres twin is drizzle-pg/.
    expect(statements).not.toMatch(/\bSERIAL\b|\bJSONB\b|\bBOOLEAN\b|\bTIMESTAMPTZ\b/iu)
  })
})

const isTable = (value: unknown): boolean =>
  typeof value === 'object' && value !== null && Symbol.for('drizzle:IsDrizzleTable') in value

const pgTables = Object.values(pgSchema).filter(isTable) as PgTable[]
const sqliteTables = Object.values(sqliteAppSchema).filter(isTable) as SQLiteTable[]
const coreMigrations = join(packageRoot, '../narduk-core/runtime/drizzle-pg')

describe('auth Postgres migrations match the Drizzle pg schema on a real PostgreSQL 17', () => {
  let server: TestPostgres
  let database: TestDatabase

  beforeAll(async () => {
    server = await startPostgres17()
    database = await server.createDatabase()
  }, 120_000)

  afterAll(async () => {
    await server?.stop()
  })

  it('applies core then auth in order and produces exactly the Drizzle schema', async () => {
    expect(server.version.startsWith('17.')).toBe(true)
    await applyMigrationDirectory(database.sql, coreMigrations)
    const applied = await applyMigrationDirectory(database.sql, AUTH_MIGRATIONS_DIR)
    expect(applied).toHaveLength(6)
    const coreTables = [
      'api_keys',
      'kv_cache',
      'notifications',
      'sessions',
      'system_prompts',
      'todos',
      'users',
    ]
    expect(
      await diffSchemaAgainstDatabase(database.sql, pgTables, {
        collations: { 'auth_oauth_kv.key': 'C' },
        ignoreTables: coreTables,
      }),
    ).toEqual([])
  })

  it('is idempotent: applying every auth file again changes nothing and errors nowhere', async () => {
    await applyMigrationDirectory(database.sql, AUTH_MIGRATIONS_DIR)
    const coreTables = [
      'api_keys',
      'kv_cache',
      'notifications',
      'sessions',
      'system_prompts',
      'todos',
      'users',
    ]
    expect(
      await diffSchemaAgainstDatabase(database.sql, pgTables, {
        collations: { 'auth_oauth_kv.key': 'C' },
        ignoreTables: coreTables,
      }),
    ).toEqual([])
  })

  it('refuses the auth files without core first (they reference users)', async () => {
    const empty = await server.createDatabase()
    await expect(applyMigrationDirectory(empty.sql, AUTH_MIGRATIONS_DIR)).rejects.toThrow(/users/u)
  })

  it('has one Postgres file for each D1 auth migration, under the same name', () => {
    const list = (dir: string) =>
      readdirSync(join(packageRoot, dir)).filter((n) => n.endsWith('.sql'))
    expect(list('drizzle-pg').sort()).toEqual(list('drizzle').sort())
  })

  it('declares the same tables and column names as the SQLite schema', () => {
    const shape = (config: { columns: Array<{ name: string }>; name: string }) =>
      [config.name, config.columns.map((column) => column.name).sort()] as const
    const sqlite = sqliteTables.map((table) => shape(getSqliteTableConfig(table)))
    const pg = pgTables.map((table) => shape(getPgTableConfig(table)))
    expect(pg.sort()).toEqual(sqlite.sort())
  })

  it('declares the same CHECK enums as the D1 migrations', () => {
    expect(pgSchema.authEmailLinks.purpose.enumValues).toEqual(
      sqliteSchema.authEmailLinks.purpose.enumValues,
    )
    expect(pgSchema.authWebauthnChallenges.purpose.enumValues).toEqual(
      sqliteSchema.authWebauthnChallenges.purpose.enumValues,
    )
    expect(pgSchema.authIdentities.provider.enumValues).toEqual(
      sqliteAppSchema.authIdentities.provider.enumValues,
    )
    expect(pgSchema.authWebauthnCredentials.deviceType.enumValues).toEqual(
      sqliteSchema.authWebauthnCredentials.deviceType.enumValues,
    )
  })
})

/**
 * narduk-libs#1953: core and auth in a named schema, beside an app that owns
 * `public.users` and `public.api_keys` in another shape.
 */
describe('auth Postgres migrations in a named schema', () => {
  const SCHEMA = 'narduk'
  const CORE_TABLES = [
    'api_keys',
    'kv_cache',
    'notifications',
    'sessions',
    'system_prompts',
    'todos',
    'users',
  ]
  const LEDGERS = ['core_migrations', 'auth_migrations']
  let server: TestPostgres
  let database: TestDatabase
  let schemaTables: PgTable[]

  beforeAll(async () => {
    vi.resetModules()
    vi.doMock('#narduk-core/postgres-schema', () => ({ postgresSchema: SCHEMA }))
    const custom = await import('../server/database/app-pg-schema')
    schemaTables = Object.values(custom).filter(isTable) as PgTable[]
    server = await startPostgres17()
    database = await server.createDatabase()
    await database.sql.unsafe(`
      CREATE TABLE public.users (uid uuid PRIMARY KEY, handle text NOT NULL);
      CREATE TABLE public.api_keys (
        id uuid PRIMARY KEY, user_id uuid NOT NULL, scopes text[] NOT NULL DEFAULT '{}',
        is_active boolean NOT NULL DEFAULT true, created_by uuid)`)
  }, 120_000)

  afterAll(async () => {
    vi.doUnmock('#narduk-core/postgres-schema')
    await server?.stop()
  })

  it('declares every auth table in the named schema', () => {
    expect(schemaTables).toHaveLength(pgTables.length)
    for (const table of schemaTables) expect(getPgTableConfig(table).schema).toBe(SCHEMA)
  })

  it('refuses the auth files before core, instead of binding to the app’s public.users', async () => {
    await expect(
      applyMigrationDirectoryInSchema(database.sql, AUTH_MIGRATIONS_DIR, {
        schema: SCHEMA,
        table: 'auth_migrations',
      }),
    ).rejects.toThrow(/users/u)
  })

  it('applies core then auth into the schema and produces exactly the Drizzle schema', async () => {
    await applyMigrationDirectoryInSchema(database.sql, coreMigrations, {
      schema: SCHEMA,
      table: 'core_migrations',
    })
    const applied = await applyMigrationDirectoryInSchema(database.sql, AUTH_MIGRATIONS_DIR, {
      schema: SCHEMA,
      table: 'auth_migrations',
    })
    expect(applied).toHaveLength(6)
    expect(
      await diffSchemaAgainstDatabase(database.sql, schemaTables, {
        collations: { 'auth_oauth_kv.key': 'C' },
        ignoreTables: [...CORE_TABLES, ...LEDGERS],
      }),
    ).toEqual([])
  })

  it('points every auth foreign key at narduk.users, not the app’s public.users', async () => {
    const targets = await database.sql.unsafe(`
      SELECT DISTINCT n.nspname AS schema, t.relname AS name
      FROM pg_constraint c
      JOIN pg_class s ON s.oid = c.conrelid AND s.relname LIKE 'auth\\_%'
      JOIN pg_namespace sn ON sn.oid = s.relnamespace AND sn.nspname = '${SCHEMA}'
      JOIN pg_class t ON t.oid = c.confrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE c.contype = 'f'`)
    expect(targets).toEqual([{ schema: SCHEMA, name: 'users' }])
  })

  it('leaves the app’s tables exactly as created', async () => {
    const columns = await database.sql.unsafe(`
      SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = 'public' ORDER BY table_name, ordinal_position`)
    expect(columns).toEqual([
      { table_name: 'api_keys', column_name: 'id' },
      { table_name: 'api_keys', column_name: 'user_id' },
      { table_name: 'api_keys', column_name: 'scopes' },
      { table_name: 'api_keys', column_name: 'is_active' },
      { table_name: 'api_keys', column_name: 'created_by' },
      { table_name: 'users', column_name: 'uid' },
      { table_name: 'users', column_name: 'handle' },
    ])
  })
})
