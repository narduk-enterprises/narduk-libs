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
    globalRollupWindowMs: { '1h': 365 * 86_400_000, '1m': 30 * 86_400_000 },
    now: new Date('2026-09-12T03:00:00.000Z'),
    tiers: {
      free: {
        rawWindowMs: 86_400_000,
        rollupWindowMs: { '1m': 7 * 86_400_000 },
        vesselIds: [VESSEL],
      },
    },
  }

  /** A fake standing in for a session-pinned connection: one backend pid. */
  function pinned(pid = 4242): ProtocolFake {
    return createProtocolFake()
      .respondTo(/pg_try_advisory_lock/u, [{ locked: true, pid }])
      .respondTo(/pg_advisory_unlock/u, [{ pid, unlocked: true }])
  }

  it('refuses to sweep through an executor nobody has pinned', async () => {
    // A Hyperdrive pool can take the lock on one backend and release it on
    // another; the lock then survives, and every later sweep stands down and
    // deletes nothing.
    const store = createTimescaleHistoryStore({ executor: pinned() })
    const error = await store.applyRetention(policy).then(
      () => null,
      (cause: unknown) => cause as NardukTimeseriesError,
    )
    expect(error?.code).toBe('RETENTION_EXECUTOR_UNPINNED')
  })

  it('refuses a retention pool that is not tuned to a single connection', () => {
    expect(() =>
      createTimescaleHistoryStore({
        executor: createProtocolFake(),
        retention: { executor: createProtocolFake(), maxConnections: 10 },
      }),
    ).toThrow(/RETENTION_EXECUTOR_UNPINNED/u)
  })

  it('takes the advisory lock, sweeps, and releases it', async () => {
    const database = pinned()
    const store = createTimescaleHistoryStore({
      executor: createProtocolFake(),
      retention: { executor: database, maxConnections: 1 },
    })

    const result = await store.applyRetention(policy)

    expect(database.texts[0]).toContain('pg_try_advisory_lock')
    expect(database.texts.at(-1)).toContain('pg_advisory_unlock')
    expect(result.coalesced).toBe(false)
    expect(result.droppedRawOlderThan).toEqual(new Date('2026-09-05T03:00:00.000Z'))
    expect(result.droppedRollupsOlderThan).toEqual({
      '1h': new Date('2025-09-12T03:00:00.000Z'),
      '1m': new Date('2026-08-13T03:00:00.000Z'),
    })
    expect(result.policyIdentity).toMatch(/^[0-9a-f]{8}-[0-9a-f]+$/u)
    // 15m and 1d carry no global window: reported, never guessed at.
    expect(result.skipped).toEqual([
      'rollup level 15m has no globalRollupWindowMs and is never swept (retained indefinitely)',
      'rollup level 1d has no globalRollupWindowMs and is never swept (retained indefinitely)',
    ])
  })

  it('stands down when another process holds the lock', async () => {
    const database = createProtocolFake().respondTo(/pg_try_advisory_lock/u, [
      { locked: false, pid: 7 },
    ])
    const store = createTimescaleHistoryStore({
      executor: createProtocolFake(),
      retention: { executor: database },
    })

    const result = await store.applyRetention(policy)

    expect(result.coalesced).toBe(true)
    expect(result.skipped.at(-1)).toBe('another retention sweep holds the advisory lock')
    expect(database.countMatching(/DELETE FROM/u)).toBe(0)
    expect(database.countMatching(/drop_chunks/u)).toBe(0)
  })

  it('treats an unlock that returns false as the failure it is', async () => {
    // false means "this session never held that lock" -- which is exactly what
    // a pooled executor produces, and what leaks the lock.
    const database = createProtocolFake()
      .respondTo(/pg_try_advisory_lock/u, [{ locked: true, pid: 1 }])
      .respondTo(/pg_advisory_unlock/u, [{ pid: 2, unlocked: false }])
    const store = createTimescaleHistoryStore({
      executor: createProtocolFake(),
      retention: { executor: database },
    })

    await expect(store.applyRetention(policy)).rejects.toThrow(/RETENTION_UNLOCK_FAILED/u)
  })

  it('notices when lock and unlock ran on different backends', async () => {
    const database = createProtocolFake()
      .respondTo(/pg_try_advisory_lock/u, [{ locked: true, pid: 1 }])
      .respondTo(/pg_advisory_unlock/u, [{ pid: 2, unlocked: true }])
    const store = createTimescaleHistoryStore({
      executor: createProtocolFake(),
      retention: { executor: database },
    })

    const error = await store.applyRetention(policy).then(
      () => null,
      (cause: unknown) => cause as NardukTimeseriesError,
    )
    expect(error?.code).toBe('RETENTION_UNLOCK_FAILED')
    expect(error?.details).toEqual({ lockPid: 1, unlockPid: 2 })
  })

  it('coalesces a second in-process sweep of the SAME policy onto the first', async () => {
    const database = pinned()
    const store = createTimescaleHistoryStore({
      executor: createProtocolFake(),
      retention: { executor: database },
    })

    const [first, second] = await Promise.all([
      store.applyRetention(policy),
      store.applyRetention(policy),
    ])

    expect(first.coalesced).toBe(false)
    expect(second.coalesced).toBe(true)
    expect(second.policyIdentity).toBe(first.policyIdentity)
    expect(database.countMatching(/pg_try_advisory_lock/u)).toBe(1)
  })

  it('does not coalesce a DIFFERENT policy onto the one in flight', async () => {
    // The earlier single-flight was keyed on "a sweep is running", so a second
    // caller with a different policy got back a result describing deletions it
    // never asked for.
    const database = pinned()
    const store = createTimescaleHistoryStore({
      executor: createProtocolFake(),
      retention: { executor: database },
    })

    const other = { ...policy, globalRawWindowMs: 3 * 86_400_000 }
    const [first, second] = await Promise.all([
      store.applyRetention(policy),
      store.applyRetention(other),
    ])

    expect(first.coalesced).toBe(false)
    expect(second.coalesced).toBe(false)
    expect(second.policyIdentity).not.toBe(first.policyIdentity)
    expect(database.countMatching(/pg_try_advisory_lock/u)).toBe(2)
  })

  it('releases the lock even when a sweep statement fails, and reports the sweep failure', async () => {
    const database = createProtocolFake()
      .respondTo(/pg_try_advisory_lock/u, [{ locked: true, pid: 9 }])
      .respondTo(/pg_advisory_unlock/u, [{ pid: 9, unlocked: true }])
      .respondTo(/drop_chunks/u, () => {
        throw new Error('columnstore chunk is not droppable')
      })
    const store = createTimescaleHistoryStore({
      executor: createProtocolFake(),
      retention: { executor: database },
    })

    await expect(store.applyRetention(policy)).rejects.toThrow(/droppable/u)
    expect(database.texts.at(-1)).toContain('pg_advisory_unlock')
  })

  it('does not let a failed unlock mask the sweep failure', async () => {
    const database = createProtocolFake()
      .respondTo(/pg_try_advisory_lock/u, [{ locked: true, pid: 9 }])
      .respondTo(/pg_advisory_unlock/u, [{ pid: 9, unlocked: false }])
      .respondTo(/drop_chunks/u, () => {
        throw new Error('columnstore chunk is not droppable')
      })
    const store = createTimescaleHistoryStore({
      executor: createProtocolFake(),
      retention: { executor: database },
    })

    // The primary failure is the one an operator has to see.
    await expect(store.applyRetention(policy)).rejects.toThrow(/droppable/u)
  })
})

describe('batch atomicity', () => {
  it('wraps a multi-statement batch in one transaction', async () => {
    // The chunking is this library's bookkeeping, not a fact about the data:
    // a failure halfway through must not leave half a batch stored.
    const database = withSeriesResolution(createProtocolFake())
    const store = createTimescaleHistoryStore({ executor: database })

    await store.writeNumeric(numericPoints(12_000, 50))

    expect(database.countMatching(/INSERT INTO telemetry_numeric \(/u)).toBe(3)
    expect(database.countMatching(/^BEGIN$/u)).toBe(1)
    expect(database.countMatching(/^COMMIT$/u)).toBe(1)
    // The resolve is outside the transaction: a series row is a dimension, and
    // rolling it back would throw away work the next batch needs anyway.
    expect(database.texts.indexOf('BEGIN')).toBeGreaterThan(
      database.texts.findIndex((text) => text.includes('INSERT INTO series')),
    )
  })

  it('rolls the whole batch back when one chunk fails', async () => {
    const database = withSeriesResolution(createProtocolFake())
    let inserts = 0
    database.respondTo(/INSERT INTO telemetry_numeric \(/u, () => {
      inserts += 1
      if (inserts === 2) throw new Error('deadlock detected')
      return []
    })
    const store = createTimescaleHistoryStore({ executor: database })

    await expect(store.writeNumeric(numericPoints(12_000, 50))).rejects.toThrow(/deadlock/u)
    expect(database.countMatching(/^ROLLBACK$/u)).toBe(1)
    expect(database.countMatching(/^COMMIT$/u)).toBe(0)
  })

  it('does not pay for a transaction when the batch is one statement', async () => {
    const database = withSeriesResolution(createProtocolFake())
    const store = createTimescaleHistoryStore({ executor: database })

    await store.writeNumeric(numericPoints(100, 5))
    expect(database.countMatching(/^BEGIN$/u)).toBe(0)
  })
})

describe('tier clipping on read', () => {
  const now = new Date('2026-09-12T00:00:00.000Z')

  it('clips the requested range to the tier window and says so', async () => {
    const database = createProtocolFake().respondTo(/FROM telemetry_numeric_1h/u, [])
    const store = createTimescaleHistoryStore({ executor: database })

    const result = await store.queryRollup({
      bucket: '1h',
      now,
      range: { end: now, start: new Date('2026-06-12T00:00:00.000Z') },
      seriesIds: [7],
      tierWindowMs: 30 * 86_400_000,
      vesselId: VESSEL,
    })

    expect(result.clipped).toBe(true)
    expect(result.range.start).toEqual(new Date('2026-08-13T00:00:00.000Z'))
    expect(database.statements[0]?.params[2]).toEqual(new Date('2026-08-13T00:00:00.000Z'))
  })

  it('answers a range entirely outside the tier window without a statement', async () => {
    const database = createProtocolFake()
    const store = createTimescaleHistoryStore({ executor: database })

    const result = await store.queryRollup({
      bucket: '1h',
      now,
      range: {
        end: new Date('2026-01-02T00:00:00.000Z'),
        start: new Date('2026-01-01T00:00:00.000Z'),
      },
      seriesIds: [7],
      tierWindowMs: 30 * 86_400_000,
      vesselId: VESSEL,
    })

    expect(result.clipped).toBe(true)
    expect(result.rows).toEqual([])
    expect(database.statements).toHaveLength(0)
  })

  it('reads the full retained range when the caller declares no tier', async () => {
    const database = createProtocolFake().respondTo(/FROM telemetry_numeric_1h/u, [])
    const store = createTimescaleHistoryStore({ executor: database })

    const result = await store.queryRollup({
      bucket: '1h',
      now,
      range: { end: now, start: new Date('2020-01-01T00:00:00.000Z') },
      seriesIds: [7],
      vesselId: VESSEL,
    })

    expect(result.clipped).toBe(false)
    expect(result.range.start).toEqual(new Date('2020-01-01T00:00:00.000Z'))
  })
})
