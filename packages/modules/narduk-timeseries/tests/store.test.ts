/**
 * Store behaviour against the Postgres protocol fake from narduk-postgres.
 *
 * The fake is not a database: it enforces the wire-protocol rules a builder can
 * break (the 65535-parameter Bind ceiling, dense placeholders, encodable
 * values) and records what was sent. That makes it the right gate for
 * "how many statements did this cost, and how many parameters did each bind" --
 * and the wrong gate for "does this SQL mean what I think". The live suite in
 * live-integration.test.ts owns the second question.
 */
import { createProtocolFake, type ProtocolFake } from '@narduk-enterprises/narduk-postgres/testing'
import { beforeEach, describe, expect, it } from 'vitest'

import { NardukTimeseriesError } from '../src/errors.js'
import { createTimescaleHistoryStore, type TimescaleHistoryStore } from '../src/timescale/index.js'
import type { NumericPoint } from '../src/types.js'

const VESSEL = '11111111-1111-4111-8111-111111111111'

/** Answer a series resolve the way the real statement does: one row per input. */
function withSeriesResolution(fake: ProtocolFake): ProtocolFake {
  return fake.respondTo(/INSERT INTO series/u, (params) => {
    const rows: unknown[] = []
    for (let index = 0; index < params.length; index += 4) {
      rows.push({
        path: params[index + 1],
        // Deterministic so an assertion can name an id.
        series_id: 1000 + index / 4,
        unit: params[index + 2],
        value_kind: params[index + 3],
        vessel_id: params[index],
      })
    }
    return rows
  })
}

function numericPoints(count: number, paths: number, vesselId = VESSEL): NumericPoint[] {
  return Array.from({ length: count }, (_, index) => ({
    path: `series.p${String(index % paths)}`,
    ts: new Date(Date.UTC(2026, 8, 11, 0, 0, index % 60)),
    unit: 'V',
    value: index / 10,
    vesselId,
  }))
}

describe('writeNumeric', () => {
  let database: ProtocolFake
  let store: TimescaleHistoryStore

  beforeEach(() => {
    database = withSeriesResolution(createProtocolFake())
    store = createTimescaleHistoryStore({ executor: database })
  })

  it('resolves the whole batch in one statement and inserts in one more', async () => {
    const result = await store.writeNumeric(numericPoints(500, 20))

    expect(database.statements).toHaveLength(2)
    expect(database.countMatching(/INSERT INTO series/u)).toBe(1)
    expect(database.countMatching(/INSERT INTO telemetry_numeric \(/u)).toBe(1)
    expect(result).toEqual({
      parameters: 3000,
      rows: 500,
      seriesFromCache: 0,
      seriesResolved: 20,
      statements: 2,
    })
  })

  it('costs one statement once the vessel path set is cached', async () => {
    await store.writeNumeric(numericPoints(500, 20))
    database.reset()

    const result = await store.writeNumeric(numericPoints(500, 20))
    expect(database.statements).toHaveLength(1)
    expect(database.countMatching(/INSERT INTO series/u)).toBe(0)
    expect(result.seriesFromCache).toBe(20)
    expect(result.statements).toBe(1)
  })

  it('never awaits a round trip per point', async () => {
    // The failure this pins is the obvious one: resolve-then-insert inside a
    // per-point loop. 5000 points must not cost 5000 statements.
    await store.writeNumeric(numericPoints(5000, 50))
    expect(database.statements.length).toBeLessThanOrEqual(3)
  })

  it('coalesces identical concurrent resolves onto one statement', async () => {
    const [first, second, third] = await Promise.all([
      store.resolveSeries([{ path: 'a', unit: null, valueKind: 'numeric', vesselId: VESSEL }]),
      store.resolveSeries([{ path: 'a', unit: null, valueKind: 'numeric', vesselId: VESSEL }]),
      store.resolveSeries([{ path: 'a', unit: null, valueKind: 'numeric', vesselId: VESSEL }]),
    ])

    expect(database.countMatching(/INSERT INTO series/u)).toBe(1)
    expect(first).toEqual(second)
    expect(second).toEqual(third)
  })

  it('fails loudly when the database answers a descriptor with no id', async () => {
    const silent = createProtocolFake().respondTo(/INSERT INTO series/u, [])
    const bare = createTimescaleHistoryStore({ executor: silent })
    const error = await bare.writeNumeric(numericPoints(1, 1)).then(
      () => null,
      (cause: unknown) => cause as NardukTimeseriesError,
    )

    expect(error).toBeInstanceOf(NardukTimeseriesError)
    expect(error?.code).toBe('SERIES_UNRESOLVED')
  })

  it('does nothing at all for an empty batch', async () => {
    const result = await store.writeNumeric([])
    expect(database.statements).toHaveLength(0)
    expect(result.statements).toBe(0)
  })
})

describe('writeTrack', () => {
  it('writes positions without touching the series dimension', async () => {
    const database = createProtocolFake()
    const store = createTimescaleHistoryStore({ executor: database })

    const result = await store.writeTrack(
      Array.from({ length: 100 }, (_, index) => ({
        latitude: 27.9 + index / 10_000,
        longitude: -82.5 + index / 10_000,
        sog: 3.2,
        ts: new Date(Date.UTC(2026, 8, 11, 0, 0, index)),
        vesselId: VESSEL,
      })),
    )

    expect(database.countMatching(/INSERT INTO series/u)).toBe(0)
    expect(database.statements).toHaveLength(1)
    expect(result.parameters).toBe(800)
    expect(result.seriesResolved).toBe(0)
  })
})

describe('queryRollup', () => {
  it('coerces driver strings and reports truncation without lying about rows', async () => {
    const database = createProtocolFake().respondTo(/FROM telemetry_numeric_1h/u, [
      {
        avg: '4.5',
        bucket: '2026-09-11T00:00:00.000Z',
        last: '5',
        max: '6',
        min: '3',
        n: '12',
        series_id: '7',
      },
      {
        avg: '4.6',
        bucket: '2026-09-11T01:00:00.000Z',
        last: '5',
        max: '6',
        min: '3',
        n: '12',
        series_id: '7',
      },
      {
        avg: '4.7',
        bucket: '2026-09-11T02:00:00.000Z',
        last: '5',
        max: '6',
        min: '3',
        n: '12',
        series_id: '7',
      },
    ])
    const store = createTimescaleHistoryStore({ executor: database })

    const result = await store.queryRollup({
      bucket: '1h',
      maxRows: 2,
      range: { end: new Date('2026-09-12T00:00:00Z'), start: new Date('2026-09-11T00:00:00Z') },
      seriesIds: [7],
      vesselId: VESSEL,
    })

    expect(result.truncated).toBe(true)
    expect(result.rows).toHaveLength(2)
    expect(result.rows[0]).toEqual({
      avg: 4.5,
      bucket: new Date('2026-09-11T00:00:00.000Z'),
      last: 5,
      max: 6,
      min: 3,
      n: 12,
      seriesId: 7,
    })
  })
})

describe('queryTrack', () => {
  it('reports the decimation it asked the database for', async () => {
    const database = createProtocolFake().respondTo(/FROM track_points/u, [
      {
        cog: null,
        depth: null,
        heading: null,
        latitude: '27.9',
        longitude: '-82.5',
        sog: '3.2',
        ts: '2026-09-11T00:00:00.000Z',
      },
    ])
    const store = createTimescaleHistoryStore({ executor: database })

    const result = await store.queryTrack({
      maxPoints: 10,
      range: { end: new Date('2026-09-12T00:00:00Z'), start: new Date('2026-09-11T00:00:00Z') },
      vesselId: VESSEL,
    })

    expect(result.decimated).toBe(true)
    expect(result.bucketMs).toBe(8_640_000)
    expect(result.truncated).toBe(false)
    expect(result.rows[0]?.latitude).toBe(27.9)
    expect(result.rows[0]?.cog).toBeNull()
  })
})

describe('applyRetention', () => {
  const policy = {
    globalRawWindowMs: 7 * 86_400_000,
    now: new Date('2026-09-12T03:00:00.000Z'),
    tiers: {
      free: {
        rawWindowMs: 86_400_000,
        rollupWindowMs: { '1m': 7 * 86_400_000 },
        vesselIds: [VESSEL],
      },
    },
  }

  it('takes the advisory lock, sweeps, and releases it', async () => {
    const database = createProtocolFake()
      .respondTo(/pg_try_advisory_lock/u, [{ locked: true }])
      .respondTo(/pg_advisory_unlock/u, [{ unlocked: true }])
    const store = createTimescaleHistoryStore({ executor: database })

    const result = await store.applyRetention(policy)

    expect(database.texts[0]).toContain('pg_try_advisory_lock')
    expect(database.texts.at(-1)).toContain('pg_advisory_unlock')
    expect(result.coalesced).toBe(false)
    expect(result.droppedRawOlderThan).toEqual(new Date('2026-09-05T03:00:00.000Z'))
  })

  it('stands down when another process holds the lock', async () => {
    const database = createProtocolFake().respondTo(/pg_try_advisory_lock/u, [{ locked: false }])
    const store = createTimescaleHistoryStore({ executor: database })

    const result = await store.applyRetention(policy)

    expect(result.coalesced).toBe(true)
    expect(result.skipped).toHaveLength(1)
    expect(database.countMatching(/DELETE FROM/u)).toBe(0)
    expect(database.countMatching(/drop_chunks/u)).toBe(0)
  })

  it('coalesces a second in-process sweep onto the one already running', async () => {
    const database = createProtocolFake()
      .respondTo(/pg_try_advisory_lock/u, [{ locked: true }])
      .respondTo(/pg_advisory_unlock/u, [{ unlocked: true }])
    const store = createTimescaleHistoryStore({ executor: database })

    const [first, second] = await Promise.all([
      store.applyRetention(policy),
      store.applyRetention(policy),
    ])

    expect(first.coalesced).toBe(false)
    expect(second.coalesced).toBe(true)
    expect(database.countMatching(/pg_try_advisory_lock/u)).toBe(1)
  })

  it('releases the lock even when a sweep statement fails', async () => {
    const database = createProtocolFake()
      .respondTo(/pg_try_advisory_lock/u, [{ locked: true }])
      .respondTo(/drop_chunks/u, () => {
        throw new Error('compressed chunk is not droppable')
      })
    const store = createTimescaleHistoryStore({ executor: database })

    await expect(store.applyRetention(policy)).rejects.toThrow(/droppable/u)
    expect(database.texts.at(-1)).toContain('pg_advisory_unlock')
  })
})
