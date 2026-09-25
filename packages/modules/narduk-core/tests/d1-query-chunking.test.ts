import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { drizzle } from 'drizzle-orm/d1'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createD1QueryHarness } from '../../../tooling/narduk-testkit/src/d1'
import {
  chunkD1BoundValues,
  chunkD1Rows,
  collectD1ChunkedRows,
  D1_MAX_BOUND_PARAMETERS_PER_QUERY,
  runD1Chunked,
} from '../runtime/server/utils/d1Query'

import type { D1QueryHarness } from '../../../tooling/narduk-testkit/src/d1'

const range = (count: number) => Array.from({ length: count }, (_, index) => index)

/** The largest statement any chunk would bind, counted in parameters. */
function widestStatement(
  chunks: ReadonlyArray<readonly unknown[]>,
  perValue: number,
  reserved = 0,
) {
  return Math.max(...chunks.map((chunk) => chunk.length * perValue + reserved))
}

describe('chunkD1BoundValues, unchanged defaults', () => {
  it('keeps the 75-value default for a bare IN list', () => {
    const chunks = chunkD1BoundValues(range(200))
    expect(chunks.map((chunk) => chunk.length)).toEqual([75, 75, 50])
  })

  it('keeps honouring an explicit chunkSize up to the limit', () => {
    expect(chunkD1BoundValues(range(250), { chunkSize: 100 }).map((c) => c.length)).toEqual([
      100, 100, 50,
    ])
    expect(() => chunkD1BoundValues(range(5), { chunkSize: 101 })).toThrow(/must not exceed 100/)
  })

  it('returns no chunks for no values', () => {
    expect(chunkD1BoundValues([])).toEqual([])
  })
})

describe('chunkD1BoundValues, width-aware (narduk-libs#988)', () => {
  it('counts parameters, not values, for a composite key', () => {
    // acre-oracle's `(field, revision)` pair with the farm id reserved: 49 per statement.
    const chunks = chunkD1BoundValues(range(340), {
      chunkSize: 49,
      parametersPerValue: 2,
      reservedParameters: 1,
    })
    expect(widestStatement(chunks, 2, 1)).toBeLessThanOrEqual(D1_MAX_BOUND_PARAMETERS_PER_QUERY)
    expect(chunks.flat()).toEqual(range(340))
  })

  it('narrows the default chunk to what fits beside the reserved binds', () => {
    const chunks = chunkD1BoundValues(range(300), { parametersPerValue: 3, reservedParameters: 4 })
    // floor((100 - 4) / 3) = 32
    expect(chunks[0]).toHaveLength(32)
    expect(widestStatement(chunks, 3, 4)).toBe(100)
  })

  it('keeps the 75 default when the width still allows it', () => {
    expect(chunkD1BoundValues(range(200), { reservedParameters: 1 })[0]).toHaveLength(75)
  })

  it('refuses a chunkSize that would overrun once width and reserved binds are counted', () => {
    // 75 composite keys of 2 parameters is 150 binds: D1 would refuse the statement.
    expect(() => chunkD1BoundValues(range(10), { chunkSize: 75, parametersPerValue: 2 })).toThrow(
      /chunkSize 75.*must not exceed 50/,
    )
    expect(() => chunkD1BoundValues(range(10), { chunkSize: 100, reservedParameters: 1 })).toThrow(
      /must not exceed 99/,
    )
  })

  it('throws when a single value cannot fit', () => {
    expect(() => chunkD1BoundValues(range(3), { parametersPerValue: 101 })).toThrow(/no value fits/)
    expect(() =>
      chunkD1BoundValues(range(3), { parametersPerValue: 10, reservedParameters: 95 }),
    ).toThrow(/no value fits/)
  })

  it('rejects malformed width options', () => {
    expect(() => chunkD1BoundValues([1], { parametersPerValue: 0 })).toThrow(/parametersPerValue/)
    expect(() => chunkD1BoundValues([1], { parametersPerValue: 1.5 })).toThrow(/parametersPerValue/)
    expect(() => chunkD1BoundValues([1], { reservedParameters: -1 })).toThrow(/reservedParameters/)
    expect(() => chunkD1BoundValues([1], { reservedParameters: 100 })).toThrow(/reservedParameters/)
  })
})

describe('chunkD1Rows (narduk-libs#988)', () => {
  const track = sqliteTable('track', {
    id: integer('id').primaryKey(),
    vesselId: text('vessel_id').notNull(),
    recordedAt: integer('recorded_at').notNull(),
    lat: integer('lat'),
    lon: integer('lon'),
    sog: integer('sog'),
    cog: integer('cog'),
    heading: integer('heading'),
    source: text('source'),
    quality: integer('quality'),
    accuracy: integer('accuracy'),
    depth: integer('depth'),
    wind: integer('wind'),
    note: text('note'),
  })

  it('derives rows per INSERT from the table width', () => {
    // mybo-at-v2's 14-column track table: 7 rows per statement, never 500 binds.
    const chunks = chunkD1Rows(range(40), track)
    expect(chunks.map((chunk) => chunk.length)).toEqual([7, 7, 7, 7, 7, 5])
    expect(widestStatement(chunks, 14)).toBeLessThanOrEqual(D1_MAX_BOUND_PARAMETERS_PER_QUERY)
  })

  it('accepts a column count and reserved parameters', () => {
    // 16 columns with nothing reserved: 6 rows (96 binds).
    expect(chunkD1Rows(range(13), 16).map((chunk) => chunk.length)).toEqual([6, 6, 1])
    // 16 columns beside 5 other binds: floor(95 / 16) = 5 rows.
    expect(chunkD1Rows(range(11), 16, { reservedParameters: 5 })[0]).toHaveLength(5)
  })

  it('throws when one row is wider than the statement allows', () => {
    expect(() => chunkD1Rows([{}], 101)).toThrow(/no value fits/)
  })

  it('rejects a column count that is not a positive integer', () => {
    expect(() => chunkD1Rows([{}], 0)).toThrow(/parametersPerValue/)
  })
})

describe('on the real D1 driver (Miniflare workerd)', () => {
  const wide = sqliteTable('wide', {
    id: integer('id').primaryKey(),
    a: integer('a'),
    b: integer('b'),
    c: integer('c'),
    d: integer('d'),
    e: integer('e'),
    f: integer('f'),
    g: integer('g'),
    h: integer('h'),
    i: integer('i'),
    j: integer('j'),
    k: integer('k'),
    l: integer('l'),
    m: integer('m'),
  })
  const rows = range(40).map((id) => ({
    id,
    a: id,
    b: id,
    c: id,
    d: id,
    e: id,
    f: id,
    g: id,
    h: id,
    i: id,
    j: id,
    k: id,
    l: id,
    m: id,
  }))
  let harness: D1QueryHarness

  beforeAll(async () => {
    const dir = mkdtempSync(join(tmpdir(), 'd1-chunking-'))
    const migration = join(dir, '0000_wide.sql')
    const columns = 'abcdefghijklm'
      .split('')
      .map((name) => `${name} integer`)
      .join(', ')
    writeFileSync(migration, `CREATE TABLE wide (id integer PRIMARY KEY NOT NULL, ${columns});`)
    harness = await createD1QueryHarness({ migrations: [migration] })
  }, 60_000)

  afterAll(async () => {
    await harness?.dispose()
  })

  it('refuses one INSERT of 40 fourteen-column rows (560 parameters)', async () => {
    // Drizzle wraps the driver error ("Failed query: ..."); D1's reason is the cause.
    const error: unknown = await drizzle(harness.db)
      .insert(wide)
      .values(rows)
      .then(
        () => null,
        (rejection: unknown) => rejection,
      )
    expect(error).toBeInstanceOf(Error)
    const cause = (error as Error & { cause?: unknown }).cause
    expect(String(cause instanceof Error ? cause.message : cause)).toMatch(/too many SQL variables/)
  })

  it('accepts the same rows chunked by chunkD1Rows', async () => {
    await harness.clearData()
    const db = drizzle(harness.db)
    for (const chunk of chunkD1Rows(rows, wide)) {
      await db.insert(wide).values(chunk)
    }
    const stored = await db.select({ id: wide.id }).from(wide)
    expect(stored).toHaveLength(40)
  })
})

describe('runD1Chunked / collectD1ChunkedRows accept the width options', () => {
  it('passes width-sized chunks to the runner', async () => {
    const seen: number[] = []
    await runD1Chunked(
      range(100),
      (chunk) => {
        seen.push(chunk.length)
      },
      { parametersPerValue: 2, reservedParameters: 2 },
    )
    expect(seen).toEqual([49, 49, 2])
  })

  it('collects rows across width-sized chunks, in order', async () => {
    const rows = await collectD1ChunkedRows(
      range(60),
      (chunk) => chunk.map((value) => ({ value })),
      { parametersPerValue: 4 },
    )
    expect(rows.map((row) => row.value)).toEqual(range(60))
  })
})
