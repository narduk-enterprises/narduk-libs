import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { getTableConfig as getPgTableConfig, type PgTable } from 'drizzle-orm/pg-core'
import { getTableConfig as getSqliteTableConfig, type SQLiteTable } from 'drizzle-orm/sqlite-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  applyMigrationDirectory,
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

describe('auth bridge schema migration parity', () => {
  it('narrows auth_email_links.purpose to the values the migration CHECK enforces', () => {
    const migration = readFileSync(join(packageRoot, 'drizzle/0002_local_email_auth.sql'), 'utf8')
    const check = /CHECK \(purpose IN \(([^)]+)\)\)/u.exec(migration)
    expect(check).not.toBeNull()
    const migrationValues = [...(check?.[1] ?? '').matchAll(/'([^']+)'/gu)].map((match) => match[1])

    expect(migrationValues).toEqual(['setup', 'reset'])
    expect(sqliteSchema.authEmailLinks.purpose.enumValues).toEqual(migrationValues)
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
    const applied = await applyMigrationDirectory(database.sql, join(packageRoot, 'drizzle-pg'))
    expect(applied).toHaveLength(5)
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
    await applyMigrationDirectory(database.sql, join(packageRoot, 'drizzle-pg'))
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
    await expect(
      applyMigrationDirectory(empty.sql, join(packageRoot, 'drizzle-pg')),
    ).rejects.toThrow(/users/u)
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
    expect(pgSchema.authWebauthnCredentials.deviceType.enumValues).toEqual(
      sqliteSchema.authWebauthnCredentials.deviceType.enumValues,
    )
  })
})
