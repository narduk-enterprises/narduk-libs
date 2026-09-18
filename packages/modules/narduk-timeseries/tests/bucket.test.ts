import { describe, expect, it } from 'vitest'

import { READING_BUCKETS, bucketReadings, isNardukTimeseriesError } from '../src/index.js'

interface Reading {
  at: string | number | Date | null
  pressure?: number | null
  wind?: number | null
}

const fields = {
  pressure: (row: Reading) => row.pressure,
  wind: (row: Reading) => row.wind,
}

describe('bucketReadings', () => {
  it('exports the three client grains', () => {
    expect(READING_BUCKETS).toEqual(['1h', '3h', '1d'])
  })

  it('summarizes each hour into min, avg and max per field', () => {
    const { buckets, skipped } = bucketReadings<Reading, 'wind' | 'pressure'>(
      [
        { at: '2026-09-18T14:10:00Z', pressure: 30.1, wind: 10 },
        { at: '2026-09-18T14:50:00Z', pressure: 30.2, wind: 14 },
        { at: '2026-09-18T15:05:00Z', pressure: 30.0, wind: 0 },
      ],
      { bucket: '1h', fields, time: (row) => row.at },
    )

    expect(skipped).toBe(0)
    expect(buckets.map((b) => b.key)).toEqual(['2026-09-18T14', '2026-09-18T15'])
    expect(buckets[0]?.fields.wind).toEqual({ avg: 12, max: 14, min: 10, n: 2 })
    expect(buckets[0]?.rows).toBe(2)
    expect(buckets[0]?.start.toISOString()).toBe('2026-09-18T14:00:00.000Z')
    expect(buckets[0]?.end.toISOString()).toBe('2026-09-18T15:00:00.000Z')
    // Zero is a reading, not a missing value.
    expect(buckets[1]?.fields.wind).toEqual({ avg: 0, max: 0, min: 0, n: 1 })
  })

  it('reports a field with no finite value as null, never 0', () => {
    const { buckets } = bucketReadings<Reading, 'wind' | 'pressure'>(
      [
        { at: 0, pressure: null, wind: Number.NaN },
        { at: 60_000, wind: Number.POSITIVE_INFINITY },
      ],
      { bucket: '1h', fields, time: (row) => row.at },
    )

    expect(buckets).toHaveLength(1)
    expect(buckets[0]?.rows).toBe(2)
    expect(buckets[0]?.fields.wind).toEqual({ avg: null, max: null, min: null, n: 0 })
    expect(buckets[0]?.fields.pressure).toEqual({ avg: null, max: null, min: null, n: 0 })
  })

  it('floors 3-hour buckets on the wall clock of the requested zone', () => {
    // 19:50Z is 2:50 PM CDT, so the bucket opens at noon Central (17:00Z).
    const { buckets } = bucketReadings<Reading, 'wind'>([{ at: '2026-09-18T19:50:00Z', wind: 8 }], {
      bucket: '3h',
      fields: { wind: fields.wind },
      time: (row) => row.at,
      timeZone: 'America/Chicago',
    })

    expect(buckets[0]?.key).toBe('2026-09-18T12')
    expect(buckets[0]?.start.toISOString()).toBe('2026-09-18T17:00:00.000Z')
    expect(buckets[0]?.end.toISOString()).toBe('2026-09-18T20:00:00.000Z')
  })

  it('cuts days on the local calendar, not UTC midnight', () => {
    // 03:00Z on the 18th is still the evening of the 17th in Central time.
    const { buckets } = bucketReadings<Reading, 'wind'>(
      [
        { at: '2026-09-18T03:00:00Z', wind: 17 },
        { at: '2026-09-18T06:00:00Z', wind: 9 },
        { at: '2026-09-17T12:00:00Z', wind: 23 },
      ],
      {
        bucket: '1d',
        fields: { wind: fields.wind },
        order: 'desc',
        time: (row) => row.at,
        timeZone: 'America/Chicago',
      },
    )

    expect(buckets.map((b) => b.key)).toEqual(['2026-09-18', '2026-09-17'])
    expect(buckets[1]?.fields.wind).toEqual({ avg: 20, max: 23, min: 17, n: 2 })
    expect(buckets[0]?.start.toISOString()).toBe('2026-09-18T05:00:00.000Z')
  })

  it('makes a DST day 25 hours long, as the calendar did', () => {
    // US DST ends 2026-11-01: that Central day runs 05:00Z to 06:00Z next day.
    const { buckets } = bucketReadings<Reading, 'wind'>([{ at: '2026-11-01T12:00:00Z', wind: 1 }], {
      bucket: '1d',
      fields: { wind: fields.wind },
      time: (row) => row.at,
      timeZone: 'America/Chicago',
    })

    const day = buckets[0]
    expect(day?.start.toISOString()).toBe('2026-11-01T05:00:00.000Z')
    expect(day?.end.toISOString()).toBe('2026-11-02T06:00:00.000Z')
  })

  it('skips and counts rows whose time is unreadable', () => {
    const { buckets, skipped } = bucketReadings<Reading, 'wind'>(
      [
        { at: null, wind: 1 },
        { at: 'not a date', wind: 2 },
        { at: new Date('2026-01-01T00:30:00Z'), wind: 3 },
      ],
      { bucket: '1h', fields: { wind: fields.wind }, time: (row) => row.at },
    )

    expect(skipped).toBe(2)
    expect(buckets).toHaveLength(1)
  })

  it('does one pass: bucket count scales with distinct buckets, not with rows', () => {
    const rows: Reading[] = Array.from({ length: 10_000 }, (_, index) => ({
      at: Date.UTC(2026, 0, 1) + index * 60_000,
      wind: index % 30,
    }))
    const { buckets } = bucketReadings<Reading, 'wind'>(rows, {
      bucket: '1d',
      fields: { wind: fields.wind },
      time: (row) => row.at,
    })

    expect(buckets).toHaveLength(7)
    expect(buckets.reduce((sum, b) => sum + b.rows, 0)).toBe(10_000)
  })

  it('rejects an unknown bucket and an unknown zone with coded errors', () => {
    const run = (bucket: string, timeZone?: string) =>
      bucketReadings<Reading, 'wind'>([], {
        bucket: bucket as '1h',
        fields: { wind: fields.wind },
        time: (row) => row.at,
        timeZone,
      })

    try {
      run('2h')
      expect.unreachable()
    } catch (error) {
      expect(isNardukTimeseriesError(error) && error.code).toBe('BUCKET_UNKNOWN')
    }
    try {
      run('1h', 'Mars/Olympus_Mons')
      expect.unreachable()
    } catch (error) {
      expect(isNardukTimeseriesError(error) && error.code).toBe('RANGE_INVALID')
    }
  })
})
