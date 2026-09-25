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

describe('bucketReadings at a spring-forward gap (#938)', () => {
  /** A reading every 30 minutes from `from` (inclusive) to `to` (exclusive). */
  function halfHourly(from: string, to: string): Reading[] {
    const rows: Reading[] = []
    for (let ms = Date.parse(from); ms < Date.parse(to); ms += 30 * 60_000) {
      rows.push({ at: ms, wind: 1 })
    }
    return rows
  }

  function bucketsFor(rows: Reading[], bucket: '1h' | '3h' | '1d', timeZone: string) {
    return bucketReadings<Reading, 'wind'>(rows, {
      bucket,
      fields: { wind: fields.wind },
      time: (row) => row.at,
      timeZone,
    }).buckets
  }

  /**
   * Every way the buckets fail to tile time: a bucket with no width, one that
   * does not end where the next starts, or a row outside the bucket that
   * counted it. Empty means the buckets tile.
   */
  function tilingProblems(rows: Reading[], bucket: '1h' | '3h' | '1d', timeZone: string): string[] {
    const problems: string[] = []
    const buckets = bucketsFor(rows, bucket, timeZone)
    for (const [index, current] of buckets.entries()) {
      if (!(current.end.getTime() > current.start.getTime())) {
        problems.push(`${current.key} has no width`)
      }
      const next = buckets[index + 1]
      if (next && current.end.getTime() !== next.start.getTime()) {
        problems.push(
          `${current.key} ends at ${current.end.toISOString()}, not at ${next.key}'s start`,
        )
      }
    }
    for (const row of rows) {
      const ms = row.at as number
      // The bucket that counted this row is the one its own wall clock names.
      const [own] = bucketsFor([row], bucket, timeZone)
      const owner = buckets.find((b) => b.key === own?.key)
      if (!owner || owner.start.getTime() > ms || owner.end.getTime() <= ms) {
        problems.push(`${new Date(ms).toISOString()} lies outside ${own?.key}`)
      }
    }
    if (buckets.reduce((sum, b) => sum + b.rows, 0) !== rows.length) problems.push('rows lost')
    return problems
  }

  const chicago = halfHourly('2026-03-07T12:00:00Z', '2026-03-09T12:00:00Z')
  const santiago = halfHourly('2026-09-04T12:00:00Z', '2026-09-07T12:00:00Z')

  for (const grain of ['1h', '3h', '1d'] as const) {
    it(`tiles America/Chicago ${grain} across the 02:00 gap`, () => {
      expect(tilingProblems(chicago, grain, 'America/Chicago')).toEqual([])
    })
    it(`tiles America/Santiago ${grain} across the midnight gap`, () => {
      expect(tilingProblems(santiago, grain, 'America/Santiago')).toEqual([])
    })
  }

  const chicagoFallBack = halfHourly('2026-10-31T12:00:00Z', '2026-11-02T12:00:00Z')
  for (const grain of ['1h', '3h', '1d'] as const) {
    it(`still tiles America/Chicago ${grain} across the fall-back overlap`, () => {
      expect(tilingProblems(chicagoFallBack, grain, 'America/Chicago')).toEqual([])
    })
  }

  it('keeps the repeated fall-back hour in one two-hour bucket', () => {
    const hour = bucketsFor(chicagoFallBack, '1h', 'America/Chicago').find(
      (b) => b.key === '2026-11-01T01',
    )
    expect(hour?.start.toISOString()).toBe('2026-11-01T06:00:00.000Z')
    expect(hour?.end.toISOString()).toBe('2026-11-01T08:00:00.000Z')
    expect(hour?.rows).toBe(4)
  })

  it('ends the Chicago 01:00 hour at the transition, not on its own start', () => {
    const hour = bucketsFor(chicago, '1h', 'America/Chicago').find((b) => b.key === '2026-03-08T01')
    expect(hour?.start.toISOString()).toBe('2026-03-08T07:00:00.000Z')
    expect(hour?.end.toISOString()).toBe('2026-03-08T08:00:00.000Z')
    expect(hour?.rows).toBe(2)
  })

  it('ends the Santiago day before a midnight gap when the day really ends', () => {
    const days = bucketsFor(santiago, '1d', 'America/Santiago')
    const before = days.find((b) => b.key === '2026-09-05')
    const after = days.find((b) => b.key === '2026-09-06')
    expect(before?.end.toISOString()).toBe('2026-09-06T04:00:00.000Z')
    expect(after?.start.toISOString()).toBe('2026-09-06T04:00:00.000Z')
    // The day the clocks skipped midnight is 23 hours long.
    expect((after!.end.getTime() - after!.start.getTime()) / 3_600_000).toBe(23)
  })
})
