import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import {
  captureMigrationBaseline,
  inspectMigrations,
  proveMigrationBaseline,
  registerMigrationBaseline,
  runMigrations,
  checksumMigrationSql,
  MIGRATION_LOCK_TABLE,
  migrationLedgerCreateSql,
  type MigrationExecutor,
  type MigrationBaselineRegistrationOptions,
} from '../src/migrations.js'
import {
  assertBaselineState,
  migrationBaselineSql,
  parseMigrationBaseline,
  BASELINE_RECEIPTS_TABLE,
} from '../src/migration-baseline.js'
import { runBaselineCommand } from '../src/commands/baseline.js'

const cleanups: Array<() => void> = []
afterEach(() => {
  for (const fn of cleanups.splice(0)) fn()
})
const target = { accountId: 'a'.repeat(32), databaseId: '11111111-2222-4333-8444-555555555555' }
const revision = 'b'.repeat(40)
function fixture(schema = 'CREATE TABLE records (id TEXT PRIMARY KEY, value TEXT NOT NULL);') {
  const root = mkdtempSync(join(tmpdir(), 'narduk-baseline-test-'))
  const db = new DatabaseSync(':memory:')
  db.exec(schema)
  cleanups.push(() => {
    db.close()
    rmSync(root, { recursive: true, force: true })
  })
  mkdirSync(join(root, 'sql'))
  const configFile = join(root, 'sources.json')
  writeFileSync(
    configFile,
    JSON.stringify({ sources: [{ source: 'app:read-model', path: 'sql', sourceVersion: '1' }] }),
  )
  const calls: string[][] = []
  const executor: MigrationExecutor = (args) => {
    calls.push(args)
    if (args.includes('time-travel')) return '{"bookmark":"before-baseline"}'
    const file = args.find((arg) => arg.startsWith('--file='))
    if (file) {
      db.exec('BEGIN')
      try {
        db.exec(readFileSync(file.slice(7), 'utf8'))
        db.exec('COMMIT')
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
      return ''
    }
    const sql = args[args.indexOf('--command') + 1]!
    if (args.includes('--json'))
      return JSON.stringify([{ success: true, results: db.prepare(sql).all() }])
    db.exec(sql)
    return ''
  }
  const options = {
    cwd: root,
    database: 'DB',
    configFile,
    location: '--remote' as const,
    target,
    wranglerConfig: join(root, 'wrangler.json'),
  }
  writeFileSync(
    options.wranglerConfig,
    JSON.stringify({
      account_id: target.accountId,
      d1_databases: [{ binding: 'DB', database_name: 'example', database_id: target.databaseId }],
    }),
  )
  const capture = () => captureMigrationBaseline({ ...options, revision }, executor)
  return { root, db, options, executor, calls, capture }
}
function untracked() {
  const f = fixture()
  const artifact = f.capture()
  writeFileSync(join(f.root, 'sql', '0000_baseline.sql'), migrationBaselineSql(artifact))
  const registration: MigrationBaselineRegistrationOptions = {
    ...f.options,
    source: 'app:read-model',
    filename: '0000_baseline.sql',
    expectedDigest: artifact.digest,
    reviewRef: 'https://github.com/example/app/pull/1',
  }
  return { ...f, artifact, registration }
}

describe('reviewed D1 baseline process', () => {
  it('captures a fixed complete schema and metadata without reading application rows or writing', () => {
    const f = fixture(
      'CREATE TABLE records (id TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE INDEX by_value ON records(value); CREATE VIEW values_view AS SELECT value FROM records; CREATE TRIGGER record_insert AFTER INSERT ON records BEGIN UPDATE records SET value=upper(new.value) WHERE id=new.id; END;',
    )
    f.db.exec("INSERT INTO records VALUES ('one','private-record')")
    const artifact = f.capture()
    expect(artifact.objects.map((row) => row.type).sort()).toEqual([
      'index',
      'table',
      'trigger',
      'view',
    ])
    expect(JSON.stringify(artifact)).not.toContain('PRIVATE-RECORD')
    expect(f.calls.every((args) => args.includes('--json'))).toBe(true)
    expect(parseMigrationBaseline(JSON.parse(JSON.stringify(artifact)))).toEqual(artifact)
    expect(() => parseMigrationBaseline({ ...artifact, revision: 'c'.repeat(40) })).toThrow(
      'digest mismatch',
    )
  })
  it('rejects an active lock, a schema race, and unsupported virtual tables', () => {
    const locked = fixture()
    locked.db.exec(
      `CREATE TABLE ${MIGRATION_LOCK_TABLE} (owner TEXT); INSERT INTO ${MIGRATION_LOCK_TABLE} VALUES ('other');`,
    )
    expect(locked.capture).toThrow('locked')
    const raced = fixture()
    let reads = 0
    const executor: MigrationExecutor = (args, cwd, json) => {
      if (args.some((arg) => arg.includes("tbl_name AS 'table'")) && ++reads === 2)
        raced.db.exec('ALTER TABLE records ADD COLUMN extra TEXT')
      return raced.executor(args, cwd, json)
    }
    expect(() => captureMigrationBaseline({ ...raced.options, revision }, executor)).toThrow(
      'objects differ',
    )
    const virtual = fixture('CREATE VIRTUAL TABLE search USING fts5(text)')
    expect(virtual.capture).toThrow('Unsupported baseline DDL')
  })
  it('compares actual DDL, not just matching names or counts, across separate targets', () => {
    const a = fixture()
    const b = fixture()
    expect(() =>
      assertBaselineState(
        a.capture(),
        captureMigrationBaseline(
          {
            ...b.options,
            target: { ...target, databaseId: '66666666-2222-4333-8444-555555555555' },
            revision,
          },
          b.executor,
        ),
      ),
    ).not.toThrow()
    b.db.exec('ALTER TABLE records ADD COLUMN missing_in_baseline TEXT')
    expect(() => assertBaselineState(a.capture(), b.capture())).toThrow('objects differ')
  })
  it('registers only metadata, preserves rows, and leaves later migrations pending', () => {
    const f = untracked()
    f.db.exec("INSERT INTO records VALUES ('one','preserve')")
    writeFileSync(join(f.root, 'sql', '0001_future.sql'), 'CREATE TABLE next (id TEXT);')
    expect(() => inspectMigrations(f.options, f.executor)).toThrow('explicit reviewed baseline')
    const result = registerMigrationBaseline(f.registration, f.artifact, f.executor)
    expect(result.recoveryPath).toBeTruthy()
    expect(JSON.parse(readFileSync(result.recoveryPath!, 'utf8')).timeTravelBookmark).toBe(
      'before-baseline',
    )
    expect(f.db.prepare('SELECT value FROM records').get()?.value).toBe('preserve')
    expect(
      f.db.prepare(`SELECT review_ref FROM ${BASELINE_RECEIPTS_TABLE}`).get()?.review_ref,
    ).toBe(f.registration.reviewRef)
    expect(inspectMigrations(f.options, f.executor)).toMatchObject({ apply: 1, skip: 1 })
    expect(f.db.prepare(`SELECT * FROM ${MIGRATION_LOCK_TABLE}`).all()).toEqual([])
    expect(() => registerMigrationBaseline(f.registration, f.artifact, f.executor)).toThrow(
      'migrations differ',
    )
  })
  it('refuses wrong review digest, changed baseline SQL, history, and changed target before writes', () => {
    const f = untracked()
    const start = f.calls.length
    expect(() =>
      registerMigrationBaseline(
        { ...f.registration, expectedDigest: '0'.repeat(64) },
        f.artifact,
        f.executor,
      ),
    ).toThrow('digest')
    expect(f.calls.length).toBe(start)
    f.db.exec('CREATE TABLE unexpected (id TEXT)')
    expect(() => registerMigrationBaseline(f.registration, f.artifact, f.executor)).toThrow(
      'objects differ',
    )
    expect(f.calls.slice(start).every((args) => args.includes('--json'))).toBe(true)
    writeFileSync(join(f.root, 'sql', '0000_baseline.sql'), 'SELECT 1;')
    expect(() => registerMigrationBaseline(f.registration, f.artifact, f.executor)).toThrow(
      'exactly match',
    )
    const tracked = untracked()
    tracked.db.exec(
      "CREATE TABLE _applied_migrations (filename TEXT); INSERT INTO _applied_migrations VALUES ('old.sql')",
    )
    const trackedArtifact = tracked.capture()
    expect(() =>
      registerMigrationBaseline(
        { ...tracked.registration, expectedDigest: trackedArtifact.digest },
        trackedArtifact,
        tracked.executor,
      ),
    ).toThrow('only for untracked')
  })
  it('refuses an ambiguous source name before a registration can write a ledger', () => {
    const f = untracked()
    writeFileSync(
      f.options.configFile,
      JSON.stringify({ sources: [{ source: 'read-model', path: 'sql', sourceVersion: '1' }] }),
    )
    const before = f.calls.length
    expect(() =>
      registerMigrationBaseline(
        { ...f.registration, source: 'read-model' },
        f.artifact,
        f.executor,
      ),
    ).toThrow('app-owned baseline source')
    expect(f.calls.length).toBe(before)
    expect(
      f.db.prepare("SELECT name FROM sqlite_master WHERE name='_narduk_migrations'").all(),
    ).toEqual([])
  })
  it('rechecks schema under the shared lock and retains the remote lock on a registration failure', () => {
    const f = untracked()
    const executor: MigrationExecutor = (args, cwd, json) => {
      const result = f.executor(args, cwd, json)
      if (args.some((arg) => arg.startsWith(`INSERT INTO ${MIGRATION_LOCK_TABLE}`)))
        f.db.exec('ALTER TABLE records ADD COLUMN raced TEXT')
      return result
    }
    expect(() => registerMigrationBaseline(f.registration, f.artifact, executor)).toThrow(
      'lock owner',
    )
    expect(f.db.prepare(`SELECT * FROM ${MIGRATION_LOCK_TABLE}`).all()).toHaveLength(1)
    expect(
      f.db.prepare("SELECT name FROM sqlite_master WHERE name='_narduk_migrations'").all(),
    ).toEqual([])
  })
  it('proves an untracked read-model cutover in disposable local state without replaying its initial SQL', () => {
    const f = untracked()
    writeFileSync(join(f.root, 'sql', '0001_drop.sql'), 'DROP TABLE records;')
    const local = fixture('')
    const result = proveMigrationBaseline(
      f.artifact,
      { ...f.options, source: f.registration.source, filename: f.registration.filename },
      local.executor,
    )
    expect(result).toMatchObject({ apply: 1, skip: 1 })
    expect(
      local.calls.every(
        (args) =>
          args.includes('--local') && args.includes('--persist-to') && !args.includes('--remote'),
      ),
    ).toBe(true)
    expect(f.db.prepare("SELECT name FROM sqlite_master WHERE name='records'").all()).toHaveLength(
      1,
    )
  })
  it('preserves package cutover evidence after a version bump and destructive package migration', () => {
    const f = fixture('CREATE TABLE old_table (id TEXT);')
    const sql = 'CREATE TABLE old_table (id TEXT);'
    writeFileSync(join(f.root, 'sql', '0001.sql'), sql)
    f.db.exec(
      `${migrationLedgerCreateSql()} INSERT INTO _narduk_migrations VALUES ('package:core','0001.sql','${checksumMigrationSql(sql)}','1','cutover'); CREATE TABLE _applied_migrations (filename TEXT); INSERT INTO _applied_migrations VALUES ('old.sql');`,
    )
    const artifact = f.capture()
    writeFileSync(
      f.options.configFile,
      JSON.stringify({
        sources: [{ source: 'package:core', path: 'sql', sourceVersion: '2' }],
        adoptions: [
          {
            source: 'package:core',
            filename: '0001.sql',
            checksum: checksumMigrationSql(sql),
            sourceVersion: '1',
            legacyFilename: 'old.sql',
            evidence: { tables: ['old_table'] },
          },
        ],
      }),
    )
    writeFileSync(join(f.root, 'sql', '0002.sql'), 'DROP TABLE old_table;')
    const local = fixture('')
    expect(proveMigrationBaseline(artifact, f.options, local.executor)).toMatchObject({
      apply: 1,
      skip: 1,
    })
    expect(runMigrations({ ...f.options, location: '--local' }, local.executor)).toMatchObject({
      apply: 0,
      skip: 2,
    })
    expect(artifact.migrations[0]?.sourceVersion).toBe('1')
    // Removing the adopted stable receipt must not let the old probe disappear.
    local.db.exec("DELETE FROM _narduk_migrations WHERE filename='0001.sql'")
    expect(() => inspectMigrations(f.options, local.executor)).toThrow('source version')
  })
  it('CLI refuses a wrong explicit target and remote flags on local proof', () => {
    const f = untracked()
    const path = join(f.root, 'artifact.json')
    writeFileSync(path, JSON.stringify(f.artifact))
    expect(() =>
      runBaselineCommand(
        ['prove', '--artifact', path, '--config', f.options.configFile, '--remote'],
        f.root,
        f.executor,
      ),
    ).toThrow('Unexpected')
    expect(() =>
      runBaselineCommand(
        [
          'register',
          '--artifact',
          path,
          '--wrangler-config',
          f.options.wranglerConfig,
          '--database',
          'DB',
          '--local',
          '--persist-to',
          join(f.root, 'state'),
          '--expect-database-id',
          'wrong',
        ],
        f.root,
        f.executor,
      ),
    ).toThrow('database ID')
    const output = join(f.root, 'frozen.sql')
    runBaselineCommand(['sql', '--artifact', path, '--output', output], f.root)
    expect(readFileSync(output, 'utf8')).toBe(migrationBaselineSql(f.artifact))
    expect(() =>
      runBaselineCommand(['sql', '--artifact', path, '--output', output], f.root),
    ).toThrow('EEXIST')
  })
})
