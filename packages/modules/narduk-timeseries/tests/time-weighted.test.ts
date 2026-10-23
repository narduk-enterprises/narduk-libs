/**
 * Time-weighted rollups (migration 0005): the held-value fixture, the
 * reference implementation's rules, and the refresh plan's bounds.
 *
 * The fixture is the one docs/19 § 10 L3 asks for: a change-only series whose
 * sample mean and time-weighted mean differ, with the expected numbers worked
 * by hand in the comments. The live suite runs the SAME fixture through the SQL
 * refresh and asserts the database agrees with `timeWeightedBuckets`.
 */
import { createProtocolFake } from '@narduk-enterprises/narduk-postgres/testing'
import { describe, expect, it } from 'vitest'

import { NardukTimeseriesError } from '../src/errors.js'
import { timeWeightedBuckets } from '../src/time-weighted.js'
import {
  MAX_TIME_WEIGHTED_HOLD_MS,
  TIME_WEIGHTED_COARSE_SQL,
  TIME_WEIGHTED_MINUTE_SQL,
  buildTimeWeightedRollupQuery,
  createTimescaleHistoryStore,
  planTimeWeightedRefresh,
} from '../src/timescale/index.js'
import { HELD_VALUE_FIXTURE, HELD_VALUE_T0, heldValueAt } from './fixtures/held-value.js'

const VESSEL = '11111111-1111-4111-8111-111111111111'
const T0 = HELD_VALUE_T0
const at = heldValueAt

const sampleMean = (values: readonly number[]): number =>
  values.reduce((sum, value) => sum + value, 0) / values.length

describe('the held-value fixture', () => {
  const range = { end: at(300), start: at(0) }

  it('gives a 1-minute time-weighted mean that differs from the sample mean', () => {
    const buckets = timeWeightedBuckets(HELD_VALUE_FIXTURE, {
      bucketMs: 60_000,
      maxHoldMs: 600_000,
      range,
    })
    const first = buckets[0]!
    // Two rows in the first minute: the sample mean is (10 + 20) / 2 = 15.
    expect(sampleMean([10, 20])).toBe(15)
    // Held for 50 s and 10 s: (10 * 50 + 20 * 10) / 60 = 11.666...
    expect(first.mean).toBeCloseTo(700 / 60, 12)
    expect(first.mean).not.toBeCloseTo(15, 3)
    expect(first).toMatchObject({ heldMs: 60_000, last: 20, max: 20, min: 10, n: 2 })
  })

  it('carries a held value through minutes with no row, which a sample rollup cannot see', () => {
    const buckets = timeWeightedBuckets(HELD_VALUE_FIXTURE, {
      bucketMs: 60_000,
      maxHoldMs: 600_000,
      range,
    })
    expect(
      buckets.map((bucket) => [bucket.start.toISOString().slice(11, 19), bucket.n, bucket.mean]),
    ).toEqual([
      ['12:00:00', 2, 700 / 60],
      ['12:01:00', 1, 30],
      // No row in this minute: the sample ladder has no bucket at all; the
      // value 30 held the whole minute.
      ['12:02:00', 0, 30],
      // 30 for 30 s, then 40 for 30 s.
      ['12:03:00', 1, 35],
      ['12:04:00', 0, 40],
    ])
  })

  it('weights the whole window by time: 29.33 against a sample mean of 25', () => {
    const [window] = timeWeightedBuckets(HELD_VALUE_FIXTURE, {
      bucketMs: 300_000,
      maxHoldMs: 600_000,
      range,
    })
    // (10*50 + 20*10 + 30*150 + 40*90) / 300 = 8800 / 300 = 29.333...
    expect(window!.mean).toBeCloseTo(8800 / 300, 12)
    expect(sampleMean(HELD_VALUE_FIXTURE.map((reading) => reading.value))).toBe(25)
    expect(window!.n).toBe(4)
  })

  it('sums exactly up the ladder: a coarse bucket is the sum of its minutes', () => {
    const minutes = timeWeightedBuckets(HELD_VALUE_FIXTURE, {
      bucketMs: 60_000,
      maxHoldMs: 600_000,
      range,
    })
    const [coarse] = timeWeightedBuckets(HELD_VALUE_FIXTURE, {
      bucketMs: 300_000,
      maxHoldMs: 600_000,
      range,
    })
    const weighted = minutes.reduce((sum, bucket) => sum + bucket.weightedSum, 0)
    const held = minutes.reduce((sum, bucket) => sum + bucket.heldMs, 0)
    expect(weighted).toBeCloseTo(coarse!.weightedSum, 6)
    expect(held).toBe(coarse!.heldMs)
  })
})

describe('timeWeightedBuckets rules', () => {
  it('counts a gap longer than maxHold as no data, not a held value', () => {
    const readings = [
      { ts: at(0), value: 5 },
      // An outage: the next row is 10 minutes later.
      { ts: at(600), value: 7 },
    ]
    const buckets = timeWeightedBuckets(readings, {
      bucketMs: 60_000,
      maxHoldMs: 120_000,
      range: { end: at(660), start: at(0) },
    })
    // 5 holds for 2 minutes, then nothing until 7 arrives.
    expect(buckets.map((bucket) => bucket.start.getTime())).toEqual([T0, T0 + 60_000, T0 + 600_000])
    expect(buckets.every((bucket) => bucket.heldMs === 60_000)).toBe(true)
  })

  it('carries in a value from before the window', () => {
    const [bucket] = timeWeightedBuckets(
      [
        { ts: at(-30), value: 8 },
        { ts: at(30), value: 2 },
      ],
      { bucketMs: 60_000, maxHoldMs: 600_000, range: { end: at(60), start: at(0) } },
    )
    // 8 for the first 30 s (carried in), 2 for the last 30 s.
    expect(bucket).toMatchObject({ heldMs: 60_000, mean: 5, n: 1 })
  })

  it('keeps the last of two readings at one instant, as the natural key does', () => {
    const [bucket] = timeWeightedBuckets(
      [
        { ts: at(0), value: 1 },
        { ts: at(0), value: 3 },
      ],
      { bucketMs: 60_000, maxHoldMs: 60_000, range: { end: at(60), start: at(0) } },
    )
    expect(bucket).toMatchObject({ mean: 3, n: 1 })
  })

  it('refuses a non-positive bucket or hold and an empty range', () => {
    const range = { end: at(60), start: at(0) }
    expect(() => timeWeightedBuckets([], { bucketMs: 0, maxHoldMs: 1, range })).toThrow(
      NardukTimeseriesError,
    )
    expect(() => timeWeightedBuckets([], { bucketMs: 1, maxHoldMs: Number.NaN, range })).toThrow(
      NardukTimeseriesError,
    )
    expect(() =>
      timeWeightedBuckets([], { bucketMs: 1, maxHoldMs: 1, range: { end: at(0), start: at(0) } }),
    ).toThrow(NardukTimeseriesError)
  })
})

describe('planTimeWeightedRefresh', () => {
  const now = Date.parse('2026-10-02T06:00:30.000Z')

  it('widens by maxHold both ways to the minute, then splits at UTC days', () => {
    const plan = planTimeWeightedRefresh(
      {
        maxHoldMs: 600_000,
        range: {
          end: new Date('2026-10-01T23:58:10.000Z'),
          start: new Date('2026-10-01T23:50:45.000Z'),
        },
        vesselId: VESSEL,
      },
      now,
    )
    expect(plan.range).toEqual({
      end: new Date('2026-10-02T00:09:00.000Z'),
      start: new Date('2026-10-01T23:40:00.000Z'),
    })
    expect(
      plan.statements.map((statement) => [
        statement.kind,
        statement.range.start.toISOString(),
        statement.range.end.toISOString(),
      ]),
    ).toEqual([
      ['minute', '2026-10-01T23:40:00.000Z', '2026-10-02T00:00:00.000Z'],
      ['coarse', '2026-10-01T00:00:00.000Z', '2026-10-02T00:00:00.000Z'],
      ['minute', '2026-10-02T00:00:00.000Z', '2026-10-02T00:09:00.000Z'],
      ['coarse', '2026-10-02T00:00:00.000Z', '2026-10-03T00:00:00.000Z'],
    ])
  })

  it('binds four and three parameters whatever the range or fleet', () => {
    const plan = planTimeWeightedRefresh(
      {
        maxHoldMs: 300_000,
        range: {
          end: new Date('2026-09-30T00:00:00.000Z'),
          start: new Date('2026-09-01T00:00:00.000Z'),
        },
      },
      now,
    )
    // 29 days plus the hold back into 08-31 and forward into 09-30, two each.
    expect(plan.statements).toHaveLength(2 * 31)
    for (const statement of plan.statements) {
      expect(statement.params).toHaveLength(statement.kind === 'minute' ? 4 : 3)
      expect(statement.params[0]).toBeNull()
      expect(statement.range.end.getTime() - statement.range.start.getTime()).toBeLessThanOrEqual(
        86_400_000,
      )
    }
    expect(plan.statements[0]!.params[3]).toBe('300000 milliseconds')
  })

  it('finishes, on the next refresh, a minute the last one stopped short of', () => {
    // A row at 12:00:10 refreshed at 12:00:30 stops short of minute 12:00 (it
    // has not ended); the next batch starts at 12:01:05 and must still cover it.
    const t = (iso: string) => new Date(`2026-10-01T${iso}Z`)
    const first = planTimeWeightedRefresh(
      { maxHoldMs: 60_000, range: { end: t('12:00:10.001'), start: t('12:00:10') } },
      t('12:00:30').getTime(),
    )
    expect(first.range?.end).toEqual(t('12:00:00'))
    const next = planTimeWeightedRefresh(
      { maxHoldMs: 60_000, range: { end: t('12:01:05.001'), start: t('12:01:05') } },
      t('12:02:30').getTime(),
    )
    expect(next.range).toEqual({ end: t('12:02:00'), start: t('12:00:00') })
  })

  it('never writes a bucket for time that has not happened', () => {
    const plan = planTimeWeightedRefresh(
      {
        maxHoldMs: 600_000,
        range: { end: new Date(now + 3_600_000), start: new Date(now - 120_000) },
      },
      now,
    )
    expect(plan.range?.end.toISOString()).toBe('2026-10-02T06:00:00.000Z')
    const future = planTimeWeightedRefresh(
      {
        maxHoldMs: 600_000,
        range: { end: new Date(now + 7_200_000), start: new Date(now + 3_600_000) },
      },
      now,
    )
    expect(future).toEqual({ range: null, statements: [] })
  })

  it('refuses a hold outside 1 s .. 6 h, which bounds the minutes one row fans out to', () => {
    const range = { end: new Date(now - 60_000), start: new Date(now - 120_000) }
    for (const maxHoldMs of [0, 999, MAX_TIME_WEIGHTED_HOLD_MS + 1, 1.5, Number.NaN]) {
      expect(() => planTimeWeightedRefresh({ maxHoldMs, range }, now)).toThrow(
        NardukTimeseriesError,
      )
    }
    expect(() => planTimeWeightedRefresh({ maxHoldMs: 60_000, range, vesselId: '' }, now)).toThrow(
      NardukTimeseriesError,
    )
  })

  it('reads primary raw only and upserts, so a re-run is idempotent', () => {
    expect(TIME_WEIGHTED_MINUTE_SQL).toContain('installation_role = 0')
    expect(TIME_WEIGHTED_MINUTE_SQL).toContain(
      'lead(ts) OVER (PARTITION BY vessel_id, series_id ORDER BY ts)',
    )
    expect(TIME_WEIGHTED_MINUTE_SQL).toContain('$2::timestamptz - $4::interval')
    for (const sql of [TIME_WEIGHTED_MINUTE_SQL, TIME_WEIGHTED_COARSE_SQL]) {
      expect(sql).toContain('ON CONFLICT (vessel_id, series_id, bucket_seconds, bucket) DO UPDATE')
      expect(sql).not.toMatch(/\bDELETE\b/u)
    }
  })
})

describe('the time-weighted read', () => {
  it('reads one level by a bound parameter, with the rollup tier clip', () => {
    const built = buildTimeWeightedRollupQuery({
      bucket: '15m',
      range: { end: new Date(Date.now()), start: new Date(Date.now() - 10 * 86_400_000) },
      seriesIds: [3, 4],
      tierWindowMs: 86_400_000,
      vesselId: VESSEL,
    })
    expect(built.clipped).toBe(true)
    expect(built.params).toHaveLength(6)
    expect(built.params[2]).toBe(900)
    expect(built.text).toContain('weighted_sum / held_seconds')
    expect(built.text).not.toContain('telemetry_numeric_15m')
  })

  it('refuses an unknown level before building SQL', () => {
    expect(() =>
      buildTimeWeightedRollupQuery({
        bucket: '5m' as '1m',
        range: { end: new Date(), start: new Date(Date.now() - 60_000) },
        seriesIds: [1],
        tierWindowMs: 'unrestricted',
        vesselId: VESSEL,
      }),
    ).toThrow(/BUCKET_UNKNOWN/u)
  })

  it('maps rows and reports truncation through the store', async () => {
    const database = createProtocolFake().respondTo(/FROM telemetry_numeric_tw/u, [
      {
        avg: '11.5',
        bucket: new Date(T0),
        held_seconds: '60',
        last: '20',
        max: '20',
        min: '10',
        n: '2',
        series_id: '3',
      },
      {
        avg: 30,
        bucket: new Date(T0 + 60_000),
        held_seconds: 60,
        last: null,
        max: null,
        min: null,
        n: 0,
        series_id: 3,
      },
    ])
    const store = createTimescaleHistoryStore({ executor: database })
    const result = await store.queryTimeWeightedRollup({
      bucket: '1m',
      maxRows: 1,
      range: { end: new Date(T0 + 120_000), start: new Date(T0) },
      seriesIds: [3],
      tierWindowMs: 'unrestricted',
      vesselId: VESSEL,
    })
    expect(result.truncated).toBe(true)
    expect(result.rows).toEqual([
      {
        avg: 11.5,
        bucket: new Date(T0),
        heldMs: 60_000,
        last: 20,
        max: 20,
        min: 10,
        n: 2,
        seriesId: 3,
      },
    ])
  })

  it('answers a range wholly past the tier window with no statement', async () => {
    const database = createProtocolFake()
    const store = createTimescaleHistoryStore({ executor: database })
    const result = await store.queryTimeWeightedRollup({
      bucket: '1h',
      range: {
        end: new Date(Date.now() - 10 * 86_400_000),
        start: new Date(Date.now() - 20 * 86_400_000),
      },
      seriesIds: [1],
      tierWindowMs: 86_400_000,
      vesselId: VESSEL,
    })
    expect(result).toMatchObject({ clipped: true, rows: [], truncated: false })
    expect(database.statements).toHaveLength(0)
  })

  it('runs the refresh plan in order and sums the rows it upserted', async () => {
    const database = createProtocolFake()
    const store = createTimescaleHistoryStore({ executor: database })
    const end = new Date(Math.floor(Date.now() / 60_000) * 60_000 - 3_600_000)
    const result = await store.refreshTimeWeighted({
      maxHoldMs: 60_000,
      range: { end, start: new Date(end.getTime() - 120_000) },
      vesselId: VESSEL,
    })
    expect(result.statements).toBe(database.statements.length)
    expect(database.statements[0]!.text).toBe(TIME_WEIGHTED_MINUTE_SQL)
    expect(database.statements[1]!.text).toBe(TIME_WEIGHTED_COARSE_SQL)
  })
})
