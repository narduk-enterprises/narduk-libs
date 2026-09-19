import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import {
  inspectMigrations,
  runMigrations,
  MIGRATION_LOCK_TABLE,
  parseWranglerJson,
  type MigrationExecutor,
  type MigrationRunOptions,
} from '../src/migrations.js'

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
    if (args.includes('--json'))
      return JSON.stringify([{ success: true, results: db.prepare(command).all() }])
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
    'fails closed on malformed provider output %s',
    (output) => {
      expect(() => parseWranglerJson(output)).toThrow()
    },
  )
})
