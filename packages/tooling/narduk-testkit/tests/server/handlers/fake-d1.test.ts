import { describe, expect, it } from 'vitest'

import { createFakeD1Database } from '../../../src/server/handlers/fake-d1'

async function withSchema() {
  const db = createFakeD1Database()
  await db.exec(
    'CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE)',
  )
  return db
}

describe('createFakeD1Database', () => {
  it('runs an INSERT via run() and reports meta', async () => {
    const db = await withSchema()
    const result = await db
      .prepare('INSERT INTO users (name, email) VALUES (?, ?)')
      .bind('Logan', 'logan@nard.uk')
      .run()

    expect(result.success).toBe(true)
    expect(result.results).toEqual([])
    expect(result.meta.changes).toBe(1)
    expect(result.meta.last_row_id).toBe(1)
    expect(result.meta.changed_db).toBe(true)
  })

  it('reads a single row with first()', async () => {
    const db = await withSchema()
    await db.prepare('INSERT INTO users (name, email) VALUES (?, ?)').bind('Logan', 'l@x.com').run()

    const row = await db.prepare('SELECT * FROM users WHERE email = ?').bind('l@x.com').first()
    expect(row).toMatchObject({ email: 'l@x.com', name: 'Logan' })
  })

  it('first() with a column name returns just that column', async () => {
    const db = await withSchema()
    await db.prepare('INSERT INTO users (name, email) VALUES (?, ?)').bind('Logan', 'l@x.com').run()

    await expect(
      db.prepare('SELECT * FROM users WHERE email = ?').bind('l@x.com').first('name'),
    ).resolves.toBe('Logan')
  })

  it('first() resolves null for no matching row', async () => {
    const db = await withSchema()
    await expect(
      db.prepare('SELECT * FROM users WHERE email = ?').bind('missing').first(),
    ).resolves.toBeNull()
  })

  it('all() returns every matching row', async () => {
    const db = await withSchema()
    await db.prepare('INSERT INTO users (name, email) VALUES (?, ?)').bind('A', 'a@x.com').run()
    await db.prepare('INSERT INTO users (name, email) VALUES (?, ?)').bind('B', 'b@x.com').run()

    const result = await db.prepare('SELECT name FROM users ORDER BY name').all<{ name: string }>()
    expect(result.results).toEqual([{ name: 'A' }, { name: 'B' }])
    expect(result.success).toBe(true)
  })

  it('raw() returns rows as arrays without column names by default', async () => {
    const db = await withSchema()
    await db.prepare('INSERT INTO users (name, email) VALUES (?, ?)').bind('A', 'a@x.com').run()

    const rows = await db.prepare('SELECT id, name FROM users').raw()
    expect(rows).toEqual([[1, 'A']])
  })

  it('raw({ columnNames: true }) prepends a header row', async () => {
    const db = await withSchema()
    await db.prepare('INSERT INTO users (name, email) VALUES (?, ?)').bind('A', 'a@x.com').run()

    const rows = await db.prepare('SELECT id, name FROM users').raw({ columnNames: true })
    expect(rows[0]).toEqual(['id', 'name'])
    expect(rows[1]).toEqual([1, 'A'])
  })

  // D1 counts exec() statements by LINE, not by semicolon. Verified against a
  // real binding via miniflare: three statements on one line all execute and
  // report `count: 1`; the same statements newline-separated report `count: 2`
  // / `count: 3`.
  it('exec() runs every ;-separated statement but counts by line, as D1 does', async () => {
    const db = createFakeD1Database()
    const result = await db.exec(
      'CREATE TABLE a (id INTEGER); CREATE TABLE b (id INTEGER); INSERT INTO a (id) VALUES (1)',
    )
    expect(result.count).toBe(1)
    await expect(db.prepare('SELECT id FROM a').first()).resolves.toEqual({ id: 1 })
    await expect(db.prepare('SELECT id FROM b').all()).resolves.toMatchObject({ results: [] })
  })

  it('exec() counts newline-separated statements individually', async () => {
    const db = createFakeD1Database()
    const result = await db.exec('CREATE TABLE a (id INTEGER);\nCREATE TABLE b (id INTEGER);')
    expect(result.count).toBe(2)
  })

  describe('D1 rules SQLite alone would not enforce', () => {
    // Real D1: `D1_ERROR: Wrong number of parameter bindings for SQL query.`
    // node:sqlite on its own binds NULL for the missing value and returns a
    // confidently wrong (empty) result, so a handler with a dropped bind
    // would pass every test here and break in production.
    it('rejects a bind() with too few values', async () => {
      const db = await withSchema()
      await expect(
        db.prepare('SELECT * FROM users WHERE name = ? AND email = ?').bind('Logan').first(),
      ).rejects.toThrow(/Wrong number of parameter bindings/)
    })

    it('rejects a bind() with too many values', async () => {
      const db = await withSchema()
      await expect(
        db.prepare('SELECT * FROM users WHERE name = ?').bind('Logan', 'extra').all(),
      ).rejects.toThrow(/Wrong number of parameter bindings/)
    })

    it('does not miscount a ? inside a string literal or a comment', async () => {
      const db = await withSchema()
      await db.prepare('INSERT INTO users (name, email) VALUES (?, ?)').bind('a?b', 'e@x').run()

      await expect(
        db
          .prepare('SELECT name FROM users WHERE name = ? -- is it ?\n')
          .bind('a?b')
          .first<string>('name'),
      ).resolves.toBe('a?b')
      await expect(
        db.prepare("SELECT * FROM users WHERE name = 'a?b'").first(),
      ).resolves.toMatchObject({ name: 'a?b' })
    })

    it('leaves a named-parameter statement to the driver', async () => {
      const db = await withSchema()
      // D1 accepts a positional bind against a named statement without an
      // arity complaint, so the fake must not invent one.
      expect(() => db.prepare('SELECT * FROM users WHERE name = :name').bind('x')).not.toThrow()
    })

    // Real D1: `D1_COLUMN_NOTFOUND: Column not found (nope)`.
    it('first(column) throws when the result set has no such column', async () => {
      const db = await withSchema()
      await db.prepare('INSERT INTO users (name, email) VALUES (?, ?)').bind('A', 'a@x.com').run()

      await expect(db.prepare('SELECT name FROM users').first('nope')).rejects.toThrow(
        /D1_COLUMN_NOTFOUND/,
      )
    })

    it('first(column) still resolves null when there is no row at all', async () => {
      const db = await withSchema()
      await expect(
        db.prepare('SELECT name FROM users WHERE email = ?').bind('missing').first('name'),
      ).resolves.toBeNull()
    })

    // Real D1 returns a BLOB as a plain Array of byte values, not a Uint8Array.
    it('returns a BLOB column as a plain byte array', async () => {
      const db = createFakeD1Database()
      await db.exec('CREATE TABLE b (id INTEGER PRIMARY KEY, payload BLOB)')
      await db.exec("INSERT INTO b (id, payload) VALUES (1, x'0102ff')")

      const row = await db.prepare('SELECT payload FROM b').first<{ payload: number[] }>()
      expect(Array.isArray(row?.payload)).toBe(true)
      expect(row?.payload).toEqual([1, 2, 255])

      const column = await db.prepare('SELECT payload FROM b').first<number[]>('payload')
      expect(column).toEqual([1, 2, 255])

      const raw = await db.prepare('SELECT payload FROM b').raw<[number[]]>()
      expect(raw[0]?.[0]).toEqual([1, 2, 255])
    })

    // Real D1's run() and all() return the identical shape; both carry rows.
    it('run() returns rows for a row-returning statement, like all()', async () => {
      const db = await withSchema()
      await db.prepare('INSERT INTO users (name, email) VALUES (?, ?)').bind('A', 'a@x.com').run()

      const result = await db.prepare('SELECT name FROM users').run<{ name: string }>()
      expect(result.results).toEqual([{ name: 'A' }])
      expect(result.meta.changes).toBe(0)
      expect(result.meta.changed_db).toBe(false)
    })

    it('run() on INSERT ... RETURNING reports both the rows and the write', async () => {
      const db = await withSchema()
      const result = await db
        .prepare('INSERT INTO users (name, email) VALUES (?, ?) RETURNING id, name')
        .bind('A', 'a@x.com')
        .run<{ id: number; name: string }>()

      expect(result.results).toEqual([{ id: 1, name: 'A' }])
      expect(result.meta.changes).toBe(1)
      expect(result.meta.changed_db).toBe(true)
      expect(result.meta.last_row_id).toBe(1)
    })
  })

  describe('batch()', () => {
    it('runs every statement and returns one D1Result per statement', async () => {
      const db = await withSchema()
      const results = await db.batch([
        db.prepare('INSERT INTO users (name, email) VALUES (?, ?)').bind('A', 'a@x.com'),
        db.prepare('INSERT INTO users (name, email) VALUES (?, ?)').bind('B', 'b@x.com'),
        db.prepare('SELECT COUNT(*) AS count FROM users'),
      ])

      expect(results).toHaveLength(3)
      expect(results[0]?.meta.changes).toBe(1)
      expect(results[1]?.meta.changes).toBe(1)
      expect(results[2]?.results).toEqual([{ count: 2 }])
    })

    it('is atomic: a failing statement rolls back every statement in the batch', async () => {
      const db = await withSchema()
      await db.prepare('INSERT INTO users (name, email) VALUES (?, ?)').bind('A', 'a@x.com').run()

      await expect(
        db.batch([
          db.prepare('INSERT INTO users (name, email) VALUES (?, ?)').bind('B', 'b@x.com'),
          // Duplicate email -- violates the UNIQUE constraint and must abort the whole batch.
          db.prepare('INSERT INTO users (name, email) VALUES (?, ?)').bind('C', 'a@x.com'),
        ]),
      ).rejects.toThrow(/UNIQUE constraint/)

      const count = await db.prepare('SELECT COUNT(*) AS count FROM users').first<{
        count: number
      }>('count')
      // Only the pre-existing row from before the batch survives.
      expect(count).toBe(1)
    })

    it('refuses a statement not created by this fake', async () => {
      const db = await withSchema()
      const foreignStatement = { bind: () => foreignStatement } as unknown as Parameters<
        typeof db.batch
      >[0][number]

      await expect(db.batch([foreignStatement])).rejects.toThrow(/own prepare\(\)/)
    })
  })

  it('dump() is explicitly unsupported', async () => {
    const db = createFakeD1Database()
    await expect(db.dump()).rejects.toThrow(/dump\(\)/)
  })

  it('withSession() is explicitly unsupported', () => {
    const db = createFakeD1Database()
    expect(() => db.withSession()).toThrow(/withSession\(\)/)
  })

  it('accepts a caller-supplied node:sqlite database', async () => {
    const { DatabaseSync } = await import('node:sqlite')
    const sqlite = new DatabaseSync(':memory:')
    sqlite.exec('CREATE TABLE t (id INTEGER)')
    sqlite.exec('INSERT INTO t (id) VALUES (42)')

    const db = createFakeD1Database({ database: sqlite })
    await expect(db.prepare('SELECT id FROM t').first()).resolves.toEqual({ id: 42 })
  })
})
