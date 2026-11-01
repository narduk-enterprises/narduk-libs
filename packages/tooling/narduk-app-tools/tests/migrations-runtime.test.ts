import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import {
  checksumMigrationSql,
  inspectMigrations,
  runMigrations,
  LOCAL_BATCH_MAX_BYTES,
  MIGRATION_LOCK_STALE_AFTER_SECONDS,
  MIGRATION_LOCK_TABLE,
  parseWranglerBatchJson,
  resolveMigrationLockIdentity,
  parseWranglerJson,
  type MigrationExecutor,
  type MigrationRunOptions,
} from '../src/migrations.js'
import { wranglerJson } from './wrangler-d1-fake.js'

const cleanup: Array<() => void> = []
afterEach(() => {
  for (const fn of cleanup.splice(0)) fn()
})
function fixture(sql = 'CREATE TABLE example (id TEXT);') {
  const root = mkdtempSync(join(tmpdir(), 'narduk-migration-runtime-'))
  const db = new DatabaseSync(':memory:')
  cleanup.push(() => {
    db.close()
    rmSync(root, { recursive: true, force: true })
  })
  mkdirSync(join(root, 'sql'))
  writeFileSync(join(root, 'sql', '0001.sql'), sql)
  writeFileSync(
    join(root, 'sources.json'),
    JSON.stringify({ sources: [{ source: 'app', path: 'sql', sourceVersion: '1' }] }),
  )
  const calls: string[][] = []
  const executor: MigrationExecutor = (args) => {
    calls.push(args)
    if (args.includes('time-travel')) return '{"bookmark":"test-bookmark"}'
    const file = args.find((arg) => arg.startsWith('--file='))
    if (file) {
      db.exec('BEGIN;')
      try {
        db.exec(readFileSync(file.slice(7), 'utf8'))
        db.exec('COMMIT;')
      } catch (e) {
        db.exec('ROLLBACK;')
        throw e
      }
      return ''
    }
    const command = args[args.indexOf('--command') + 1]!
    if (args.includes('--json')) return wranglerJson(db, command)
    db.exec(command)
    return ''
  }
  const options: MigrationRunOptions = {
    cwd: root,
    configFile: 'sources.json',
    database: 'DB',
    location: '--remote',
    wranglerConfig: 'explicit.json',
  }
  return { root, db, executor, options, calls }
}

describe('D1 migration database protocol', () => {
  it('inspects an empty database without any write, snapshot or lock', () => {
    const f = fixture()
    expect(inspectMigrations(f.options, f.executor)).toMatchObject({ apply: 1, skip: 0 })
    expect(f.db.prepare('SELECT name FROM sqlite_master').all()).toEqual([])
    expect(f.calls.every((args) => args.includes('--json') && args.includes('--config'))).toBe(true)
  })
  it.each([false, true])(
    'refuses untracked existing schema even with an empty manifest: %s',
    (empty) => {
      const f = fixture()
      f.db.exec('CREATE TABLE untracked (id TEXT);')
      if (empty) rmSync(join(f.root, 'sql', '0001.sql'))
      expect(() => inspectMigrations(f.options, f.executor)).toThrow(
        'explicit reviewed baseline evidence',
      )
      expect(() => runMigrations(f.options, f.executor)).toThrow(
        'explicit reviewed baseline evidence',
      )
      expect(f.calls.every((args) => args.includes('--json'))).toBe(true)
      expect(
        f.db.prepare(`SELECT name FROM sqlite_master WHERE name='${MIGRATION_LOCK_TABLE}'`).all(),
      ).toEqual([])
    },
  )
  it('allows a fresh database that only contains D1 internal tables', () => {
    const f = fixture()
    f.db.exec('CREATE TABLE _cf_KV (key TEXT);')
    expect(inspectMigrations(f.options, f.executor).apply).toBe(1)
  })
  it('applies once, records checksum, captures recovery before SQL, and releases the lock', () => {
    const f = fixture()
    const result = runMigrations(f.options, f.executor)
    expect(result).toMatchObject({ apply: 1, skip: 0 })
    expect(JSON.parse(readFileSync(result.recoveryPath!, 'utf8')).timeTravelBookmark).toBe(
      'test-bookmark',
    )
    expect(f.calls.findIndex((args) => args.includes('time-travel'))).toBeLessThan(
      f.calls.findIndex((args) => args.some((arg) => arg.startsWith('--file='))),
    )
    expect(runMigrations(f.options, f.executor)).toMatchObject({ apply: 0, skip: 1 })
    expect(f.db.prepare(`SELECT * FROM ${MIGRATION_LOCK_TABLE}`).all()).toEqual([])
    expect(inspectMigrations(f.options, f.executor)).toMatchObject({ apply: 0, skip: 1 })
  })
  it('rejects another runner using a different binding name for the same database', () => {
    const f = fixture()
    let raced = false
    const execute: MigrationExecutor = (args, cwd, json) => {
      if (args.includes('time-travel') && !raced) {
        raced = true
        expect(() => runMigrations({ ...f.options, database: 'OTHER_ALIAS' }, f.executor)).toThrow(
          'Could not acquire',
        )
      }
      return f.executor(args, cwd, json)
    }
    runMigrations(f.options, execute)
    expect(raced).toBe(true)
    expect(f.db.prepare('SELECT count(*) AS n FROM _narduk_migrations').get()?.n).toBe(1)
  })
  it('retains the lock on an uncertain remote failure and blocks status and retries', () => {
    const f = fixture('CREATE TABLE example (id TEXT); INSERT INTO missing VALUES (1);')
    expect(() => runMigrations(f.options, f.executor)).toThrow('lock owner')
    expect(f.db.prepare(`SELECT * FROM ${MIGRATION_LOCK_TABLE}`).all()).toHaveLength(1)
    expect(() => inspectMigrations(f.options, f.executor)).toThrow('locked')
    expect(() => runMigrations(f.options, f.executor)).toThrow('Could not acquire')
    expect(f.db.prepare("SELECT name FROM sqlite_master WHERE name='example'").all()).toEqual([])
  })
  it('refuses checksum drift before a write and refuses removed applied migrations', () => {
    const f = fixture()
    runMigrations(f.options, f.executor)
    writeFileSync(join(f.root, 'sql', '0001.sql'), 'CREATE TABLE changed (id TEXT);')
    f.calls.length = 0
    expect(() => runMigrations(f.options, f.executor)).toThrow('checksum changed')
    expect(f.calls.every((args) => args.includes('--json'))).toBe(true)
    rmSync(join(f.root, 'sql', '0001.sql'))
    expect(() => inspectMigrations(f.options, f.executor)).toThrow('absent from this checkout')
  })
  it('preserves a committed file and retains the lock when its response is lost', () => {
    const f = fixture()
    const execute: MigrationExecutor = (args, cwd, json) => {
      const result = f.executor(args, cwd, json)
      if (args.some((arg) => arg.startsWith('--file=')))
        throw new Error('response lost after commit')
      return result
    }
    expect(() => runMigrations(f.options, execute)).toThrow('response lost after commit')
    expect(f.db.prepare('SELECT count(*) AS n FROM _narduk_migrations').get()?.n).toBe(1)
    expect(f.db.prepare(`SELECT * FROM ${MIGRATION_LOCK_TABLE}`).all()).toHaveLength(1)
    expect(() => inspectMigrations(f.options, f.executor)).toThrow('locked')
  })
  it('does not roll back an earlier file when a later file fails', () => {
    const f = fixture()
    writeFileSync(join(f.root, 'sql', '0002.sql'), 'INSERT INTO absent_table VALUES (1);')
    expect(() => runMigrations(f.options, f.executor)).toThrow('retained')
    expect(f.db.prepare('SELECT filename FROM _narduk_migrations').all()).toEqual([
      { filename: '0001.sql' },
    ])
    expect(f.db.prepare("SELECT name FROM sqlite_master WHERE name='example'").all()).toHaveLength(
      1,
    )
  })
  it('does not silently replay native Wrangler migrations', () => {
    const f = fixture()
    f.db.exec(
      "CREATE TABLE d1_migrations (name TEXT); INSERT INTO d1_migrations VALUES ('0001.sql');",
    )
    expect(() => inspectMigrations(f.options, f.executor)).toThrow(
      'Ambiguous legacy migration row refused: wrangler:0001.sql',
    )
  })
  it.each(['{}', '[]', '[{"success":false,"results":[]}]', '[{"success":true}]'])(
    'fails closed on malformed batched output %s',
    (output) => {
      expect(() => parseWranglerBatchJson(output, 1)).toThrow()
    },
  )
  it("never reads one statement's result as another's", () => {
    const two = '[{"success":true,"results":[]},{"success":true,"results":[{"a":1}]}]'
    expect(parseWranglerBatchJson(two, 2)).toEqual([[], [{ a: 1 }]])
    expect(() => parseWranglerBatchJson(two, 3)).toThrow('2 D1 result sets for 3 statements')
  })
  it('parses remote /query result sets, preserving empty PRAGMAs and statement order', () => {
    // Wrangler prints the /query response's result array, without its API envelope.
    const output = JSON.stringify([
      { success: true, results: [{ name: 'example' }], meta: { rows_read: 1 } },
      { success: true, results: [], meta: { rows_read: 0 } },
      { success: true, results: [{ name: 'id', pk: 0 }], meta: { rows_read: 1 } },
    ])
    expect(parseWranglerBatchJson(output, 3)).toEqual([
      [{ name: 'example' }],
      [],
      [{ name: 'id', pk: 0 }],
    ])
    expect(() => parseWranglerBatchJson(output, 2)).toThrow('3 D1 result sets for 2 statements')
  })
  it.each([
    '[{"success":true,"results":[]}]',
    '[{"success":true,"results":[]},{"success":false,"results":[]}]',
    '[{"success":true,"results":[]},{"success":true,"results":null}]',
  ])('refuses a malformed remote inspection before any write: %s', (output) => {
    const f = fixture()
    const execute: MigrationExecutor = (args) => {
      f.calls.push(args)
      return output
    }
    expect(() => runMigrations(f.options, execute)).toThrow('Wrangler returned')
    expect(spawns(f.calls)).toEqual({ total: 1, reads: 1, writes: 0 })
    expect(f.db.prepare('SELECT name FROM sqlite_master').all()).toEqual([])
  })
  it.each(['{}', '[]', '[{"success":false,"results":[]}]', '[{"success":true}]'])(
    'fails closed on malformed provider output %s',
    (output) => {
      expect(() => parseWranglerJson(output)).toThrow()
    },
  )
})

/** Every wrangler process a run started, by kind. */
function spawns(calls: string[][]) {
  const commands = calls.filter((args) => args.includes('--command'))
  return {
    total: calls.length,
    reads: commands.filter((args) => args.includes('--json')).length,
    writes: calls.length - commands.filter((args) => args.includes('--json')).length,
  }
}

describe('wrangler process count (narduk-libs#704)', () => {
  function withHistory() {
    const f = fixture()
    writeFileSync(join(f.root, 'sql', '0002.sql'), 'CREATE TABLE second (id TEXT);')
    writeFileSync(join(f.root, 'sql', '0003.sql'), 'CREATE INDEX second_id ON second (id);')
    // Legacy ledgers are read too; make both present so every read is exercised.
    f.db.exec(
      'CREATE TABLE _applied_migrations (filename TEXT); CREATE TABLE d1_migrations (name TEXT);',
    )
    const local: MigrationRunOptions = { ...f.options, location: '--local' }
    return { ...f, local }
  }

  it.each(['--local', '--remote'] as const)(
    'a warm %s run is two read processes, and writes nothing',
    (location) => {
      const f = withHistory()
      const options = { ...f.options, location }
      expect(runMigrations(options, f.executor)).toMatchObject({ apply: 3, skip: 0 })
      f.calls.length = 0
      expect(runMigrations(options, f.executor)).toMatchObject({ apply: 0, skip: 3 })
      // Before: three inspections of five reads each plus three lock statements.
      expect(spawns(f.calls)).toEqual({ total: 2, reads: 2, writes: 0 })
      expect(f.db.prepare(`SELECT * FROM ${MIGRATION_LOCK_TABLE}`).all()).toEqual([])
    },
  )

  it('reads the lock and every ledger in the same --local process', () => {
    const f = withHistory()
    runMigrations(f.local, f.executor)
    f.calls.length = 0
    runMigrations(f.local, f.executor)
    const second = f.calls[1]!
    const sql = second[second.indexOf('--command') + 1]!
    for (const table of [
      MIGRATION_LOCK_TABLE,
      '_narduk_migrations',
      '_applied_migrations',
      'd1_migrations',
    ]) {
      expect(sql).toContain(`FROM ${table}`)
    }
  })

  it('a warm run still refuses a retained lock rather than reporting success', () => {
    const f = withHistory()
    runMigrations(f.local, f.executor)
    f.db.exec(
      `INSERT INTO ${MIGRATION_LOCK_TABLE} (id, owner, acquired_at) VALUES (1, 'crashed-run', datetime('now'));`,
    )
    expect(() => runMigrations(f.local, f.executor)).toThrow('Could not acquire')
    expect(() => runMigrations(f.options, f.executor)).toThrow('Could not acquire')
  })

  it('a warm --remote run batches ten tables and every ledger regardless of migration count', () => {
    const tables = Array.from({ length: 10 }, (_, i) => `t${i}`)
    const f = fixture(
      tables.map((table) => `CREATE TABLE ${table} (id TEXT);`).join('\n') +
        '\nCREATE INDEX t0_id ON t0 (id);',
    )
    for (let i = 2; i <= 16; i += 1)
      writeFileSync(join(f.root, 'sql', `${String(i).padStart(4, '0')}.sql`), 'SELECT 1;')
    f.db.exec(
      'CREATE TABLE _applied_migrations (filename TEXT); CREATE TABLE d1_migrations (name TEXT);',
    )
    writeFileSync(
      join(f.root, 'sources.json'),
      JSON.stringify({
        sources: [{ source: 'app', path: 'sql', sourceVersion: '1' }],
        adoptions: [
          {
            source: 'app',
            filename: '0001.sql',
            sourceVersion: '1',
            checksum: checksumMigrationSql(readFileSync(join(f.root, 'sql', '0001.sql'), 'utf8')),
            legacy: { filename: 'old.sql' },
            evidence: {
              tables,
              columns: [{ table: 't0', column: 'id' }],
              indexes: [{ table: 't0', name: 't0_id' }],
            },
          },
        ],
      }),
    )
    runMigrations(f.options, f.executor)
    f.calls.length = 0
    expect(runMigrations(f.options, f.executor)).toMatchObject({ apply: 0, skip: 16 })
    // Previously: table list + 20 PRAGMAs + ledger shape + 3 ledgers + lock = 26.
    expect(spawns(f.calls)).toEqual({ total: 2, reads: 2, writes: 0 })
    for (const args of f.calls) {
      expect(args).toContain('--remote')
      expect(args).toContain('--json')
      expect(args).toContain('--command')
      expect(args.some((arg) => arg.startsWith('--file'))).toBe(false)
    }
    const first = f.calls[0]![f.calls[0]!.indexOf('--command') + 1]!
    for (const table of tables) {
      expect(first).toContain(`PRAGMA table_info(${table});`)
      expect(first).toContain(`PRAGMA index_list(${table});`)
    }
    expect(first).toContain('PRAGMA table_info(_narduk_migrations);')
    const second = f.calls[1]![f.calls[1]!.indexOf('--command') + 1]!
    for (const table of [
      MIGRATION_LOCK_TABLE,
      '_narduk_migrations',
      '_applied_migrations',
      'd1_migrations',
    ])
      expect(second).toContain(`FROM ${table}`)
    f.calls.length = 0
    expect(inspectMigrations(f.options, f.executor)).toMatchObject({ apply: 0, skip: 16 })
    // The status path keeps its before/after lock checks (four reads) unchanged.
    expect(spawns(f.calls)).toEqual({ total: 6, reads: 6, writes: 0 })
  })

  it('still applies and proves a cold --local run', () => {
    const f = withHistory()
    expect(runMigrations(f.local, f.executor)).toMatchObject({ apply: 3, skip: 0 })
    expect(f.db.prepare('SELECT filename FROM _narduk_migrations ORDER BY filename').all()).toEqual(
      [{ filename: '0001.sql' }, { filename: '0002.sql' }, { filename: '0003.sql' }],
    )
    expect(f.db.prepare(`SELECT * FROM ${MIGRATION_LOCK_TABLE}`).all()).toEqual([])
  })
})

// A cold local migrate used to start wrangler and miniflare once per migration
// (3 s each on a CI runner). `--local` now sends the pending migrations, each
// followed by its ledger INSERT, as one file; every guarantee below is the one
// the one-file-per-migration path gave.
describe('batched --local apply', () => {
  function history(count: number, extra?: Record<number, string>) {
    const f = fixture()
    for (let i = 1; i <= count; i += 1) {
      const name = String(i).padStart(4, '0')
      writeFileSync(
        join(f.root, 'sql', `${name}.sql`),
        extra?.[i] ??
          `CREATE TABLE t${name} (id INTEGER PRIMARY KEY); INSERT INTO t${name} VALUES (${i});`,
      )
    }
    return { ...f, local: { ...f.options, location: '--local' } as MigrationRunOptions }
  }
  const files = (calls: string[][]) => calls.filter((a) => a.some((x) => x.startsWith('--file=')))
  const ledger = (db: DatabaseSync) =>
    db
      .prepare(
        'SELECT source, filename, checksum, source_version FROM _narduk_migrations ORDER BY rowid',
      )
      .all()
  const schema = (db: DatabaseSync) =>
    db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '\\_narduk\\_%' ESCAPE '\\' ORDER BY name",
      )
      .all()

  it('records the same ledger rows, in the same order, in one wrangler file', () => {
    const batched = history(25)
    const sequential = history(25)
    expect(runMigrations(batched.local, batched.executor)).toMatchObject({ apply: 25, skip: 0 })
    expect(runMigrations(sequential.options, sequential.executor)).toMatchObject({ apply: 25 })
    expect(ledger(batched.db)).toHaveLength(25)
    expect(ledger(batched.db)).toEqual(ledger(sequential.db))
    expect(schema(batched.db)).toEqual(schema(sequential.db))
    expect(batched.db.prepare('SELECT count(*) AS n FROM t0025').get()?.n).toBe(1)
    expect(files(sequential.calls)).toHaveLength(25)
    expect(files(batched.calls)).toHaveLength(1)
    // inspect + lock create + lock insert + inspect + one file + inspect + unlock.
    expect(batched.calls.length).toBeLessThan(10)
    expect(batched.db.prepare(`SELECT * FROM ${MIGRATION_LOCK_TABLE}`).all()).toEqual([])
    expect(runMigrations(batched.local, batched.executor)).toMatchObject({ apply: 0, skip: 25 })
  })

  it('the process count does not grow with the number of migrations', () => {
    const counts = [1, 10, 60].map((count) => {
      const f = history(count)
      runMigrations(f.local, f.executor)
      return f.calls.length
    })
    expect(new Set(counts).size).toBe(1)
  })

  it('a failure in migration k leaves 1..k-1 recorded and k not, as one file per migration did', () => {
    const run = (location: '--local' | '--remote') => {
      const f = history(6, {
        4: 'CREATE TABLE half (id TEXT); INSERT INTO absent_table VALUES (1);',
      })
      const error = (() => {
        try {
          runMigrations({ ...f.options, location }, f.executor)
        } catch (e) {
          return e as Error
        }
        throw new Error('expected the run to fail')
      })()
      return { f, error }
    }
    const local = run('--local')
    const remote = run('--remote')
    expect(
      local.f.db.prepare('SELECT filename FROM _narduk_migrations ORDER BY rowid').all(),
    ).toEqual(['0001', '0002', '0003'].map((n) => ({ filename: `${n}.sql` })))
    expect(ledger(local.f.db)).toEqual(ledger(remote.f.db))
    expect(schema(local.f.db)).toEqual(schema(remote.f.db))
    expect(schema(local.f.db).map((r) => r.name)).not.toContain('half')
    expect(local.error.message).toContain('absent_table')
    expect(local.error.message).toContain('local run stopped')
    expect(local.f.db.prepare(`SELECT * FROM ${MIGRATION_LOCK_TABLE}`).all()).toEqual([])
    // The failed batch, then 0001..0004 one by one: the unchanged path decides.
    expect(files(local.f.calls)).toHaveLength(1 + 4)
    // A fixed 0004 resumes from the ledger and lands 0004..0006.
    writeFileSync(join(local.f.root, 'sql', '0004.sql'), 'CREATE TABLE fixed (id TEXT);')
    expect(runMigrations(local.f.local, local.f.executor)).toMatchObject({ apply: 3, skip: 3 })
    expect(ledger(local.f.db)).toHaveLength(6)
  })

  it('does not trust a batch to be atomic: a partial commit is re-read, not replayed', () => {
    const f = history(5, { 3: 'CREATE TABLE half (id TEXT); INSERT INTO absent_table VALUES (1);' })
    const firstBatch = { done: false }
    const execute: MigrationExecutor = (args, cwd, json) => {
      const file = args.find((a) => a.startsWith('--file='))
      if (file && !firstBatch.done) {
        firstBatch.done = true
        // Each migration commits on its own, nothing rolls back the whole
        // file: 1 and 2 stay recorded, then 3 dies.
        const text = readFileSync(file.slice(7), 'utf8')
        for (const part of text.split(/(?<=INSERT INTO _narduk_migrations[^\n]*\n)/u)) {
          f.db.exec('BEGIN;')
          try {
            f.db.exec(`${part}\nCOMMIT;`)
          } catch (error) {
            f.db.exec('ROLLBACK;')
            throw error
          }
        }
      }
      return f.executor(args, cwd, json)
    }
    expect(() => runMigrations(f.local, execute)).toThrow('absent_table')
    expect(ledger(f.db).map((r) => r.filename)).toEqual(['0001.sql', '0002.sql'])
  })

  it('adopts and applies in plan order in the same file', () => {
    const f = history(4)
    f.db.exec('CREATE TABLE _applied_migrations (filename TEXT); CREATE TABLE example (id TEXT);')
    f.db.exec("INSERT INTO _applied_migrations VALUES ('0001.sql');")
    writeFileSync(
      join(f.root, 'sources.json'),
      JSON.stringify({
        sources: [{ source: 'app', path: 'sql', sourceVersion: '1' }],
        adoptions: [
          {
            source: 'app',
            filename: '0001.sql',
            sourceVersion: '1',
            checksum: checksumMigrationSql(readFileSync(join(f.root, 'sql', '0001.sql'), 'utf8')),
            legacy: { filename: '0001.sql' },
            evidence: { tables: ['example'] },
          },
        ],
      }),
    )
    expect(runMigrations(f.local, f.executor)).toMatchObject({ adopt: 1, apply: 3, skip: 0 })
    expect(ledger(f.db).map((r) => r.filename)).toEqual([
      '0001.sql',
      '0002.sql',
      '0003.sql',
      '0004.sql',
    ])
    expect(files(f.calls)).toHaveLength(1)
    // Adopted, not applied: its own SQL never ran.
    expect(schema(f.db).map((r) => r.name)).not.toContain('t0001')
  })

  it('splits a very large history into bounded files, in order', () => {
    const pad = `-- ${'x'.repeat(1024 * 1024)}\n`
    expect(LOCAL_BATCH_MAX_BYTES).toBeGreaterThan(2 * 1024 * 1024)
    const body = (n: number) =>
      `${pad.repeat(Math.ceil((LOCAL_BATCH_MAX_BYTES * 0.6) / pad.length))}CREATE TABLE big${n} (id TEXT);`
    const f = history(3, { 1: body(1), 2: body(2), 3: body(3) })
    runMigrations(f.local, f.executor)
    expect(files(f.calls)).toHaveLength(3)
    expect(ledger(f.db).map((r) => r.filename)).toEqual(['0001.sql', '0002.sql', '0003.sql'])
  })

  it('leaves --remote exactly as it was: one file and one ledger row per migration', () => {
    const f = history(5)
    runMigrations(f.options, f.executor)
    expect(files(f.calls)).toHaveLength(5)
    for (const call of files(f.calls)) expect(call).toContain('--remote')
    expect(f.calls.some((args) => args.includes('time-travel'))).toBe(true)
  })
})

// narduk-libs#1189: two Workers Builds from back-to-back merges. The older one
// holds the lock; the newer one used to fail at once and leave production on
// the older commit. The fake D1 is the same node:sqlite executor as above, so
// the lock row, its PRIMARY KEY conflict and D1's clock are all real SQL.
describe('bounded wait on a live migration lock (#1189)', () => {
  const TODAY =
    /^Could not acquire D1 migration lock for DB; attempted owner [0-9a-f-]{36}(?::[0-9a-f]{7,64}:\d+)?\. Inspect _narduk_migration_lock and the prior run before recovery\.$/u

  // Committer times in Unix seconds: OLDER merged before THIS, NEWER after.
  const OLDER = { commitSha: 'aaaaaaa1111111', committedAt: 1_790_000_000 }
  const THIS = { commitSha: 'bbbbbbb2222222', committedAt: 1_790_000_060 }
  const NEWER = { commitSha: 'ccccccc3333333', committedAt: 1_790_000_120 }
  const ownerOf = (c: { commitSha: string; committedAt: number }, n = 1) =>
    `0000000${n}-0000-4000-8000-000000000000:${c.commitSha}:${c.committedAt}`

  function holdLock(f: ReturnType<typeof fixture>, owner: string, ageSeconds = 5) {
    f.db.exec(
      `CREATE TABLE IF NOT EXISTS ${MIGRATION_LOCK_TABLE} (id INTEGER PRIMARY KEY CHECK (id = 1), owner TEXT NOT NULL, acquired_at TEXT NOT NULL);`,
    )
    f.db.exec(
      `INSERT INTO ${MIGRATION_LOCK_TABLE} (id, owner, acquired_at) VALUES (1, '${owner}', datetime('now', '-${ageSeconds} seconds'));`,
    )
  }

  function lockRows(f: ReturnType<typeof fixture>) {
    return f.db.prepare(`SELECT owner FROM ${MIGRATION_LOCK_TABLE}`).all()
  }

  /** A clock that only moves when the waiter sleeps, and the same elapsed
   * time on D1's side: the held row ages by what was slept. */
  function clock(f: ReturnType<typeof fixture>, onSleep: (n: number) => void = () => {}) {
    let t = 1_000_000
    const sleeps: number[] = []
    const lines: string[] = []
    return {
      sleeps,
      lines,
      lockWait: (timeoutSeconds: number) => ({
        timeoutSeconds,
        now: () => t,
        sleep: (ms: number) => {
          sleeps.push(ms)
          t += ms
          f.db.exec(
            `UPDATE ${MIGRATION_LOCK_TABLE} SET acquired_at = datetime(acquired_at, '-${ms / 1000} seconds');`,
          )
          onSleep(sleeps.length)
        },
        log: (line: string) => lines.push(line),
      }),
    }
  }

  /** This run: a Workers Build of THIS, with the given budget. */
  function run(f: ReturnType<typeof fixture>, c: ReturnType<typeof clock>, budget = 300) {
    return { ...f.options, lockIdentity: THIS, lockWait: c.lockWait(budget) }
  }

  describe('forward race: the older build holds, this newer build waits', () => {
    it('waits for the holder to release after N polls, then migrates', () => {
      const f = fixture()
      holdLock(f, ownerOf(OLDER))
      const c = clock(f, (n) => {
        if (n === 3) f.db.exec(`DELETE FROM ${MIGRATION_LOCK_TABLE};`)
      })
      const result = runMigrations(run(f, c), f.executor)
      expect(result).toMatchObject({ apply: 1, skip: 0 })
      expect(c.sleeps).toEqual([2_000, 4_000, 8_000])
      expect(c.lines).toHaveLength(1)
      expect(c.lines[0]).toMatch(
        /^\[db\] waiting on another deploy: migration lock for DB held by owner 00000001-0000-4000-8000-000000000000:aaaaaaa1111111:1790000000 since \d{4}-\d\d-\d\d \d\d:\d\d:\d\d UTC; waiting up to 300s in total\.$/u,
      )
      expect(f.db.prepare('SELECT count(*) AS n FROM _narduk_migrations').get()?.n).toBe(1)
      expect(lockRows(f)).toEqual([])
    })

    it('writes its own commit identity into the lock row it takes', () => {
      const f = fixture()
      let seen: unknown[] = []
      const spy: MigrationExecutor = (args, cwd, json) => {
        if (args.includes('time-travel')) seen = lockRows(f)
        return f.executor(args, cwd, json)
      }
      runMigrations({ ...f.options, lockIdentity: THIS }, spy)
      expect(seen).toEqual([
        { owner: expect.stringMatching(/^[0-9a-f-]{36}:bbbbbbb2222222:1790000060$/u) },
      ])
    })

    it('starts over from a fresh read, so work the holder already did is not redone', () => {
      const f = fixture()
      // The older deploy is mid-run: it holds the lock and applies 0001 before
      // releasing. The waiting run must then find nothing to do.
      holdLock(f, ownerOf(OLDER))
      const c = clock(f, (n) => {
        if (n !== 1) return
        f.db.exec('DELETE FROM _narduk_migration_lock;')
        runMigrations(f.options, f.executor)
      })
      expect(runMigrations(run(f, c), f.executor)).toMatchObject({ apply: 0, skip: 1 })
      expect(f.db.prepare('SELECT count(*) AS n FROM _narduk_migrations').get()?.n).toBe(1)
    })

    it('waits on another build of the same commit (a rerun), then migrates', () => {
      const f = fixture()
      holdLock(f, ownerOf(THIS, 2))
      const c = clock(f, (n) => {
        if (n === 1) f.db.exec(`DELETE FROM ${MIGRATION_LOCK_TABLE};`)
      })
      expect(runMigrations(run(f, c), f.executor)).toMatchObject({ apply: 1 })
      expect(c.sleeps).toEqual([2_000])
    })

    it('announces each new older holder when another older build takes the lock in between', () => {
      const f = fixture()
      holdLock(f, ownerOf(OLDER))
      const c = clock(f, (n) => {
        if (n === 1) f.db.exec(`UPDATE ${MIGRATION_LOCK_TABLE} SET owner = '${ownerOf(OLDER, 3)}';`)
        if (n === 2) f.db.exec(`DELETE FROM ${MIGRATION_LOCK_TABLE};`)
      })
      expect(runMigrations(run(f, c), f.executor)).toMatchObject({ apply: 1 })
      expect(c.lines.map((line) => /owner (\S+)/u.exec(line)?.[1])).toEqual([
        ownerOf(OLDER),
        ownerOf(OLDER, 3),
      ])
    })
  })

  describe('reverse race and unknown holders: fail at once, as before', () => {
    it('superseded: a newer commit holds the lock -- no wait, lock untouched', () => {
      const f = fixture()
      holdLock(f, ownerOf(NEWER))
      const c = clock(f)
      expect(() => runMigrations(run(f, c), f.executor)).toThrow(TODAY)
      expect(c.sleeps).toEqual([])
      expect(c.lines).toEqual([
        '[db] superseded: migration lock for DB held by a newer commit ccccccc3333333; not waiting, because this build (bbbbbbb2222222) is older.',
      ])
      expect(lockRows(f)).toEqual([{ owner: ownerOf(NEWER) }])
      expect(f.db.prepare("SELECT name FROM sqlite_master WHERE name='example'").all()).toEqual([])
    })

    it('stops waiting when a newer build takes the lock mid-wait', () => {
      const f = fixture()
      holdLock(f, ownerOf(OLDER))
      const c = clock(f, (n) => {
        if (n === 1) f.db.exec(`UPDATE ${MIGRATION_LOCK_TABLE} SET owner = '${ownerOf(NEWER)}';`)
      })
      expect(() => runMigrations(run(f, c), f.executor)).toThrow(TODAY)
      expect(c.sleeps).toEqual([2_000])
      expect(c.lines.at(-1)).toContain('superseded')
      expect(lockRows(f)).toEqual([{ owner: ownerOf(NEWER) }])
    })

    it('a holder exactly one second newer is superseding: no wait', () => {
      const f = fixture()
      const oneSecondNewer = { commitSha: 'eeeeeee5555555', committedAt: THIS.committedAt + 1 }
      holdLock(f, ownerOf(oneSecondNewer))
      const c = clock(f)
      expect(() => runMigrations(run(f, c), f.executor)).toThrow(TODAY)
      expect(c.sleeps).toEqual([])
      expect(c.lines[0]).toContain('superseded')
    })

    it('a holder exactly one second older is waited on', () => {
      const f = fixture()
      const oneSecondOlder = { commitSha: 'fffffff6666666', committedAt: THIS.committedAt - 1 }
      holdLock(f, ownerOf(oneSecondOlder))
      const c = clock(f, (n) => {
        if (n === 1) f.db.exec(`DELETE FROM ${MIGRATION_LOCK_TABLE};`)
      })
      expect(runMigrations(run(f, c), f.executor)).toMatchObject({ apply: 1 })
      expect(c.sleeps).toEqual([2_000])
      expect(c.lines[0]).toContain('waiting on another deploy')
    })

    it('a different commit from the same second cannot be ordered: no wait', () => {
      const f = fixture()
      holdLock(f, ownerOf({ commitSha: 'ddddddd4444444', committedAt: THIS.committedAt }))
      const c = clock(f)
      expect(() => runMigrations(run(f, c), f.executor)).toThrow(TODAY)
      expect(c.sleeps).toEqual([])
      expect(c.lines[0]).toContain('cannot order them')
    })

    it.each([
      ['an old-format bare-UUID owner', '00000001-0000-4000-8000-000000000000'],
      ['a free-text owner', 'older-deploy'],
      ['a malformed commit time', '00000001-0000-4000-8000-000000000000:aaaaaaa1111111:soon'],
      ['a non-hex sha', '00000001-0000-4000-8000-000000000000:not-a-sha:1790000000'],
      // Pins the `$` anchor: a valid owner followed by anything is not one.
      ['trailing garbage after a valid owner', `${ownerOf(OLDER)}:extra`],
    ])('%s is an unknown holder: no wait', (_label, owner) => {
      const f = fixture()
      holdLock(f, owner)
      const c = clock(f)
      expect(() => runMigrations(run(f, c), f.executor)).toThrow(TODAY)
      expect(c.sleeps).toEqual([])
      expect(c.lines[0]).toContain('whose commit is unknown')
      expect(lockRows(f)).toEqual([{ owner }])
    })

    it('a run with no commit identity never waits, even with a budget', () => {
      const f = fixture()
      holdLock(f, ownerOf(OLDER))
      const c = clock(f)
      expect(() => runMigrations({ ...f.options, lockWait: c.lockWait(300) }, f.executor)).toThrow(
        TODAY,
      )
      expect(c.sleeps).toEqual([])
      expect(c.lines[0]).toContain('no commit identity')
    })

    it('a garbage acquired_at is an unreadable age: no wait', () => {
      const f = fixture()
      holdLock(f, ownerOf(OLDER))
      f.db.exec(`UPDATE ${MIGRATION_LOCK_TABLE} SET acquired_at = 'not a date';`)
      const c = clock(f)
      expect(() => runMigrations(run(f, c), f.executor)).toThrow(TODAY)
      expect(c.sleeps).toEqual([])
      expect(lockRows(f)).toEqual([{ owner: ownerOf(OLDER) }])
    })

    it('an acquired_at in the future is an unreadable age: no wait', () => {
      const f = fixture()
      holdLock(f, ownerOf(OLDER))
      f.db.exec(
        `UPDATE ${MIGRATION_LOCK_TABLE} SET acquired_at = datetime('now', '+3600 seconds');`,
      )
      const c = clock(f)
      expect(() => runMigrations(run(f, c), f.executor)).toThrow(TODAY)
      expect(c.sleeps).toEqual([])
    })
  })

  it('held past the cap: the same hard failure as today, and the lock is not taken', () => {
    const f = fixture()
    holdLock(f, ownerOf(OLDER))
    const c = clock(f)
    expect(() => runMigrations(run(f, c, 10), f.executor)).toThrow(TODAY)
    // Backoff, clipped to the remaining budget, and never past it.
    expect(c.sleeps).toEqual([2_000, 4_000, 4_000])
    expect(c.lines.at(-1)).toContain('gave up waiting on the migration lock for DB after 10s')
    expect(lockRows(f)).toEqual([{ owner: ownerOf(OLDER) }])
    expect(f.db.prepare("SELECT name FROM sqlite_master WHERE name='example'").all()).toEqual([])
  })

  it('stale: a lock at or past the threshold fails at once, as today, without waiting', () => {
    const f = fixture()
    holdLock(f, ownerOf(OLDER), MIGRATION_LOCK_STALE_AFTER_SECONDS + 60)
    const c = clock(f)
    expect(() => runMigrations(run(f, c), f.executor)).toThrow(TODAY)
    expect(c.sleeps).toEqual([])
    expect(c.lines[0]).toContain(`owner ${ownerOf(OLDER)}`)
    expect(c.lines[0]).toContain('stale threshold')
    expect(lockRows(f)).toEqual([{ owner: ownerOf(OLDER) }])
  })

  /** Pin `acquired_at` to `seconds` ago with millisecond precision, so D1's
   * integer age is exactly `Math.floor(seconds)` (the half second absorbs the
   * few milliseconds between this write and the waiter's read). */
  function ageLockBy(f: ReturnType<typeof fixture>, seconds: number) {
    f.db.exec(
      `UPDATE ${MIGRATION_LOCK_TABLE} SET acquired_at = strftime('%Y-%m-%d %H:%M:%f', 'now', '-${seconds} seconds');`,
    )
  }

  it('an age of exactly the threshold (600 s) is stale: no wait', () => {
    const f = fixture()
    holdLock(f, ownerOf(OLDER))
    ageLockBy(f, MIGRATION_LOCK_STALE_AFTER_SECONDS + 0.5)
    const c = clock(f)
    expect(() => runMigrations(run(f, c), f.executor)).toThrow(TODAY)
    expect(c.sleeps).toEqual([])
    expect(c.lines[0]).toContain('(600s, at or past the 600s stale threshold)')
  })

  it('an age of one second under the threshold (599 s) is waited on', () => {
    const f = fixture()
    holdLock(f, ownerOf(OLDER))
    ageLockBy(f, MIGRATION_LOCK_STALE_AFTER_SECONDS - 0.5)
    const c = clock(f, (n) => {
      if (n === 1) f.db.exec(`DELETE FROM ${MIGRATION_LOCK_TABLE};`)
    })
    expect(runMigrations(run(f, c), f.executor)).toMatchObject({ apply: 1 })
    expect(c.sleeps).toEqual([2_000])
  })

  it('stops waiting when the holder ages past the stale threshold mid-wait', () => {
    const f = fixture()
    holdLock(f, ownerOf(OLDER), MIGRATION_LOCK_STALE_AFTER_SECONDS - 5)
    const c = clock(f)
    expect(() => runMigrations(run(f, c), f.executor)).toThrow(TODAY)
    expect(c.sleeps).toEqual([2_000, 4_000])
    expect(lockRows(f)).toEqual([{ owner: ownerOf(OLDER) }])
  })

  it('does not wait when the budget is 0 or absent: unchanged immediate failure', () => {
    for (const lockWait of [undefined, 0]) {
      const f = fixture()
      holdLock(f, ownerOf(OLDER))
      const c = clock(f)
      const options =
        lockWait === undefined ? f.options : { ...run(f, c), lockWait: c.lockWait(lockWait) }
      expect(() => runMigrations(options, f.executor)).toThrow(TODAY)
      expect(c.sleeps).toEqual([])
      expect(c.lines).toEqual([])
      expect(lockRows(f)).toEqual([{ owner: ownerOf(OLDER) }])
    }
  })

  it('never waits on its own uncertain acquisition (INSERT landed, response lost)', () => {
    const f = fixture()
    const c = clock(f)
    const lossy: MigrationExecutor = (args, cwd, json) => {
      const out = f.executor(args, cwd, json)
      const command = args[args.indexOf('--command') + 1] ?? ''
      if (command.startsWith(`INSERT INTO ${MIGRATION_LOCK_TABLE}`)) throw new Error('lost')
      return out
    }
    expect(() => runMigrations(run(f, c), lossy)).toThrow(TODAY)
    expect(c.sleeps).toEqual([])
    // Its own row, in the identity format, stays: an uncertain acquisition is
    // never released.
    expect(lockRows(f)).toEqual([
      { owner: expect.stringMatching(/^[0-9a-f-]{36}:bbbbbbb2222222:1790000060$/u) },
    ])
  })

  it('a lock INSERT that keeps failing with no holder still ends in the same error', () => {
    const f = fixture()
    const c = clock(f)
    const refusing: MigrationExecutor = (args, cwd, json) => {
      const command = args[args.indexOf('--command') + 1] ?? ''
      if (command.startsWith(`INSERT INTO ${MIGRATION_LOCK_TABLE}`)) throw new Error('refused')
      return f.executor(args, cwd, json)
    }
    expect(() => runMigrations(run(f, c, 10), refusing)).toThrow(TODAY)
    expect(c.sleeps.reduce((a, b) => a + b, 0)).toBe(10_000)
    expect(lockRows(f)).toEqual([])
  })
})

describe('resolveMigrationLockIdentity (#1189)', () => {
  const sha = 'abcdef0123456789abcdef0123456789abcdef01'
  it('reads WORKERS_CI_COMMIT_SHA and asks git for that commit time', () => {
    const asked: Array<[string, string]> = []
    const identity = resolveMigrationLockIdentity(
      { WORKERS_CI_COMMIT_SHA: sha },
      '/app',
      (s, cwd) => {
        asked.push([s, cwd])
        return '1790000060\n'
      },
    )
    expect(identity).toEqual({ commitSha: sha, committedAt: 1_790_000_060 })
    expect(asked).toEqual([[sha, '/app']])
  })
  it.each([
    ['no commit variable', {}, '1790000060'],
    ['a non-hex commit', { WORKERS_CI_COMMIT_SHA: 'main' }, '1790000060'],
    ['a shallow clone without the commit object', { WORKERS_CI_COMMIT_SHA: sha }, undefined],
    ['a non-numeric time', { WORKERS_CI_COMMIT_SHA: sha }, 'yesterday'],
    ['an empty time', { WORKERS_CI_COMMIT_SHA: sha }, ''],
  ] as const)('is undefined with %s', (_label, env, time) => {
    expect(resolveMigrationLockIdentity(env, '/app', () => time)).toBeUndefined()
  })
})
