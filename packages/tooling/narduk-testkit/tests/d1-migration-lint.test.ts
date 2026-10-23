import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  assertMigrationsClean,
  hashMigrationStatement,
  isMoneyLikeColumnName,
  lintMigrationSql,
  lintMigrationsDir,
  normalizeMigrationStatement,
} from '../src/d1-migration-lint.js'

const tempDirs: string[] = []

function migrationsDir(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), 'migration-lint-'))
  tempDirs.push(dir)
  mkdirSync(dir, { recursive: true })
  for (const [name, sql] of Object.entries(files)) writeFileSync(join(dir, name), sql)
  return dir
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { force: true, recursive: true })
})

const lint = (sql: string) => lintMigrationSql(sql, { file: '0001_x.sql' })
const ids = (sql: string) => lint(sql).map((finding) => finding.id)

describe('isMoneyLikeColumnName', () => {
  it('matches the whole name or the final token', () => {
    for (const name of [
      'price',
      'amount',
      'line_total',
      'unit_cost',
      'fob_usd',
      'late_fee',
      'tax',
    ]) {
      expect(isMoneyLikeColumnName(name), name).toBe(true)
    }
  })

  it('does not match a money word in the middle of a name', () => {
    for (const name of [
      'amount_kg',
      'total_count',
      'price_per_kg_units',
      'taxonomy',
      'cost_center_id',
    ]) {
      expect(isMoneyLikeColumnName(name), name).toBe(false)
    }
  })

  it('does not flag _cents, which is the correct integer form', () => {
    expect(isMoneyLikeColumnName('amount_cents')).toBe(false)
  })

  it('is case-insensitive and takes a caller list', () => {
    expect(isMoneyLikeColumnName('Amount')).toBe(true)
    expect(isMoneyLikeColumnName('rate', ['rate'])).toBe(true)
    expect(isMoneyLikeColumnName('price', ['rate'])).toBe(false)
  })
})

describe('money-real-column', () => {
  it('flags every inexact type in a CREATE TABLE, in any case', () => {
    const findings = lint(`CREATE TABLE t (
      id INTEGER PRIMARY KEY,
      price REAL NOT NULL,
      amount float,
      cost DOUBLE PRECISION,
      total NUMERIC,
      fee DECIMAL(10,2) DEFAULT 0
    );`)
    expect(findings.map((finding) => finding.message.split(' ')[0])).toEqual([
      't.price',
      't.amount',
      't.cost',
      't.total',
      't.fee',
    ])
    expect(findings.every((finding) => finding.id === 'money-real-column')).toBe(true)
    expect(findings[2]?.message).toContain('DOUBLE PRECISION')
  })

  it('reads backtick, double-quote and bracket quoted names', () => {
    expect(
      ids(
        'CREATE TABLE `t` (`price` real, "amount" real, [tax] real, `qty` real, `ok_cents` integer)',
      ),
    ).toEqual(['money-real-column', 'money-real-column', 'money-real-column'])
  })

  it('splits columns on top-level commas only', () => {
    // The comma inside CHECK (...) and DECIMAL(10,2) must not start a new column.
    const findings = lint(`CREATE TABLE t (
      lat REAL CHECK (lat BETWEEN -90 AND 90),
      balance DECIMAL(10,2) CHECK (balance IN (0, 1)),
      note TEXT
    )`)
    expect(findings).toHaveLength(1)
    expect(findings[0]?.message).toContain('t.balance')
  })

  it('skips table constraints and non-money floats', () => {
    expect(
      ids(`CREATE TABLE t (
        pressure_bar REAL, price_per_kg_units REAL, amount_kg REAL,
        total_count INTEGER, price INTEGER,
        PRIMARY KEY (id), UNIQUE (price), CHECK (total > 0),
        CONSTRAINT fk FOREIGN KEY (a) REFERENCES b(id)
      )`),
    ).toEqual([])
  })

  it('does not read a money word inside a default or a check as a column', () => {
    expect(ids("CREATE TABLE t (note TEXT DEFAULT 'price REAL', n INTEGER CHECK (n > 0))")).toEqual(
      [],
    )
  })

  it('handles ALTER TABLE ADD with and without COLUMN', () => {
    expect(ids('ALTER TABLE t ADD COLUMN price REAL')).toEqual(['money-real-column'])
    expect(ids('alter table t add subtotal numeric default 0')).toEqual(['money-real-column'])
    expect(ids('ALTER TABLE t ADD COLUMN reported_pressure REAL')).toEqual([])
    expect(ids('ALTER TABLE t ADD COLUMN price INTEGER')).toEqual([])
  })

  it('handles IF NOT EXISTS, TEMP and schema-qualified tables', () => {
    expect(ids('CREATE TABLE IF NOT EXISTS main.t (price REAL)')).toEqual(['money-real-column'])
    expect(ids('CREATE TEMP TABLE t (price REAL)')).toEqual(['money-real-column'])
  })

  it('ignores CREATE TABLE ... AS SELECT and indexes', () => {
    expect(ids('CREATE TABLE t AS SELECT 1.5 AS price')).toEqual([])
    expect(ids('CREATE INDEX idx_price ON t (price)')).toEqual([])
  })

  it('honours caller lists', () => {
    const findings = lintMigrationSql('CREATE TABLE t (rate REAL, price REAL)', {
      file: 'a.sql',
      inexactTypes: ['REAL'],
      moneyNames: ['rate'],
    })
    expect(findings.map((finding) => finding.message.split(' ')[0])).toEqual(['t.rate'])
  })

  it('reports the statement index among the file statements', () => {
    const findings = lint('CREATE TABLE a (id INTEGER); -- note\nCREATE TABLE b (price REAL);')
    expect(findings[0]?.statementIndex).toBe(1)
    expect(findings[0]?.statement).toBe('CREATE TABLE b (price REAL)')
  })
})

describe('destructive-statement', () => {
  it('flags DROP TABLE, DROP COLUMN and RENAME in their spellings', () => {
    expect(ids('DROP TABLE t')).toEqual(['destructive-statement'])
    expect(ids('drop table if exists main.t')).toEqual(['destructive-statement'])
    expect(ids('ALTER TABLE t DROP COLUMN c')).toEqual(['destructive-statement'])
    expect(ids('ALTER TABLE t DROP c')).toEqual(['destructive-statement'])
    expect(ids('ALTER TABLE t RENAME TO u')).toEqual(['destructive-statement'])
    expect(ids('ALTER TABLE t RENAME COLUMN a TO b')).toEqual(['destructive-statement'])
    expect(ids('ALTER TABLE t RENAME a TO b')).toEqual(['destructive-statement'])
  })

  it('leaves indexes, triggers, views and additive changes alone', () => {
    for (const sql of [
      'DROP INDEX idx',
      'DROP INDEX IF EXISTS idx',
      'DROP TRIGGER IF EXISTS trg',
      'DROP VIEW v',
      'ALTER TABLE t ADD COLUMN c TEXT',
      'CREATE TRIGGER trg BEFORE UPDATE ON t BEGIN SELECT RAISE(ABORT, "no"); END',
    ]) {
      expect(ids(sql), sql).toEqual([])
    }
  })

  it('fires both rules on a drizzle table rebuild', () => {
    expect(
      ids(
        'DROP TABLE email_log;\n--> statement-breakpoint\nALTER TABLE email_log_next RENAME TO email_log;',
      ),
    ).toEqual(['destructive-statement', 'destructive-statement'])
  })
})

describe('statement identity', () => {
  it('normalises whitespace but not case', () => {
    expect(normalizeMigrationStatement('  DROP\n  TABLE   t ')).toBe('DROP TABLE t')
    expect(hashMigrationStatement('DROP TABLE   t')).toBe(hashMigrationStatement('DROP\nTABLE t'))
    expect(hashMigrationStatement('DROP TABLE t')).not.toBe(hashMigrationStatement('drop table t'))
    expect(hashMigrationStatement('DROP TABLE t')).toMatch(/^[0-9a-f]{64}$/u)
  })

  it('puts the same hash on the finding as the exported function computes', () => {
    const [finding] = lint('DROP TABLE   t')
    expect(finding?.statementHash).toBe(hashMigrationStatement('DROP TABLE t'))
  })
})

describe('allowances', () => {
  it('suppresses a finding by file and id, ignoring the directory in the file name', () => {
    const findings = lintMigrationSql('DROP TABLE t', {
      allow: [{ file: '0001_x.sql', id: 'destructive-statement', reason: 'rebuild' }],
      file: 'db/migrations/0001_x.sql',
    })
    expect(findings).toEqual([])
  })

  it('does not suppress another file or another rule', () => {
    const allow = [{ file: '0002_y.sql', id: 'destructive-statement' as const, reason: 'r' }]
    expect(lintMigrationSql('DROP TABLE t', { allow, file: '0001_x.sql' })).toHaveLength(1)
    expect(
      lintMigrationSql('DROP TABLE t', {
        allow: [{ file: '0001_x.sql', id: 'money-real-column', reason: 'r' }],
        file: '0001_x.sql',
      }),
    ).toHaveLength(1)
  })

  it('pins to a statement hash so an edited statement fails again', () => {
    const statementHash = hashMigrationStatement('DROP TABLE t')
    const allow = [
      { file: '0001_x.sql', id: 'destructive-statement' as const, reason: 'r', statementHash },
    ]
    expect(lintMigrationSql('DROP  TABLE t', { allow, file: '0001_x.sql' })).toEqual([])
    expect(lintMigrationSql('DROP TABLE t_old', { allow, file: '0001_x.sql' })).toHaveLength(1)
  })

  it('refuses an allowance with no reason', () => {
    expect(() =>
      lintMigrationSql('SELECT 1', {
        allow: [{ file: 'a.sql', id: 'destructive-statement', reason: '  ' }],
        file: 'a.sql',
      }),
    ).toThrow(/needs a reason/)
  })
})

describe('lintMigrationsDir and assertMigrationsClean', () => {
  it('lints numbered .sql files in order and skips other files', () => {
    const dir = migrationsDir({
      '0001_a.sql': 'CREATE TABLE a (price REAL);',
      '0002_b.sql': 'DROP TABLE a;',
      'seed.sql': 'DROP TABLE seeded;',
      'notes.md': 'DROP TABLE nope;',
    })
    const findings = lintMigrationsDir(dir)
    expect(findings.map((finding) => [finding.file, finding.id])).toEqual([
      ['0001_a.sql', 'money-real-column'],
      ['0002_b.sql', 'destructive-statement'],
    ])
  })

  it('reports an allowance that matches nothing as stale', () => {
    const dir = migrationsDir({ '0001_a.sql': 'CREATE TABLE a (id INTEGER);' })
    const findings = lintMigrationsDir(dir, {
      allow: [
        { file: '0001_a.sql', id: 'destructive-statement', reason: 'old' },
        { file: '0009_gone.sql', id: 'money-real-column', reason: 'old' },
      ],
    })
    expect(findings.map((finding) => [finding.id, finding.statementIndex])).toEqual([
      ['stale-allowance', -1],
      ['stale-allowance', -1],
    ])
    expect(findings[0]?.message).toContain('matches no destructive-statement finding')
    expect(findings[1]?.message).toContain('not in the migrations directory')
  })

  it('does not call a used allowance stale, and a stale pin fires after an edit', () => {
    const statementHash = hashMigrationStatement('DROP TABLE a')
    const allow = [
      { file: '0002_b.sql', id: 'destructive-statement' as const, reason: 'r', statementHash },
    ]
    const clean = migrationsDir({ '0002_b.sql': 'DROP TABLE a;' })
    expect(lintMigrationsDir(clean, { allow })).toEqual([])
    const edited = migrationsDir({ '0002_b.sql': 'DROP TABLE a2;' })
    expect(lintMigrationsDir(edited, { allow }).map((finding) => finding.id)).toEqual([
      'destructive-statement',
      'stale-allowance',
    ])
  })

  it('throws one error naming every finding with its pin, and passes a clean directory', () => {
    const dir = migrationsDir({
      '0001_a.sql': 'CREATE TABLE a (price REAL, total REAL);',
      '0002_b.sql': 'DROP TABLE a;',
    })
    expect(() => assertMigrationsClean(dir)).toThrow(/3 migration lint finding\(s\)/)
    expect(() => assertMigrationsClean(dir)).toThrow(/0002_b\.sql #0 destructive-statement/)
    expect(() => assertMigrationsClean(dir)).toThrow(/statementHash [0-9a-f]{64}/)

    expect(() =>
      assertMigrationsClean(migrationsDir({ '0001_a.sql': 'CREATE TABLE a (id INTEGER);' })),
    ).not.toThrow()
  })

  it('refuses a path that is not a directory', () => {
    const dir = migrationsDir({ '0001_a.sql': 'SELECT 1;' })
    expect(() => lintMigrationsDir(join(dir, '0001_a.sql'))).toThrow(/not a directory/)
  })
})
