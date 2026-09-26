/**
 * narduk-libs#311: no statement may bind a bare JS array.
 *
 * postgres.js with `prepare: false, fetch_types: false` -- the shape `withHyperdriveConnection`
 * uses, and the one narduk-libs#304 caught failing live with `22P02 malformed
 * array literal` -- sends every parameter as untyped text. A bare array
 * parameter then reaches Postgres as a string it cannot parse as `uuid[]` or
 * `bigint[]`. The protocol fake's `unpreparedTextParameters` mode refuses such a
 * bind, so every public store path runs through it here.
 */
import { createProtocolFake, type ProtocolFake } from '@narduk-enterprises/narduk-postgres/testing'
import { describe, expect, it } from 'vitest'

import type { NardukTimeseriesError } from '../src/errors.js'
import { buildRollupQuery } from '../src/timescale/query.js'
import { buildRetentionStatements } from '../src/timescale/retention.js'
import { createTimescaleHistoryStore } from '../src/timescale/index.js'

const VESSEL = '11111111-1111-4111-8111-111111111111'
const OTHER_VESSEL = '22222222-2222-4222-8222-222222222222'

function unprepared(): ProtocolFake {
  return createProtocolFake({ unpreparedTextParameters: true })
}

const policy = {
  globalRawWindowMs: 7 * 86_400_000,
  globalRollupWindowMs: { '1h': 365 * 86_400_000, '1m': 30 * 86_400_000 },
  now: new Date('2026-09-12T03:00:00.000Z'),
  tiers: {
    free: {
      rawWindowMs: 86_400_000,
      rollupWindowMs: { '1m': 7 * 86_400_000 },
      trackWindowMs: 7 * 86_400_000,
      vesselIds: [VESSEL, OTHER_VESSEL],
    },
  },
}

describe('unprepared text-parameter connections (narduk-libs#311)', () => {
  it('queryRollup binds its series ids as one text parameter', async () => {
    const database = unprepared().respondTo(/FROM telemetry_numeric_1h/u, [])
    const store = createTimescaleHistoryStore({ executor: database })

    await store.queryRollup({
      bucket: '1h',
      range: { end: new Date('2026-09-12T00:00:00Z'), start: new Date('2026-09-11T00:00:00Z') },
      seriesIds: [7, 8, 9],
      tierWindowMs: 'unrestricted',
      vesselId: VESSEL,
    })

    expect(database.statements).toHaveLength(1)
    expect(database.statements[0]!.params[1]).toBe('7,8,9')
  })

  it('applyRetention binds each vessel batch as one text parameter', async () => {
    const database = unprepared()
      .respondTo(/pg_try_advisory_lock/u, [{ locked: true, pid: 4242 }])
      .respondTo(/pg_advisory_unlock/u, [{ pid: 4242, unlocked: true }])
    const store = createTimescaleHistoryStore({
      executor: unprepared(),
      retention: { executor: database, maxConnections: 1 },
    })

    await store.applyRetention(policy)

    const deletes = database.statements.filter((statement) => /DELETE FROM/u.test(statement.text))
    // Track only: a tier's raw window is a read depth, never a DELETE (#1081).
    expect(deletes).toHaveLength(1)
    for (const statement of deletes) {
      expect(statement.params[0]).toBe(`${VESSEL},${OTHER_VESSEL}`)
    }
  })

  it('writes and track reads were already scalar and stay that way', async () => {
    const database = unprepared()
      .respondTo(/INSERT INTO series/u, (params) => [
        {
          path: params[1],
          series_id: 1,
          unit: params[2],
          value_kind: params[3],
          vessel_id: VESSEL,
        },
      ])
      .respondTo(/FROM track_points/u, [])
    const store = createTimescaleHistoryStore({ executor: database })

    await store.writeNumeric([
      { path: 'a.b', ts: new Date('2026-09-11T00:00:00Z'), unit: 'V', value: 1, vesselId: VESSEL },
    ])
    await store.queryTrack({
      maxPoints: 10,
      range: { end: new Date('2026-09-12T00:00:00Z'), start: new Date('2026-09-11T00:00:00Z') },
      vesselId: VESSEL,
    })

    expect(database.statements.length).toBeGreaterThan(0)
  })

  it('refuses a vessel id that would split into two array elements', () => {
    // Joining on ',' is only safe because a vessel id cannot contain one. A
    // caller-supplied "a,b" must not silently widen a DELETE to two vessels.
    const error = (() => {
      try {
        buildRetentionStatements({
          ...policy,
          tiers: { free: { ...policy.tiers.free, vesselIds: [`${VESSEL},${OTHER_VESSEL}`] } },
        })
        return null
      } catch (cause) {
        return cause as NardukTimeseriesError
      }
    })()
    expect(error?.code).toBe('RETENTION_POLICY_INVALID')
  })

  it('keeps the rollup SQL a fixed five-parameter statement', () => {
    const built = buildRollupQuery({
      bucket: '1h',
      range: { end: new Date('2026-09-12T00:00:00Z'), start: new Date('2026-09-11T00:00:00Z') },
      seriesIds: [1, 2, 3],
      tierWindowMs: 'unrestricted',
      vesselId: VESSEL,
    })
    expect(built.params).toHaveLength(5)
    expect(built.params.some((value) => Array.isArray(value))).toBe(false)
  })
})
