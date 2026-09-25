import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { describe, expect, it } from 'vitest'

import {
  chunkD1BoundValues,
  chunkD1Rows,
  collectD1ChunkedRows,
  runD1Chunked,
} from '../runtime/server/utils/d1Query'

const range = (count: number) => Array.from({ length: count }, (_, index) => index)
const sizes = (chunks: unknown[][]) => chunks.map((chunk) => chunk.length)

describe('chunkD1BoundValues', () => {
  it('keeps the old default of 75 values for a bare IN list', () => {
    expect(sizes(chunkD1BoundValues(range(160)))).toEqual([75, 75, 10])
  })

  it('counts parameters per value for a composite key', () => {
    // 2 per key: 50 keys fill the 100-parameter budget, so the 75 default is capped.
    expect(sizes(chunkD1BoundValues(range(120), { parametersPerValue: 2 }))).toEqual([50, 50, 20])
  })

  it('subtracts parameters bound outside the list', () => {
    const chunks = chunkD1BoundValues(range(200), {
      chunkSize: 99,
      reservedParameters: 1,
    })
    expect(sizes(chunks)).toEqual([99, 99, 2])
    expect(() => chunkD1BoundValues(range(200), { chunkSize: 100, reservedParameters: 1 })).toThrow(
      /chunkSize 100: must not exceed 99/u,
    )
  })

  it('throws at call time when an explicit chunk would overrun the budget', () => {
    expect(() =>
      chunkD1BoundValues(range(10), {
        chunkSize: 40,
        parametersPerValue: 3,
        reservedParameters: 1,
      }),
    ).toThrow(/must not exceed 33/u)
  })

  it('throws when the reserved and per-value parameters leave no room', () => {
    expect(() =>
      chunkD1BoundValues(range(10), { parametersPerValue: 60, reservedParameters: 50 }),
    ).toThrow(/Invalid D1 chunk budget/u)
  })

  it('rejects malformed widths', () => {
    expect(() => chunkD1BoundValues([1], { parametersPerValue: 0 })).toThrow(/parametersPerValue/u)
    expect(() => chunkD1BoundValues([1], { parametersPerValue: 1.5 })).toThrow(
      /parametersPerValue/u,
    )
    expect(() => chunkD1BoundValues([1], { reservedParameters: -1 })).toThrow(/reservedParameters/u)
  })
})

describe('chunkD1Rows', () => {
  const track = sqliteTable('track', {
    id: text('id').primaryKey(),
    lat: integer('lat'),
    lon: integer('lon'),
    recordedAt: integer('recorded_at'),
    vesselId: text('vessel_id'),
  })

  it('derives the row width from the Drizzle table', () => {
    // 5 columns: 20 rows bind exactly 100 parameters.
    expect(sizes(chunkD1Rows(range(45), track))).toEqual([20, 20, 5])
  })

  it('takes a column count and reserved parameters', () => {
    // 14 columns: 7 rows bind 98 parameters, the mybo track-state shape.
    expect(sizes(chunkD1Rows(range(15), 14))).toEqual([7, 7, 1])
    expect(sizes(chunkD1Rows(range(10), 3, { reservedParameters: 10 }))).toEqual([10])
    expect(sizes(chunkD1Rows(range(40), 3, { reservedParameters: 10 }))).toEqual([30, 10])
  })

  it('refuses a row wider than the whole budget', () => {
    expect(() => chunkD1Rows([{}], 101)).toThrow(/Invalid D1 chunk budget/u)
  })
})

describe('runD1Chunked and collectD1ChunkedRows', () => {
  it('pass the width options through to every chunk', async () => {
    const seen: number[] = []
    await runD1Chunked(
      range(90),
      (chunk) => {
        seen.push(chunk.length)
      },
      { parametersPerValue: 2, reservedParameters: 2 },
    )
    expect(seen).toEqual([49, 41])

    const rows = await collectD1ChunkedRows(range(5), (chunk) => chunk.map((value) => value * 2), {
      parametersPerValue: 40,
    })
    expect(rows).toEqual([0, 2, 4, 6, 8])
  })
})
