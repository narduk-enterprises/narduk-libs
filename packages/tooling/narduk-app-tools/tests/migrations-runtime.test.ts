import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import {
  inspectMigrations,
  runMigrations,
  MIGRATION_LOCK_STALE_AFTER_SECONDS,
  MIGRATION_LOCK_TABLE,
  parseWranglerBatchJson,
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

  it('a warm --local run is two read processes, and writes nothing', () => {
    const f = withHistory()
    expect(runMigrations(f.local, f.executor)).toMatchObject({ apply: 3, skip: 0 })
    f.calls.length = 0
    expect(runMigrations(f.local, f.executor)).toMatchObject({ apply: 0, skip: 3 })
    // Before: three inspections of five reads each plus three lock statements.
    expect(spawns(f.calls)).toEqual({ total: 2, reads: 2, writes: 0 })
    expect(f.db.prepare(`SELECT * FROM ${MIGRATION_LOCK_TABLE}`).all()).toEqual([])
  })

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

  it('a warm --remote run takes no lock and sends each statement on its own', () => {
    const f = withHistory()
    runMigrations(f.options, f.executor)
    f.calls.length = 0
    expect(runMigrations(f.options, f.executor)).toMatchObject({ apply: 0, skip: 3 })
    expect(spawns(f.calls).writes).toBe(0)
    for (const args of f.calls) {
      const sql = args[args.indexOf('--command') + 1]!
      expect(
        sql
          .trim()
          .split(';')
          .filter((part) => part.trim()),
      ).toHaveLength(1)
    }
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

// narduk-libs#1189: two Workers Builds from back-to-back merges. The older one
// holds the lock; the newer one used to fail at once and leave production on
// the older commit. The fake D1 is the same node:sqlite executor as above, so
// the lock row, its PRIMARY KEY conflict and D1's clock are all real SQL.
describe('bounded wait on a live migration lock (#1189)', () => {
  const TODAY =
    /^Could not acquire D1 migration lock for DB; attempted owner [0-9a-f-]{36}\. Inspect _narduk_migration_lock and the prior run before recovery\.$/u

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

  it('waits for a live holder that releases after N polls, then migrates', () => {
    const f = fixture()
    holdLock(f, 'older-deploy')
    const c = clock(f, (n) => {
      if (n === 3) f.db.exec(`DELETE FROM ${MIGRATION_LOCK_TABLE};`)
    })
    const result = runMigrations({ ...f.options, lockWait: c.lockWait(300) }, f.executor)
    expect(result).toMatchObject({ apply: 1, skip: 0 })
    expect(c.sleeps).toEqual([2_000, 4_000, 8_000])
    expect(c.lines).toHaveLength(1)
    expect(c.lines[0]).toMatch(
      /^\[db\] waiting on another deploy: migration lock for DB held by owner older-deploy since \d{4}-\d\d-\d\d \d\d:\d\d:\d\d UTC; waiting up to 300s in total\.$/u,
    )
    expect(f.db.prepare('SELECT count(*) AS n FROM _narduk_migrations').get()?.n).toBe(1)
    expect(lockRows(f)).toEqual([])
  })

  it('starts over from a fresh read, so work the holder already did is not redone', () => {
    const f = fixture()
    // The older deploy is mid-run: it holds the lock and applies 0001 before
    // releasing. The waiting run must then find nothing to do.
    holdLock(f, 'older-deploy')
    const c = clock(f, (n) => {
      if (n !== 1) return
      f.db.exec('DELETE FROM _narduk_migration_lock;')
      runMigrations(f.options, f.executor)
      holdLock(f, 'older-deploy-tail')
      f.db.exec('DELETE FROM _narduk_migration_lock;')
    })
    const result = runMigrations({ ...f.options, lockWait: c.lockWait(300) }, f.executor)
    expect(result).toMatchObject({ apply: 0, skip: 1 })
    expect(f.db.prepare('SELECT count(*) AS n FROM _narduk_migrations').get()?.n).toBe(1)
  })

  it('announces each new holder when a third deploy takes the lock in between', () => {
    const f = fixture()
    holdLock(f, 'older-deploy')
    const c = clock(f, (n) => {
      if (n === 1) f.db.exec(`UPDATE ${MIGRATION_LOCK_TABLE} SET owner = 'third-deploy';`)
      if (n === 2) f.db.exec(`DELETE FROM ${MIGRATION_LOCK_TABLE};`)
    })
    expect(runMigrations({ ...f.options, lockWait: c.lockWait(300) }, f.executor)).toMatchObject({
      apply: 1,
    })
    expect(c.lines.map((line) => /owner (\S+)/u.exec(line)?.[1])).toEqual([
      'older-deploy',
      'third-deploy',
    ])
  })

  it('held past the cap: the same hard failure as today, and the lock is not taken', () => {
    const f = fixture()
    holdLock(f, 'older-deploy')
    const c = clock(f)
    expect(() => runMigrations({ ...f.options, lockWait: c.lockWait(10) }, f.executor)).toThrow(
      TODAY,
    )
    // Backoff, clipped to the remaining budget, and never past it.
    expect(c.sleeps).toEqual([2_000, 4_000, 4_000])
    expect(c.lines.at(-1)).toContain('gave up waiting on the migration lock for DB after 10s')
    expect(lockRows(f)).toEqual([{ owner: 'older-deploy' }])
    expect(f.db.prepare("SELECT name FROM sqlite_master WHERE name='example'").all()).toEqual([])
  })

  it('stale: a lock at or past the threshold fails at once, as today, without waiting', () => {
    const f = fixture()
    holdLock(f, 'crashed-run', MIGRATION_LOCK_STALE_AFTER_SECONDS + 60)
    const c = clock(f)
    expect(() => runMigrations({ ...f.options, lockWait: c.lockWait(300) }, f.executor)).toThrow(
      TODAY,
    )
    expect(c.sleeps).toEqual([])
    expect(c.lines[0]).toContain('owner crashed-run')
    expect(c.lines[0]).toContain('stale threshold')
    expect(lockRows(f)).toEqual([{ owner: 'crashed-run' }])
  })

  it('stops waiting when the holder ages past the stale threshold mid-wait', () => {
    const f = fixture()
    holdLock(f, 'slow-run', MIGRATION_LOCK_STALE_AFTER_SECONDS - 5)
    const c = clock(f)
    expect(() => runMigrations({ ...f.options, lockWait: c.lockWait(300) }, f.executor)).toThrow(
      TODAY,
    )
    expect(c.sleeps).toEqual([2_000, 4_000])
    expect(lockRows(f)).toEqual([{ owner: 'slow-run' }])
  })

  it('does not wait when the budget is 0 or absent: unchanged immediate failure', () => {
    for (const lockWait of [undefined, 0]) {
      const f = fixture()
      holdLock(f, 'older-deploy')
      const c = clock(f)
      const options =
        lockWait === undefined ? f.options : { ...f.options, lockWait: c.lockWait(lockWait) }
      expect(() => runMigrations(options, f.executor)).toThrow(TODAY)
      expect(c.sleeps).toEqual([])
      expect(c.lines).toEqual([])
      expect(lockRows(f)).toEqual([{ owner: 'older-deploy' }])
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
    expect(() => runMigrations({ ...f.options, lockWait: c.lockWait(300) }, lossy)).toThrow(TODAY)
    expect(c.sleeps).toEqual([])
    // Its own row stays: an uncertain acquisition is never released.
    expect(lockRows(f)).toHaveLength(1)
  })

  it('a lock INSERT that keeps failing with no holder still ends in the same error', () => {
    const f = fixture()
    const c = clock(f)
    const refusing: MigrationExecutor = (args, cwd, json) => {
      const command = args[args.indexOf('--command') + 1] ?? ''
      if (command.startsWith(`INSERT INTO ${MIGRATION_LOCK_TABLE}`)) throw new Error('refused')
      return f.executor(args, cwd, json)
    }
    expect(() => runMigrations({ ...f.options, lockWait: c.lockWait(10) }, refusing)).toThrow(TODAY)
    expect(c.sleeps.reduce((a, b) => a + b, 0)).toBe(10_000)
    expect(lockRows(f)).toEqual([])
  })
})
