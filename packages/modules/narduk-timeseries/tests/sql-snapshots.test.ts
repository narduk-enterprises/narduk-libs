/**
 * Snapshot tests for every SQL builder.
 *
 * These are inline snapshots on purpose: the statement text is the contract
 * with a database nobody has stood up yet, so a reviewer reading this file sees
 * exactly what will run, and a refactor that changes a cast, a column order or
 * a bound order has to change the snapshot in the same diff.
 */
import { describe, expect, it } from 'vitest'

import { buildRollupQuery, planTrackQuery } from '../src/timescale/query.js'
import { buildRetentionStatements } from '../src/timescale/retention.js'
import { buildSeriesResolveStatement } from '../src/timescale/series.js'
import { buildNumericWriteStatements, buildTrackWriteStatements } from '../src/timescale/write.js'

const VESSEL = '11111111-1111-4111-8111-111111111111'
const OTHER_VESSEL = '22222222-2222-4222-8222-222222222222'
const RANGE = {
  end: new Date('2026-09-12T00:00:00.000Z'),
  start: new Date('2026-09-11T00:00:00.000Z'),
}

describe('series resolution', () => {
  it('resolves a whole descriptor set in one statement', () => {
    const statement = buildSeriesResolveStatement([
      { path: 'navigation.speedOverGround', unit: 'm/s', valueKind: 'numeric', vesselId: VESSEL },
      {
        path: 'electrical.batteries.house.voltage',
        unit: 'V',
        valueKind: 'numeric',
        vesselId: VESSEL,
      },
    ])

    expect(statement.text).toMatchInlineSnapshot(`
      "WITH input (vessel_id, path, unit, value_kind) AS (VALUES ($1::uuid, $2::text, $3::text, $4::text), ($5::uuid, $6::text, $7::text, $8::text)),
      inserted AS (
        INSERT INTO series (vessel_id, path, unit, value_kind)
        SELECT vessel_id, path, unit, value_kind FROM input
        ON CONFLICT (vessel_id, path) DO NOTHING
        RETURNING series_id, vessel_id, path, unit, value_kind
      )
      SELECT series_id, vessel_id, path, unit, value_kind FROM inserted
      UNION ALL
      SELECT s.series_id, s.vessel_id, s.path, s.unit, s.value_kind
        FROM series s
        JOIN input i ON i.vessel_id = s.vessel_id AND i.path = s.path
       WHERE NOT EXISTS (
         SELECT 1 FROM inserted x WHERE x.vessel_id = s.vessel_id AND x.path = s.path
       )"
    `)
    expect(statement.params).toEqual([
      VESSEL,
      'navigation.speedOverGround',
      'm/s',
      'numeric',
      VESSEL,
      'electrical.batteries.house.voltage',
      'V',
      'numeric',
    ])
  })
})

describe('numeric write', () => {
  it('binds six parameters per row in column order', () => {
    const [statement] = buildNumericWriteStatements([
      {
        path: 'p',
        seriesId: 7,
        ts: new Date('2026-09-11T12:00:00.000Z'),
        value: 4.5,
        vesselId: VESSEL,
      },
      {
        installationRole: 1,
        path: 'p',
        quality: 2,
        seriesId: 7,
        ts: new Date('2026-09-11T12:00:01.000Z'),
        value: 4.6,
        vesselId: VESSEL,
      },
    ])

    expect(statement!.text).toMatchInlineSnapshot(`
      "INSERT INTO telemetry_numeric (ts, vessel_id, series_id, installation_role, value, quality)
      VALUES ($1, $2, $3, $4, $5, $6), ($7, $8, $9, $10, $11, $12)"
    `)
    expect(statement!.params).toEqual([
      new Date('2026-09-11T12:00:00.000Z'),
      VESSEL,
      7,
      0,
      4.5,
      0,
      new Date('2026-09-11T12:00:01.000Z'),
      VESSEL,
      7,
      1,
      4.6,
      2,
    ])
  })
})

describe('track write', () => {
  // ST_MakePoint takes x then y. Swapping them yields coordinates that are
  // silently valid and geographically absurd, so the order is pinned here
  // rather than left to review.
  it('builds the geography from longitude then latitude', () => {
    const [statement] = buildTrackWriteStatements([
      {
        cog: 1.5,
        depth: null,
        heading: 1.4,
        latitude: 27.9,
        longitude: -82.5,
        sog: 3.2,
        ts: new Date('2026-09-11T12:00:00.000Z'),
        vesselId: VESSEL,
      },
    ])

    expect(statement!.text).toMatchInlineSnapshot(`
      "INSERT INTO track_points (ts, vessel_id, geom, sog, cog, heading, depth)
      VALUES ($1, $2, ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography, $5, $6, $7, $8)"
    `)
    expect(statement!.params).toEqual([
      new Date('2026-09-11T12:00:00.000Z'),
      VESSEL,
      -82.5,
      27.9,
      3.2,
      1.5,
      1.4,
      null,
    ])
  })
})

describe('rollup query', () => {
  it('binds five parameters whatever the series cardinality', () => {
    const built = buildRollupQuery({
      bucket: '1h',
      maxRows: 1000,
      range: RANGE,
      seriesIds: [1, 2, 3],
      vesselId: VESSEL,
    })

    expect(built.text).toMatchInlineSnapshot(`
      "SELECT bucket,
             series_id,
             n,
             CASE WHEN n > 0 THEN sum_value / n ELSE 0 END AS avg,
             min_value AS min,
             max_value AS max,
             last_value AS last
        FROM telemetry_numeric_1h
       WHERE vessel_id = $1::uuid
         AND series_id = ANY($2::bigint[])
         AND bucket >= $3::timestamptz
         AND bucket <  $4::timestamptz
       ORDER BY bucket ASC, series_id ASC
       LIMIT $5"
    `)
    expect(built.params).toEqual([VESSEL, [1, 2, 3], RANGE.start, RANGE.end, 1001])
  })

  it('selects the table from a frozen map and fails closed', () => {
    expect(
      buildRollupQuery({ bucket: '1d', range: RANGE, seriesIds: [1], vesselId: VESSEL }).text,
    ).toContain('FROM telemetry_numeric_1d')
    expect(() =>
      buildRollupQuery({
        bucket: '1m; DROP TABLE telemetry_numeric' as never,
        range: RANGE,
        seriesIds: [1],
        vesselId: VESSEL,
      }),
    ).toThrow(/BUCKET_UNKNOWN/u)
  })
})

describe('track query', () => {
  it('reads raw rows when the requested density is finer than a second', () => {
    const plan = planTrackQuery({
      maxPoints: 5000,
      range: { end: new Date('2026-09-11T00:10:00.000Z'), start: new Date('2026-09-11T00:00:00Z') },
      vesselId: VESSEL,
    })
    expect(plan.decimated).toBe(false)
    expect(plan.bucketMs).toBeNull()
    expect(plan.query.text).toMatchInlineSnapshot(`
      "SELECT ts,
             ST_Y(geom::geometry) AS latitude,
             ST_X(geom::geometry) AS longitude,
             sog, cog, heading, depth
        FROM track_points
       WHERE vessel_id = $1::uuid
         AND ts >= $2::timestamptz
         AND ts <  $3::timestamptz
       ORDER BY ts ASC
       LIMIT $4"
    `)
  })

  it('decimates in the database above that density', () => {
    const plan = planTrackQuery({ maxPoints: 1000, range: RANGE, vesselId: VESSEL })
    expect(plan.decimated).toBe(true)
    expect(plan.bucketMs).toBe(86_400)
    expect(plan.query.text).toMatchInlineSnapshot(`
      "SELECT time_bucket($4::interval, ts) AS ts,
             ST_Y(last(geom, ts)::geometry) AS latitude,
             ST_X(last(geom, ts)::geometry) AS longitude,
             avg(sog)::real     AS sog,
             last(cog, ts)      AS cog,
             last(heading, ts)  AS heading,
             avg(depth)::real   AS depth
        FROM track_points
       WHERE vessel_id = $1::uuid
         AND ts >= $2::timestamptz
         AND ts <  $3::timestamptz
       GROUP BY 1
       ORDER BY 1 ASC
       LIMIT $5"
    `)
    expect(plan.query.params[3]).toBe('86400 milliseconds')
  })
})

describe('retention plan', () => {
  it('drops raw chunks globally and deletes per tier', () => {
    const now = new Date('2026-09-12T03:15:00.000Z')
    const statements = buildRetentionStatements({
      globalRawWindowMs: 7 * 86_400_000,
      now,
      tiers: {
        free: {
          rawWindowMs: 86_400_000,
          rollupWindowMs: { '1m': 7 * 86_400_000, '1h': 30 * 86_400_000 },
          trackWindowMs: 7 * 86_400_000,
          vesselIds: [VESSEL],
        },
        cruiser: {
          rollupWindowMs: { '1m': 365 * 86_400_000 },
          trackWindowMs: 730 * 86_400_000,
          vesselIds: [OTHER_VESSEL],
        },
      },
    })

    expect(
      statements.map(
        (statement) => `${statement.tier ?? 'global'} ${statement.kind} ${statement.target}`,
      ),
    ).toEqual([
      'global drop_chunks telemetry_numeric',
      'free delete telemetry_numeric_1m',
      'free delete telemetry_numeric_1h',
      'free delete track_points',
      'free delete telemetry_numeric',
      'cruiser delete telemetry_numeric_1m',
      'cruiser delete track_points',
    ])
    expect(statements[0]!.text).toBe(
      "SELECT drop_chunks('telemetry_numeric', older_than => $1::timestamptz)",
    )
    expect(statements[0]!.params).toEqual([new Date('2026-09-05T03:15:00.000Z')])
    expect(statements[1]!.text).toBe(
      'DELETE FROM telemetry_numeric_1m WHERE vessel_id = ANY($1::uuid[]) AND bucket < $2::timestamptz',
    )
    // The Free raw sweep exists only because round 20 chose both a 7-day global
    // raw window (1A) and a 24-hour Free raw window (2B).
    expect(statements[4]!.params).toEqual([[VESSEL], new Date('2026-09-11T03:15:00.000Z')])
  })
})
