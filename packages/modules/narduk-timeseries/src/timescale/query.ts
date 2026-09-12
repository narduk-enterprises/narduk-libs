/**
 * The read builders.
 *
 * Both are written so their **parameter count does not grow with the data**:
 * a rollup over four hundred series binds the same five parameters as a rollup
 * over one, because the series set goes in as a single `bigint[]` rather than
 * as four hundred placeholders. That is the difference between a statement the
 * planner caches and a statement that walks toward the protocol's 65535-
 * parameter ceiling as a vessel's path set grows.
 *
 * Both are also bounded in **response bytes**, not just in row count. A rollup
 * takes a `maxRows` ceiling and reports `truncated` rather than quietly
 * returning a partial answer; a track query takes `maxPoints` and, above that
 * density, decimates inside the database with `time_bucket` instead of shipping
 * a hundred thousand rows across a tunnel for a client to throw away.
 */

import { NardukTimeseriesError } from '../errors.js'
import type { RollupQuery, TimeRange, TrackQuery } from '../types.js'
import { ROLLUP_BUCKET_MS, TRACK_TABLE, rollupTable } from './tables.js'

export const DEFAULT_MAX_ROLLUP_ROWS = 50_000
export const DEFAULT_MAX_TRACK_POINTS = 5000
/** Below this the decimation buckets are finer than the data, so read it raw. */
export const MIN_TRACK_BUCKET_MS = 1000

export interface BuiltQuery {
  params: unknown[]
  text: string
}

export function assertRange(range: TimeRange): TimeRange {
  const { end, start } = range
  if (!(start instanceof Date) || Number.isNaN(start.getTime())) {
    throw new NardukTimeseriesError('RANGE_INVALID', 'range.start must be a Date.')
  }
  if (!(end instanceof Date) || Number.isNaN(end.getTime())) {
    throw new NardukTimeseriesError('RANGE_INVALID', 'range.end must be a Date.')
  }
  if (end.getTime() <= start.getTime()) {
    throw new NardukTimeseriesError(
      'RANGE_INVALID',
      'range.end must be strictly after range.start.',
      { end: end.toISOString(), start: start.toISOString() },
    )
  }
  return range
}

function assertPositiveInteger(label: string, value: number): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new NardukTimeseriesError('RANGE_INVALID', `${label} must be a positive integer.`, {
      label,
      value,
    })
  }
  return value
}

/**
 * `avg` is computed here, from `sum_value / n`, rather than read from a stored
 * `avg` column. Migration 0002 explains why: chaining an average of averages is
 * only correct when every bucket has the same number of points, which a
 * telemetry store cannot promise. The division is guarded so a bucket that
 * somehow recorded zero rows returns 0 instead of NaN.
 */
export function buildRollupQuery(query: RollupQuery): BuiltQuery {
  const table = rollupTable(query.bucket)
  assertRange(query.range)

  if (!Array.isArray(query.seriesIds) || query.seriesIds.length === 0) {
    throw new NardukTimeseriesError(
      'SERIES_UNRESOLVED',
      'A rollup query needs at least one resolved series id.',
    )
  }
  for (const seriesId of query.seriesIds) {
    if (!Number.isInteger(seriesId) || seriesId <= 0) {
      throw new NardukTimeseriesError(
        'SERIES_UNRESOLVED',
        'Series ids must be positive integers.',
        {
          seriesId,
        },
      )
    }
  }

  const maxRows = assertPositiveInteger('maxRows', query.maxRows ?? DEFAULT_MAX_ROLLUP_ROWS)

  return {
    // The limit is maxRows + 1 so a full page is distinguishable from an exact
    // fit: the adapter reports `truncated` on the extra row and drops it.
    params: [query.vesselId, query.seriesIds, query.range.start, query.range.end, maxRows + 1],
    text: [
      `SELECT bucket,`,
      `       series_id,`,
      `       n,`,
      `       CASE WHEN n > 0 THEN sum_value / n ELSE 0 END AS avg,`,
      `       min_value AS min,`,
      `       max_value AS max,`,
      `       last_value AS last`,
      `  FROM ${table}`,
      ` WHERE vessel_id = $1::uuid`,
      `   AND series_id = ANY($2::bigint[])`,
      `   AND bucket >= $3::timestamptz`,
      `   AND bucket <  $4::timestamptz`,
      ` ORDER BY bucket ASC, series_id ASC`,
      ` LIMIT $5`,
    ].join('\n'),
  }
}

export function rollupBucketMs(bucket: RollupQuery['bucket']): number {
  return ROLLUP_BUCKET_MS[bucket]
}

export interface TrackPlan {
  /** null when the plan reads raw rows. */
  bucketMs: number | null
  decimated: boolean
  maxPoints: number
  query: BuiltQuery
}

/**
 * Decide raw or decimated from the range and the point ceiling, then build the
 * matching statement.
 *
 * The rule is deterministic and stated: `bucketMs = ceil(rangeMs / maxPoints)`,
 * and anything below `MIN_TRACK_BUCKET_MS` reads raw because the buckets would
 * be finer than the data. A caller asking for 5000 points over a year gets
 * about 5000 rows; the same caller over ten minutes gets every point.
 */
export function planTrackQuery(query: TrackQuery): TrackPlan {
  assertRange(query.range)
  const maxPoints = assertPositiveInteger('maxPoints', query.maxPoints ?? DEFAULT_MAX_TRACK_POINTS)
  const rangeMs = query.range.end.getTime() - query.range.start.getTime()
  const bucketMs = Math.ceil(rangeMs / maxPoints)

  if (bucketMs < MIN_TRACK_BUCKET_MS) {
    return {
      bucketMs: null,
      decimated: false,
      maxPoints,
      query: {
        params: [query.vesselId, query.range.start, query.range.end, maxPoints + 1],
        text: [
          `SELECT ts,`,
          `       ST_Y(geom::geometry) AS latitude,`,
          `       ST_X(geom::geometry) AS longitude,`,
          `       sog, cog, heading, depth`,
          `  FROM ${TRACK_TABLE}`,
          ` WHERE vessel_id = $1::uuid`,
          `   AND ts >= $2::timestamptz`,
          `   AND ts <  $3::timestamptz`,
          ` ORDER BY ts ASC`,
          ` LIMIT $4`,
        ].join('\n'),
      },
    }
  }

  return {
    bucketMs,
    decimated: true,
    maxPoints,
    query: {
      // `last(geom, ts)` keeps a real recorded position for the bucket rather
      // than averaging two fixes into a point the vessel never occupied.
      params: [
        query.vesselId,
        query.range.start,
        query.range.end,
        `${bucketMs} milliseconds`,
        maxPoints + 1,
      ],
      text: [
        `SELECT time_bucket($4::interval, ts) AS ts,`,
        `       ST_Y(last(geom, ts)::geometry) AS latitude,`,
        `       ST_X(last(geom, ts)::geometry) AS longitude,`,
        `       avg(sog)::real     AS sog,`,
        `       last(cog, ts)      AS cog,`,
        `       last(heading, ts)  AS heading,`,
        `       avg(depth)::real   AS depth`,
        `  FROM ${TRACK_TABLE}`,
        ` WHERE vessel_id = $1::uuid`,
        `   AND ts >= $2::timestamptz`,
        `   AND ts <  $3::timestamptz`,
        ` GROUP BY 1`,
        ` ORDER BY 1 ASC`,
        ` LIMIT $5`,
      ].join('\n'),
    },
  }
}
