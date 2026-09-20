import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it, afterEach } from 'vitest'

import {
  buildMigrationPlan,
  buildMigrationBatchSql,
  buildWranglerD1ExecuteArgs,
  buildWranglerTimeTravelInfoArgs,
  checksumMigrationSql,
  discoverMigrations,
  migrationLedgerCreateSql,
  migrationSqlTouchesRunnerLedger,
  orderMigrationSources,
  parseMigrationConfig,
  parseTimeTravelBookmark,
  planMigrations,
  resolveMigrationConfigVersions,
  stripSqlComments,
  validateMigrationReset,
  type MigrationConfig,
  type MigrationFile,
} from '../src/migrations.js'

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
  it('accepts the app manifest shape and defers version resolution until paths are known', () => {
    const config = parseMigrationConfig({ sources: [{ id: 'app', dir: 'drizzle' }] })
    expect(config.sources[0]?.sourceVersion).toBe('unversioned')
  })

  it('resolves omitted source versions from owning package manifests', () => {
    const root = mkdtempSync(join(tmpdir(), 'narduk-app-migration-versions-'))
    tempDirs.push(root)
    const appMigrations = join(root, 'drizzle')
    const coreRoot = join(root, 'node_modules', '@narduk-enterprises', 'narduk-core')
    mkdirSync(appMigrations, { recursive: true })
    mkdirSync(join(coreRoot, 'runtime', 'drizzle'), { recursive: true })
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'web', version: '0.1.0' }))
    writeFileSync(
      join(coreRoot, 'package.json'),
      JSON.stringify({ name: '@narduk-enterprises/narduk-core', version: '1.19.40' }),
    )
    const config = resolveMigrationConfigVersions(
      parseMigrationConfig({
        sources: [
          {
            id: '@narduk-enterprises/narduk-core',
            dir: 'node_modules/@narduk-enterprises/narduk-core/runtime/drizzle',
          },
          { id: 'app', dir: 'drizzle' },
        ],
      }),
      root,
    )
    expect(config.sources.map(({ source, sourceVersion }) => [source, sourceVersion])).toEqual([
      ['@narduk-enterprises/narduk-core', '1.19.40'],
      ['app', '0.1.0'],
    ])
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
          evidence: {
            tables: ['users'],
            columns: [{ table: 'users', column: 'id' }],
            indexes: [{ table: 'users', name: 'users_email_idx' }],
          },
          filename: file.filename,
          legacy: { source: 'bundle:old', filename: '0001.sql' },
          checksum: file.checksum,
          source: file.source,
          sourceVersion: file.sourceVersion,
        },
      ],
      schemaEvidence: {
        tables: ['users'],
        columns: [{ table: 'users', column: 'id' }],
        indexes: [{ table: 'users', name: 'users_email_idx' }],
      },
    })
    expect(plan).toMatchObject({ apply: 0, adopt: 1, skip: 0 })
    expect(plan.actions[0]?.kind).toBe('adopt')
  })

  it('does not require adoption evidence when a fresh database has no legacy row', () => {
    const file = migration('package:a', '0001.sql')
    const plan = planMigrations({
      migrations: [file],
      adoptions: [
        {
          evidence: { tables: ['users'] },
          filename: file.filename,
          legacy: { filename: file.filename },
          checksum: file.checksum,
          source: file.source,
          sourceVersion: file.sourceVersion,
        },
      ],
    })

    expect(plan).toMatchObject({ apply: 1, adopt: 0, skip: 0 })
    expect(plan.actions[0]?.kind).toBe('apply')
  })

  it('fails legacy adoption when the required index is absent', () => {
    const file = migration('package:a', '0001.sql')
    expect(() =>
      planMigrations({
        migrations: [file],
        ledgerRows: [{ filename: file.filename }],
        adoptions: [
          {
            evidence: {
              tables: ['users'],
              indexes: [{ table: 'users', name: 'users_email_idx' }],
            },
            filename: file.filename,
            legacy: { filename: file.filename },
            checksum: file.checksum,
            source: file.source,
            sourceVersion: file.sourceVersion,
          },
        ],
        schemaEvidence: { tables: ['users'], columns: [], indexes: [] },
      }),
    ).toThrow('did not find index users.users_email_idx')
  })

  it('discovers files and applies package-before-app ordering', () => {
    const root = mkdtempSync(join(tmpdir(), 'narduk-app-migrations-'))
    tempDirs.push(root)
    mkdirSync(join(root, 'app'), { recursive: true })
    mkdirSync(join(root, 'pkg'), { recursive: true })
    writeFileSync(join(root, 'app', '0001.sql'), 'app')
    writeFileSync(join(root, 'pkg', '0000.sql'), 'pkg')
    writeFileSync(join(root, 'pkg', 'seed.sql'), 'must never run')
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
    expect(discoverMigrations(config, root).some((file) => file.filename === 'seed.sql')).toBe(
      false,
    )
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
    expect(buildWranglerTimeTravelInfoArgs('app-db')).toEqual([
      'd1',
      'time-travel',
      'info',
      'app-db',
      '--json',
    ])
    expect(parseTimeTravelBookmark('{"bookmark":"0000-test"}')).toBe('0000-test')
    expect(() => parseTimeTravelBookmark('{}')).toThrow('Time Travel bookmark')
  })

  it('batches migration SQL and its stable ledger record in one D1 execution', () => {
    const file = migration('app', '0001.sql', 'CREATE TABLE example (id TEXT);')
    const sql = buildMigrationBatchSql(
      { ...file, kind: 'apply' },
      'CREATE TABLE example (id TEXT);',
    )
    expect(sql).toContain('CREATE TABLE example')
    expect(sql).toContain('INSERT INTO _narduk_migrations')
    expect(sql).toContain("'app', '0001.sql'")
  })

  describe('the runner-ledger guard', () => {
    const build = (body: string) =>
      buildMigrationBatchSql({ ...migration('app', '0001.sql', body), kind: 'apply' }, body)

    it('lets a migration document the ledger it deliberately leaves alone', () => {
      // riverstatus 0010_drop_unread_ingestion_tables.sql explains, in a
      // comment, which bookkeeping tables it is NOT dropping. That comment
      // blocked every deploy of that app (riverstatus#182).
      const body = [
        '-- Tables kept on purpose:',
        '--   * _applied_migrations and _narduk_migrations are migration bookkeeping.',
        '/* _narduk_migration_lock is the runner lock; never touched here. */',
        'DROP TABLE IF EXISTS observations;',
      ].join('\n')
      expect(() => build(body)).not.toThrow()
      expect(build(body)).toContain('DROP TABLE IF EXISTS observations')
    })

    it('still refuses a statement that alters the ledger', () => {
      expect(() => build('DELETE FROM _narduk_migrations;')).toThrow(
        'may not alter the runner ledger or lock',
      )
    })

    it('still refuses the ledger named through a quoted identifier', () => {
      // Quoted text is preserved, so this cannot be smuggled past the guard.
      expect(() => build('DELETE FROM "_narduk_migrations";')).toThrow(
        'may not alter the runner ledger or lock',
      )
      expect(() => build('DELETE FROM `_narduk_migrations`;')).toThrow(
        'may not alter the runner ledger or lock',
      )
    })

    it('does not treat a double dash inside a string literal as a comment', () => {
      // A naive stripper would blank the rest of the line and miss the DELETE.
      expect(() =>
        build("INSERT INTO notes (body) VALUES ('a -- b'); DELETE FROM _narduk_migrations;"),
      ).toThrow('may not alter the runner ledger or lock')
    })

    it('does not treat a double dash inside a bracket identifier as a comment', () => {
      // SQLite reads `[body -- x]` as one identifier and runs the DELETE;
      // verified in sqlite3, ledger count 0. A stripper that stopped at the
      // `--` would blank the DELETE away and let the migration through.
      expect(() =>
        build('CREATE TABLE notes ([body -- x] TEXT); DELETE FROM _narduk_migrations;'),
      ).toThrow('may not alter the runner ledger or lock')
      expect(() =>
        build('CREATE TABLE notes ([body /* x] TEXT); DELETE FROM _narduk_migrations;'),
      ).toThrow('may not alter the runner ledger or lock')
    })

    it('strips comments without disturbing the SQL it returns', () => {
      expect(stripSqlComments('SELECT 1; -- _narduk_migrations\nSELECT 2;')).toBe(
        'SELECT 1; \nSELECT 2;',
      )
      expect(stripSqlComments("SELECT '-- not a comment';")).toBe("SELECT '-- not a comment';")
      expect(stripSqlComments('SELECT [-- not a comment];')).toBe('SELECT [-- not a comment];')
      expect(migrationSqlTouchesRunnerLedger('-- _narduk_migrations')).toBe(false)
      expect(migrationSqlTouchesRunnerLedger('DROP TABLE _narduk_migration_lock;')).toBe(true)
    })
  })
})
