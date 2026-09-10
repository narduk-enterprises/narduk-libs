import { readFileSync } from 'node:fs'

import { getTableName } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import * as schema from '../server/database/devices-schema'
import {
  AUTH_ATTEMPT_OUTCOMES,
  AUTH_ATTEMPT_SUBJECT_KINDS,
  CLAIM_COMPLETE_STATUSES,
  CLAIM_SESSION_STATUSES,
  CLAIM_START_STATUSES,
  CREDENTIAL_CLASSES,
  DEVICE_STATUSES,
} from '../shared/types/devices'

import { createTestHarness, MIGRATION_PATHS, MIGRATION_SQL } from './support/database'

/** Every published migration concatenated, comments stripped. */
const migration = MIGRATION_SQL
const statements = migration
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('--'))
  .join('\n')

/** Every CHECK-constrained column, its table, and the TS vocabulary it must match. */
const ENUM_COLUMNS = [
  ['devices_devices', 'status', schema.devicesDevices.status, DEVICE_STATUSES],
  ['devices_claim_sessions', 'status', schema.devicesClaimSessions.status, CLAIM_SESSION_STATUSES],
  [
    'devices_credentials',
    'credential_class',
    schema.devicesCredentials.credentialClass,
    CREDENTIAL_CLASSES,
  ],
  [
    'devices_sessions',
    'credential_class',
    schema.devicesSessions.credentialClass,
    CREDENTIAL_CLASSES,
  ],
  [
    'devices_auth_attempts',
    'subject_kind',
    schema.devicesAuthAttempts.subjectKind,
    AUTH_ATTEMPT_SUBJECT_KINDS,
  ],
  ['devices_auth_attempts', 'outcome', schema.devicesAuthAttempts.outcome, AUTH_ATTEMPT_OUTCOMES],
] as const

const TABLES = [
  'devices_devices',
  'devices_claim_tokens',
  'devices_claim_sessions',
  'devices_credentials',
  'devices_sessions',
  'devices_challenges',
  'devices_replay_entries',
  'devices_scoped_nonces',
  'devices_auth_attempts',
  'devices_audit_events',
]

function checkValues(table: string, column: string): string[] {
  const block = statements.slice(statements.indexOf(`CREATE TABLE IF NOT EXISTS ${table} (`))
  const body = block.slice(0, block.indexOf(');'))
  const check = new RegExp(
    String.raw`${column} TEXT NOT NULL CHECK \(${column} IN \(([^)]+)\)\)`,
    'u',
  )
  const match = body.match(check)
  expect(match, `${table}.${column} has no CHECK constraint`).not.toBeNull()
  return [...(match?.[1] ?? '').matchAll(/'([^']+)'/gu)].map((entry) => entry[1] ?? '')
}

describe('devices schema/migration parity', () => {
  it('narrows every enum column to exactly the values its CHECK constraint enforces', () => {
    const checks = statements.match(/CHECK \(/gu) ?? []
    expect(checks).toHaveLength(ENUM_COLUMNS.length)
    for (const [table, column, drizzleColumn, vocabulary] of ENUM_COLUMNS) {
      expect(checkValues(table, column), `${table}.${column}`).toEqual([...vocabulary])
      expect(drizzleColumn.enumValues, `${table}.${column} drizzle enum`).toEqual([...vocabulary])
    }
  })

  it('persists only claim-session statuses that are also wire statuses', () => {
    for (const status of CLAIM_SESSION_STATUSES) {
      expect(CLAIM_START_STATUSES).toContain(status)
    }
    // The two wire vocabularies are the contract's, member for member.
    expect(CLAIM_START_STATUSES).toHaveLength(7)
    expect(CLAIM_COMPLETE_STATUSES).toHaveLength(8)
  })

  it('creates exactly the tables the drizzle schema declares', () => {
    const created = [...statements.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/gu)].map(
      (match) => match[1],
    )
    expect([...created].sort()).toEqual([...TABLES].sort())
    const declared = Object.values(schema)
      .filter((value) => typeof value === 'object')
      .map((table) => getTableName(table))
    expect([...declared].sort()).toEqual([...TABLES].sort())
  })

  it('ships every migration as an additive, re-runnable file', () => {
    expect(MIGRATION_PATHS.length).toBeGreaterThanOrEqual(2)
    for (const path of MIGRATION_PATHS) {
      const file = readFileSync(path, 'utf8')
        .split('\n')
        .filter((line) => !line.trimStart().startsWith('--'))
        .join('\n')
      const creates = file.match(/CREATE (?:TABLE|UNIQUE INDEX|INDEX)/gu) ?? []
      const guarded = file.match(/CREATE (?:TABLE|UNIQUE INDEX|INDEX) IF NOT EXISTS/gu) ?? []
      expect(guarded, `${path} has an unguarded CREATE`).toHaveLength(creates.length)
      expect(file, `${path} mutates an existing table`).not.toMatch(/ALTER TABLE|DROP TABLE/iu)
    }
  })

  it('stays additive and D1-only', () => {
    expect(statements.match(/CREATE TABLE IF NOT EXISTS/gu)).toHaveLength(TABLES.length)
    expect(statements).not.toMatch(/DROP TABLE/iu)
    expect(statements).not.toMatch(/ALTER TABLE/iu)
    expect(statements).not.toMatch(/\bSERIAL\b|\bJSONB\b|\bBOOLEAN\b|\bTIMESTAMPTZ\b/iu)
    const indexes = statements.match(/CREATE (?:UNIQUE )?INDEX/gu) ?? []
    const guarded = statements.match(/CREATE (?:UNIQUE )?INDEX IF NOT EXISTS/gu) ?? []
    expect(guarded).toHaveLength(indexes.length)
  })

  it('declares no foreign key outside this package', () => {
    const references = [...statements.matchAll(/REFERENCES (\w+)\(/gu)].map((match) => match[1])
    expect(new Set(references)).toEqual(
      new Set(['devices_devices', 'devices_claim_tokens', 'devices_credentials']),
    )
    expect(statements).not.toMatch(/REFERENCES (?:users|tenancy_\w+)\(/iu)
  })

  it('applies cleanly twice against real SQLite', () => {
    const { sqlite } = createTestHarness()
    expect(() => sqlite.exec(migration)).not.toThrow()
    const tables = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'devices_%'")
      .all() as Array<{ name: string }>
    expect(tables).toHaveLength(TABLES.length)
  })

  it('rejects a value the CHECK constraints do not allow', () => {
    const { sqlite } = createTestHarness()
    expect(() =>
      sqlite
        .prepare('INSERT INTO devices_auth_attempts VALUES (?, ?, ?, ?, ?)')
        .run('a-1', 'email', 'x', 'failure', 1),
    ).toThrow(/CHECK constraint failed/u)
    expect(() =>
      sqlite
        .prepare('INSERT INTO devices_devices VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(
          'd-1',
          'o',
          'vessel',
          'v',
          'i',
          'fp',
          'sha256-v1',
          'pk',
          '1',
          'pending',
          0,
          1,
          null,
          1,
        ),
    ).toThrow(/CHECK constraint failed/u)
  })

  it('makes a claim token redeemable into exactly one claim session', () => {
    const { sqlite } = createTestHarness()
    expect(statements).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS devices_claim_sessions_token_unique_idx/u,
    )
    const insert = sqlite.prepare(
      'INSERT INTO devices_claim_sessions (id, claim_token_id, idempotency_key, hardware_fingerprint, fingerprint_algorithm, public_key, software_version, status, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    sqlite
      .prepare(
        'INSERT INTO devices_claim_tokens (id, org_id, resource_kind, resource_id, token_hash, expires_at, created_by_user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run('t-1', 'o', 'vessel', 'v', 'hash', 9, 'owner', 1)
    insert.run(
      'cs-1',
      't-1',
      'idem-1',
      'fp',
      'sha256-v1',
      'pk',
      '1.0.0',
      'pending_user_approval',
      9,
      1,
    )
    expect(() =>
      insert.run(
        'cs-2',
        't-1',
        'idem-2',
        'fp',
        'sha256-v1',
        'pk',
        '1.0.0',
        'pending_user_approval',
        9,
        1,
      ),
    ).toThrow(/UNIQUE constraint failed/u)
  })

  it('stores a session bearer only as a unique digest', () => {
    const { sqlite } = createTestHarness()
    expect(statements).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS devices_sessions_token_hash_idx/u)
    const columns = sqlite.prepare('PRAGMA table_info(devices_sessions)').all() as Array<{
      name: string
      notnull: number
    }>
    const tokenHash = columns.find((column) => column.name === 'token_hash')
    expect(tokenHash?.notnull).toBe(1)
    // The drizzle table declares the same column.
    expect(schema.devicesSessions.tokenHash.notNull).toBe(true)
    // And the claim token records which session redeemed it.
    const tokenColumns = sqlite.prepare('PRAGMA table_info(devices_claim_tokens)').all() as Array<{
      name: string
    }>
    expect(tokenColumns.map((column) => column.name)).toContain('consumed_by_claim_session_id')
  })

  it('makes the replay key unique', () => {
    const { sqlite } = createTestHarness()
    const insert = sqlite.prepare('INSERT INTO devices_replay_entries VALUES (?, ?, ?, ?, ?, ?, ?)')
    insert.run('r-1', 'd', 1, 'c', 'n', 'h', 9)
    expect(() => insert.run('r-2', 'd', 1, 'c', 'n', 'h', 9)).toThrow(/UNIQUE constraint failed/u)
  })

  it('makes a scoped nonce single-use, with no nullable column in its key', () => {
    const { sqlite } = createTestHarness()
    const insert = sqlite.prepare('INSERT INTO devices_scoped_nonces VALUES (?, ?, ?, ?, ?)')
    insert.run('n-1', 'claim-handoff:cs-1', 'nonce-1', 9, 1)
    expect(() => insert.run('n-2', 'claim-handoff:cs-1', 'nonce-1', 9, 1)).toThrow(
      /UNIQUE constraint failed/u,
    )
    // A different scope is a different exchange.
    expect(() => insert.run('n-3', 'claim-handoff:cs-2', 'nonce-1', 9, 1)).not.toThrow()
    // Both key columns are NOT NULL: SQLite treats NULLs inside a UNIQUE index
    // as distinct, so a nullable key would accept every replay.
    const columns = sqlite.prepare('PRAGMA table_info(devices_scoped_nonces)').all() as Array<{
      name: string
      notnull: number
    }>
    for (const name of ['scope', 'nonce', 'expires_at']) {
      expect(columns.find((column) => column.name === name)?.notnull, name).toBe(1)
    }
  })

  it('resolves a credential secret through a unique digest index', () => {
    const { sqlite } = createTestHarness()
    const indexes = sqlite
      .prepare('SELECT name, "unique" FROM pragma_index_list(\'devices_credentials\')')
      .all() as Array<{ name: string; unique: number }>
    const secretHash = indexes.find((index) => index.name === 'devices_credentials_secret_hash_idx')
    expect(secretHash?.unique, 'secret_hash index must be UNIQUE').toBe(1)
  })
})
