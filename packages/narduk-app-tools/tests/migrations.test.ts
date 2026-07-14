import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it, afterEach } from 'vitest'

import {
  buildMigrationPlan,
  buildWranglerD1ExecuteArgs,
  checksumMigrationSql,
  discoverMigrations,
  migrationLedgerCreateSql,
  orderMigrationSources,
  parseMigrationConfig,
  planMigrations,
  validateMigrationReset,
  type MigrationConfig,
  type MigrationFile,
} from '../src/migrations'

const tempDirs: string[] = []

afterEach(() => {
  for (const path of tempDirs.splice(0)) rmSync(path, { force: true, recursive: true })
})

function migration(
  source: string,
  filename: string,
  sql = `CREATE TABLE ${source.replaceAll(':', '_')};`,
): MigrationFile {
  return {
    checksum: checksumMigrationSql(sql),
    filename,
    path: `/tmp/${source}-${filename}`,
    source,
    sourceVersion: '1.0.0',
  }
}

describe('migration config and planning', () => {
  it('accepts the app manifest shape and records a safe default source version', () => {
    const config = parseMigrationConfig({ sources: [{ id: 'app', dir: 'drizzle' }] })
    expect(config.sources[0]?.sourceVersion).toBe('unversioned')
  })

  it('orders every package source before app source', () => {
    const config: MigrationConfig = parseMigrationConfig({
      sources: [
        { id: 'app', dir: 'app-sql', sourceVersion: 'app' },
        { id: '@narduk-enterprises/b', dir: 'b-sql', sourceVersion: '2' },
        { id: '@narduk-enterprises/a', dir: 'a-sql', sourceVersion: '1' },
      ],
    })
    expect(orderMigrationSources(config.sources).map((source) => source.source)).toEqual([
      '@narduk-enterprises/b',
      '@narduk-enterprises/a',
      'app',
    ])
  })

  it('keeps the same filename independent for two sources', () => {
    const plan = planMigrations({
      migrations: [migration('package:a', '0001.sql'), migration('app', '0001.sql')],
    })
    expect(plan.actions.map((action) => `${action.source}:${action.filename}`)).toEqual([
      'package:a:0001.sql',
      'app:0001.sql',
    ])
    expect(plan.apply).toBe(2)
    expect(migrationLedgerCreateSql()).toContain('PRIMARY KEY (source, filename)')
  })

  it('fails closed on checksum drift', () => {
    const file = migration('app', '0001.sql')
    expect(() =>
      planMigrations({ migrations: [file], ledgerRows: [{ ...file, checksum: 'changed' }] }),
    ).toThrow('checksum changed')
  })

  it('makes the second run a no-op', () => {
    const file = migration('app', '0001.sql')
    const plan = buildMigrationPlan({
      migrations: [file],
      ledgerRows: [{ source: file.source, filename: file.filename, checksum: file.checksum }],
    })
    expect(plan).toMatchObject({ apply: 0, adopt: 0, skip: 1 })
    expect(plan.actions[0]?.kind).toBe('skip')
  })

  it('refuses ambiguous legacy rows without adoption evidence', () => {
    expect(() =>
      planMigrations({
        migrations: [migration('package:a', '0001.sql')],
        ledgerRows: [{ filename: '0001.sql' }],
      }),
    ).toThrow('Ambiguous legacy migration row refused')
  })

  it('adopts an ambiguous row only with exact checksum and schema evidence', () => {
    const file = migration('package:a', '0001.sql')
    const plan = planMigrations({
      migrations: [file],
      ledgerRows: [{ source: 'bundle:old', filename: '0001.sql' }],
      adoptions: [
        {
          evidence: { tables: ['users'], columns: [{ table: 'users', column: 'id' }] },
          filename: file.filename,
          legacy: { source: 'bundle:old', filename: '0001.sql' },
          checksum: file.checksum,
          source: file.source,
          sourceVersion: file.sourceVersion,
        },
      ],
      schemaEvidence: { tables: ['users'], columns: [{ table: 'users', column: 'id' }] },
    })
    expect(plan).toMatchObject({ apply: 0, adopt: 1, skip: 0 })
    expect(plan.actions[0]?.kind).toBe('adopt')
  })

  it('discovers files and applies package-before-app ordering', () => {
    const root = mkdtempSync(join(tmpdir(), 'narduk-app-migrations-'))
    tempDirs.push(root)
    mkdirSync(join(root, 'app'), { recursive: true })
    mkdirSync(join(root, 'pkg'), { recursive: true })
    writeFileSync(join(root, 'app', '0001.sql'), 'app')
    writeFileSync(join(root, 'pkg', '0000.sql'), 'pkg')
    const config = parseMigrationConfig({
      sources: [
        { source: 'app', path: 'app', sourceVersion: 'app' },
        { source: 'package:core', path: 'pkg', sourceVersion: '1' },
      ],
    })
    expect(discoverMigrations(config, root).map((file) => file.source)).toEqual([
      'package:core',
      'app',
    ])
    expect(readFileSync(join(root, 'app', '0001.sql'), 'utf8')).toBe('app')
  })

  it('builds credential-free Wrangler planning args and enforces reset scope', () => {
    expect(
      buildWranglerD1ExecuteArgs({
        database: 'app-db',
        location: '--local',
        sql: 'SELECT 1;',
        json: true,
      }),
    ).toEqual(['d1', 'execute', 'app-db', '--local', '--json', '--command', 'SELECT 1;'])
    expect(validateMigrationReset('--local')).toBe(false)
    expect(validateMigrationReset('--local', true)).toBe(true)
    expect(() => validateMigrationReset('--remote', true)).toThrow(
      'Refusing remote migration reset',
    )
  })
})
