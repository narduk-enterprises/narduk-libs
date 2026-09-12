/**
 * Parameter ceilings and deterministic scale.
 *
 * Two failures this file exists to prevent, both already paid for once on the
 * D1 path (mybo-at-v2#83): a batch builder that binds more parameters than the
 * protocol allows, and a write path whose statement count tracks the batch
 * rather than the budget.
 *
 * The scale axes are varied INDEPENDENTLY -- points with cardinality fixed, and
 * cardinality with points fixed -- because a single combined axis cannot tell a
 * per-point round trip apart from a per-series one.
 */
import {
  DEFAULT_PARAMETER_BUDGET,
  POSTGRES_MAX_BIND_PARAMETERS,
} from '@narduk-enterprises/narduk-postgres'
import { createProtocolFake, type ProtocolFake } from '@narduk-enterprises/narduk-postgres/testing'
import { describe, expect, it } from 'vitest'

import { createTimescaleHistoryStore } from '../src/timescale/index.js'
import {
  NUMERIC_PARAMETERS_PER_ROW,
  TRACK_PARAMETERS_PER_ROW,
  buildNumericWriteStatements,
  buildTrackWriteStatements,
  type ResolvedNumericPoint,
} from '../src/timescale/write.js'
import { SERIES_PARAMETERS_PER_ROW, buildSeriesResolveStatement } from '../src/timescale/series.js'
import { buildRollupQuery } from '../src/timescale/query.js'
import { buildRetentionStatements } from '../src/timescale/retention.js'
import type { NumericPoint, TrackPoint } from '../src/types.js'

const VESSEL = '11111111-1111-4111-8111-111111111111'

function resolvedPoints(count: number, cardinality: number): ResolvedNumericPoint[] {
  return Array.from({ length: count }, (_, index) => ({
    path: `p${String(index % cardinality)}`,
    seriesId: 1 + (index % cardinality),
    ts: new Date(Date.UTC(2026, 8, 11, 0, 0, 0, index)),
    value: index,
    vesselId: VESSEL,
  }))
}

function trackPoints(count: number): TrackPoint[] {
  return Array.from({ length: count }, (_, index) => ({
    latitude: 27.9,
    longitude: -82.5,
    ts: new Date(Date.UTC(2026, 8, 11, 0, 0, 0, index)),
    vesselId: VESSEL,
  }))
}

function points(count: number, cardinality: number): NumericPoint[] {
  return resolvedPoints(count, cardinality).map(({ seriesId: _seriesId, ...point }) => point)
}

function seriesFake(): ProtocolFake {
  return createProtocolFake().respondTo(/INSERT INTO series/u, (params) => {
    const rows: unknown[] = []
    for (let index = 0; index < params.length; index += SERIES_PARAMETERS_PER_ROW) {
      rows.push({
        path: params[index + 1],
        series_id: 1 + index / SERIES_PARAMETERS_PER_ROW,
        unit: params[index + 2],
        value_kind: params[index + 3],
        vessel_id: params[index],
      })
    }
    return rows
  })
}

describe('parameter ceilings', () => {
  it('states a budget strictly under the protocol maximum', () => {
    expect(POSTGRES_MAX_BIND_PARAMETERS).toBe(65_535)
    expect(DEFAULT_PARAMETER_BUDGET).toBeLessThan(POSTGRES_MAX_BIND_PARAMETERS)
  })

  it.each([
    [
      'numeric',
      NUMERIC_PARAMETERS_PER_ROW,
      (rows: number) => buildNumericWriteStatements(resolvedPoints(rows, 8)),
    ],
    [
      'track',
      TRACK_PARAMETERS_PER_ROW,
      (rows: number) => buildTrackWriteStatements(trackPoints(rows)),
    ],
  ])('keeps every %s statement inside the budget', (_label, perRow, build) => {
    const rowsPerStatement = Math.floor(DEFAULT_PARAMETER_BUDGET / perRow)
    // One row past a whole statement: the boundary a fencepost bug lands on.
    const statements = build(rowsPerStatement + 1)

    expect(statements).toHaveLength(2)
    expect(statements[0]!.rows).toBe(rowsPerStatement)
    expect(statements[1]!.rows).toBe(1)
    for (const statement of statements) {
      expect(statement.params.length).toBeLessThanOrEqual(DEFAULT_PARAMETER_BUDGET)
      expect(statement.params.length).toBe(statement.rows * perRow)
    }
  })

  it('honours a caller-tightened budget', () => {
    const statements = buildNumericWriteStatements(resolvedPoints(10, 2), 12)
    expect(statements).toHaveLength(5)
    expect(statements.every((statement) => statement.params.length <= 12)).toBe(true)
  })

  it('chunks a series resolve that would exceed the budget', () => {
    // 4 parameters per descriptor, so the budget caps the descriptor set too.
    const descriptors = Array.from({ length: 10 }, (_, index) => ({
      path: `p${String(index)}`,
      unit: null,
      valueKind: 'numeric' as const,
      vesselId: VESSEL,
    }))
    expect(buildSeriesResolveStatement(descriptors).params).toHaveLength(
      descriptors.length * SERIES_PARAMETERS_PER_ROW,
    )
    expect(() =>
      buildSeriesResolveStatement(
        Array.from({ length: DEFAULT_PARAMETER_BUDGET }, (_, index) => ({
          path: `p${String(index)}`,
          unit: null,
          valueKind: 'numeric' as const,
          vesselId: VESSEL,
        })),
      ),
    ).toThrow(/PARAMETER_BUDGET|budget/iu)
  })

  it('binds a fixed five parameters for a rollup read, whatever the series count', () => {
    for (const cardinality of [1, 10, 1000, 20_000]) {
      const built = buildRollupQuery({
        bucket: '1h',
        range: { end: new Date('2026-09-12T00:00:00Z'), start: new Date('2026-09-11T00:00:00Z') },
        seriesIds: Array.from({ length: cardinality }, (_, index) => index + 1),
        vesselId: VESSEL,
      })
      // The series list rides as one array parameter, not as N placeholders.
      expect(built.params).toHaveLength(5)
    }
  })

  it('chunks the remaining per-vessel deletes by the vessel ceiling', () => {
    const statements = buildRetentionStatements({
      globalRawWindowMs: 7 * 86_400_000,
      maxVesselsPerStatement: 100,
      now: new Date('2026-09-12T00:00:00Z'),
      tiers: {
        free: {
          rawWindowMs: 86_400_000,
          rollupWindowMs: { '1m': 86_400_000 },
          vesselIds: Array.from({ length: 250 }, (_, index) => `vessel-${String(index)}`),
        },
      },
    })
    const deletes = statements.filter((statement) => statement.kind === 'delete')
    // Per-tier raw only: rollup retention is global and per-vessel rollup
    // deletes no longer exist (round 24).
    expect(deletes).toHaveLength(3)
    for (const statement of deletes) {
      expect(statement.target).toBe('telemetry_numeric')
      expect((statement.params[0] as string[]).length).toBeLessThanOrEqual(100)
    }
  })

  it('binds one parameter per global rollup sweep, whatever the fleet size', () => {
    const statements = buildRetentionStatements({
      globalRawWindowMs: 7 * 86_400_000,
      globalRollupWindowMs: { '1d': 3650 * 86_400_000, '1h': 365 * 86_400_000 },
      now: new Date('2026-09-12T00:00:00Z'),
      tiers: {
        free: {
          rollupWindowMs: { '1h': 30 * 86_400_000 },
          vesselIds: Array.from({ length: 50_000 }, (_, index) => `vessel-${String(index)}`),
        },
      },
    })
    const rollupSweeps = statements.filter((statement) => statement.rollup !== null)
    expect(rollupSweeps.map((statement) => statement.rollup)).toEqual(['1h', '1d'])
    for (const statement of rollupSweeps) expect(statement.params).toHaveLength(1)
  })
})

describe('deterministic scale', () => {
  // Axis 1: points vary, series cardinality fixed.
  it.each([100, 1000, 10_000, 50_000])(
    'writes %i points at fixed cardinality in budget-many statements',
    async (count) => {
      const database = seriesFake()
      const store = createTimescaleHistoryStore({ executor: database })
      const expectedInserts = Math.ceil(
        count / Math.floor(DEFAULT_PARAMETER_BUDGET / NUMERIC_PARAMETERS_PER_ROW),
      )

      const result = await store.writeNumeric(points(count, 25))

      expect(database.countMatching(/INSERT INTO telemetry_numeric \(/u)).toBe(expectedInserts)
      expect(database.countMatching(/INSERT INTO series/u)).toBe(1)
      expect(result.statements).toBe(expectedInserts + 1)
      expect(database.maxParameters).toBeLessThanOrEqual(DEFAULT_PARAMETER_BUDGET)
    },
  )

  // Axis 2: series cardinality varies, point count fixed.
  it.each([1, 10, 100, 1000])(
    'writes a fixed 5000 points across %i series without a per-series statement',
    async (cardinality) => {
      const database = seriesFake()
      const store = createTimescaleHistoryStore({ executor: database })

      const result = await store.writeNumeric(points(5000, cardinality))

      expect(database.countMatching(/INSERT INTO series/u)).toBe(1)
      expect(result.seriesResolved).toBe(cardinality)
      expect(database.statements.length).toBeLessThanOrEqual(3)
    },
  )

  // Axis 3: retained history. The builders carry no notion of it -- which is
  // the point: nothing in a write or a read is a function of how much history
  // the database happens to hold.
  it('costs the same statements on an empty database and a full one', async () => {
    const counts: number[] = []
    for (const retained of [0, 1_000_000, 500_000_000]) {
      const database = seriesFake().respondTo(/count/u, [{ count: retained }])
      const store = createTimescaleHistoryStore({ executor: database })
      await store.writeNumeric(points(1000, 10))
      counts.push(database.statements.length)
    }
    expect(new Set(counts).size).toBe(1)
  })
})
