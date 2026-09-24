/**
 * Snapshot tests for every SQL builder.
 *
 * These are inline snapshots on purpose: the statement text is the contract
 * with a database nobody has stood up yet, so a reviewer reading this file sees
 * exactly what will run, and a refactor that changes a cast, a column order or
 * a bound order has to change the snapshot in the same diff.
 */
import { describe, expect, it } from 'vitest'

import {
  buildRollupQuery,
  planTrackQuery,
  REFRESH_MAX_WINDOW_MS,
  refreshRollupsStatements,
} from '../src/timescale/query.js'
import { buildRetentionStatements } from '../src/timescale/retention.js'
import { buildSeriesResolveStatement } from '../src/timescale/series.js'
import { ROLLUP_BUCKET_MS } from '../src/timescale/tables.js'
import { buildNumericWriteStatements, buildTrackWriteStatements } from '../src/timescale/write.js'
import { ROLLUP_BUCKETS } from '../src/types.js'

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
      "WITH input (vessel_id, path, unit, value_kind) AS (VALUES ($1::uuid, $2::text, $3::text, $4::text), ($5::uuid, $6::text, $7::text, $8::text))
      INSERT INTO series (vessel_id, path, unit, value_kind)
      SELECT vessel_id, path, unit, value_kind FROM input
      ON CONFLICT (vessel_id, path) DO UPDATE
         SET unit = COALESCE(EXCLUDED.unit, series.unit)
      RETURNING series_id, vessel_id, path, unit, value_kind"
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
      VALUES ($1, $2, $3, $4, $5, $6), ($7, $8, $9, $10, $11, $12)
      ON CONFLICT DO NOTHING"
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
      VALUES ($1, $2, ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography, $5, $6, $7, $8)
      ON CONFLICT DO NOTHING"
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
      tierWindowMs: 'unrestricted',
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
         AND series_id = ANY(string_to_array($2::text, ',')::bigint[])
         AND bucket >= $3::timestamptz
         AND bucket <  $4::timestamptz
       ORDER BY bucket ASC, series_id ASC
       LIMIT $5"
    `)
    expect(built.params).toEqual([VESSEL, '1,2,3', RANGE.start, RANGE.end, 1001])
  })

  it('selects the table from a frozen map and fails closed', () => {
    expect(
      buildRollupQuery({
        bucket: '1d',
        range: RANGE,
        seriesIds: [1],
        tierWindowMs: 'unrestricted',
        vesselId: VESSEL,
      }).text,
    ).toContain('FROM telemetry_numeric_1d')
    expect(() =>
      buildRollupQuery({
        bucket: '1m; DROP TABLE telemetry_numeric' as never,
        range: RANGE,
        seriesIds: [1],
        tierWindowMs: 'unrestricted',
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
  it('drops raw and rollup chunks globally and deletes only track and raw per tier', () => {
    const now = new Date('2026-09-12T03:15:00.000Z')
    const statements = buildRetentionStatements({
      globalRawWindowMs: 7 * 86_400_000,
      globalRollupWindowMs: {
        '1m': 30 * 86_400_000,
        '15m': 90 * 86_400_000,
        '1h': 365 * 86_400_000,
      },
      now,
      tiers: {
        free: {
          rawWindowMs: 86_400_000,
          rollupWindowMs: { '1m': 7 * 86_400_000, '1h': 30 * 86_400_000 },
          trackWindowMs: 7 * 86_400_000,
          vesselIds: [VESSEL],
        },
        cruiser: {
          rollupWindowMs: { '1m': 30 * 86_400_000 },
          trackWindowMs: 730 * 86_400_000,
          vesselIds: [OTHER_VESSEL],
        },
      },
    })

    // Round 24 (R24-1): a rollup level is pruned globally, with drop_chunks on
    // its materialization hypertable. There is no per-vessel DELETE against a
    // continuous aggregate any more -- tier depth is a read boundary.
    expect(
      statements.map(
        (statement) => `${statement.tier ?? 'global'} ${statement.kind} ${statement.target}`,
      ),
    ).toEqual([
      'global drop_chunks telemetry_numeric',
      'global drop_chunks telemetry_numeric_1m',
      'global drop_chunks telemetry_numeric_15m',
      'global drop_chunks telemetry_numeric_1h',
      'free delete track_points',
      'free delete telemetry_numeric',
      'cruiser delete track_points',
    ])
    expect(
      statements.some((statement) => /DELETE FROM telemetry_numeric_1/u.test(statement.text)),
    ).toBe(false)
    expect(statements[0]!.text).toBe(
      "SELECT drop_chunks('telemetry_numeric', older_than => $1::timestamptz)",
    )
    expect(statements[0]!.params).toEqual([new Date('2026-09-05T03:15:00.000Z')])
    expect(statements[1]!.text).toBe(
      "SELECT drop_chunks('telemetry_numeric_1m', older_than => $1::timestamptz)",
    )
    expect(statements[1]!.params).toEqual([new Date('2026-08-13T03:15:00.000Z')])
    // 1d has no global window, so it is never swept -- reported, not guessed.
    expect(statements.some((statement) => statement.rollup === '1d')).toBe(false)
    // The Free raw sweep exists only because round 20 chose both a 7-day global
    // raw window (1A) and a 24-hour Free raw window (2B).
    expect(statements[5]!.params).toEqual([VESSEL, new Date('2026-09-11T03:15:00.000Z')])
  })

  it('builds the explicit backfill refresh a late batch needs', () => {
    const statements = refreshRollupsStatements({ buckets: ['15m'], range: RANGE })
    expect(statements).toHaveLength(1)
    expect(statements[0]!.text).toBe(
      "CALL refresh_continuous_aggregate('telemetry_numeric_15m', $1::timestamptz, $2::timestamptz)",
    )
    expect(statements[0]!.params).toEqual([RANGE.start, RANGE.end])
    expect(statements[0]!.range).toEqual(RANGE)
  })

  it('orders the whole ladder fine-first, coarsest last', () => {
    // 15m reads 1m, 1h reads 15m, 1d reads 1h: refresh 1d first and it
    // summarizes buckets the level below has not materialized yet, and nothing
    // reports the hole. The order holds even when the caller asks backwards.
    const statements = refreshRollupsStatements({
      buckets: ['1d', '1h', '15m', '1m'],
      range: RANGE,
    })
    expect(statements.map((statement) => statement.bucket)).toEqual(['1m', '15m', '1h', '1d'])
  })

  it('splits a wide backfill into bounded windows per level', () => {
    // A year of 1m buckets in one CALL is 525 600 buckets per series
    // materialized inside a single statement. The ceiling is per level because
    // the bucket count, not the wall-clock width, is what costs.
    const range = {
      end: new Date('2027-01-01T00:00:00.000Z'),
      start: new Date('2026-01-01T00:00:00.000Z'),
    }
    const statements = refreshRollupsStatements({ range })
    const oneMinute = statements.filter((statement) => statement.bucket === '1m')
    expect(oneMinute.length).toBe(Math.ceil(365 / 7))
    for (const statement of statements) {
      const width = statement.range.end.getTime() - statement.range.start.getTime()
      expect(width).toBeLessThanOrEqual(REFRESH_MAX_WINDOW_MS[statement.bucket])
      expect(width).toBeGreaterThan(0)
    }
    // Contiguous and ascending inside a level: no bucket is skipped.
    for (let index = 1; index < oneMinute.length; index += 1) {
      expect(oneMinute[index]!.range.start).toEqual(oneMinute[index - 1]!.range.end)
    }
    expect(oneMinute[0]!.range.start).toEqual(range.start)
    expect(oneMinute.at(-1)!.range.end).toEqual(range.end)
  })

  it('refuses a window wider than the level allows', () => {
    expect(() =>
      refreshRollupsStatements({
        buckets: ['1m'],
        maxWindowMs: REFRESH_MAX_WINDOW_MS['1m'] + 1,
        range: RANGE,
      }),
    ).toThrow(/REFRESH_WINDOW_TOO_WIDE/u)
  })

  it('snaps each refresh window outward onto the level bucket', () => {
    // A ten-minute store-and-forward batch is narrower than a 15m, 1h or 1d
    // bucket. Splitting at the caller's offsets would emit those levels a
    // window Timescale has historically refused ("refresh window too small").
    const range = {
      end: new Date('2026-09-12T12:17:33.000Z'),
      start: new Date('2026-09-12T12:07:33.000Z'),
    }
    const statements = refreshRollupsStatements({ range })
    expect(statements.map((statement) => statement.bucket)).toEqual([...ROLLUP_BUCKETS])
    expect(statements.map((statement) => statement.range)).toEqual([
      {
        end: new Date('2026-09-12T12:18:00.000Z'),
        start: new Date('2026-09-12T12:07:00.000Z'),
      },
      {
        end: new Date('2026-09-12T12:30:00.000Z'),
        start: new Date('2026-09-12T12:00:00.000Z'),
      },
      {
        end: new Date('2026-09-12T13:00:00.000Z'),
        start: new Date('2026-09-12T12:00:00.000Z'),
      },
      {
        end: new Date('2026-09-13T00:00:00.000Z'),
        start: new Date('2026-09-12T00:00:00.000Z'),
      },
    ])
    for (const statement of statements) {
      const bucketMs = ROLLUP_BUCKET_MS[statement.bucket]
      const startMs = statement.range.start.getTime()
      const endMs = statement.range.end.getTime()
      expect(startMs % bucketMs).toBe(0)
      expect(endMs % bucketMs).toBe(0)
      expect(endMs - startMs).toBeGreaterThanOrEqual(bucketMs)
      expect(startMs).toBeLessThanOrEqual(range.start.getTime())
      expect(endMs).toBeGreaterThanOrEqual(range.end.getTime())
    }
  })

  it('folds a sub-bucket remainder into the previous refresh window', () => {
    const start = new Date('2026-01-01T00:00:00.000Z')
    const range = {
      end: new Date(start.getTime() + 70_000),
      start,
    }
    const statements = refreshRollupsStatements({
      buckets: ['1m'],
      maxWindowMs: 90_000,
      range,
    })
    // 90s is not a 1m multiple, so the walk floors to 1m. The 70s request
    // snaps to two minutes; both windows are aligned and cover every minute.
    expect(statements.map((statement) => statement.range)).toEqual([
      { end: new Date('2026-01-01T00:01:00.000Z'), start },
      {
        end: new Date('2026-01-01T00:02:00.000Z'),
        start: new Date('2026-01-01T00:01:00.000Z'),
      },
    ])
  })

  it('covers every 1m bucket when maxWindowMs is not a bucket multiple', () => {
    const start = new Date('2026-01-01T00:00:00.000Z')
    const statements = refreshRollupsStatements({
      buckets: ['1m'],
      maxWindowMs: 90_000,
      range: { end: new Date('2026-01-01T00:05:00.000Z'), start },
    })
    expect(statements).toHaveLength(5)
    for (const [index, statement] of statements.entries()) {
      expect(statement.range.start).toEqual(
        new Date(start.getTime() + index * ROLLUP_BUCKET_MS['1m']),
      )
      expect(statement.range.end).toEqual(
        new Date(start.getTime() + (index + 1) * ROLLUP_BUCKET_MS['1m']),
      )
    }
  })

  it('keeps an unaligned 14-day 1m backfill inside the ceiling and abutting', () => {
    const range = {
      end: new Date('2026-01-15T12:07:33.000Z'),
      start: new Date('2026-01-01T12:07:33.000Z'),
    }
    const statements = refreshRollupsStatements({
      buckets: ['1m'],
      range,
    })
    expect(statements[0]!.range.start).toEqual(new Date('2026-01-01T12:07:00.000Z'))
    expect(statements.at(-1)!.range.end).toEqual(new Date('2026-01-15T12:08:00.000Z'))
    for (const statement of statements) {
      const width = statement.range.end.getTime() - statement.range.start.getTime()
      expect(width).toBeLessThanOrEqual(REFRESH_MAX_WINDOW_MS['1m'])
      expect(width).toBeGreaterThanOrEqual(ROLLUP_BUCKET_MS['1m'])
      expect(statement.range.start.getTime() % ROLLUP_BUCKET_MS['1m']).toBe(0)
      expect(statement.range.end.getTime() % ROLLUP_BUCKET_MS['1m']).toBe(0)
    }
    for (let index = 1; index < statements.length; index += 1) {
      expect(statements[index]!.range.start).toEqual(statements[index - 1]!.range.end)
    }
  })

  it('rejects an empty buckets list and a non-positive maxWindowMs before the loop', () => {
    expect(() => refreshRollupsStatements({ buckets: [], range: RANGE })).toThrow(
      /buckets must name at least one rollup level/u,
    )
    expect(() => refreshRollupsStatements({ buckets: [], maxWindowMs: -1, range: RANGE })).toThrow(
      /maxWindowMs must be a positive number of milliseconds/u,
    )
    expect(() =>
      refreshRollupsStatements({ buckets: ['1m'], maxWindowMs: 0, range: RANGE }),
    ).toThrow(/maxWindowMs must be a positive number of milliseconds/u)
  })
})
