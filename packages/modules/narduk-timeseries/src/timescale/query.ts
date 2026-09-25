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

import { clampQueryNowMs } from '../clock.js'
import { NardukTimeseriesError } from '../errors.js'
import { ROLLUP_BUCKETS } from '../types.js'
import type { RollupBucket, RollupQuery, SeriesListQuery, TimeRange, TrackQuery } from '../types.js'
import { ROLLUP_BUCKET_MS, SERIES_TABLE, TRACK_TABLE, rollupTable } from './tables.js'

export const DEFAULT_MAX_ROLLUP_ROWS = 50_000
export const DEFAULT_MAX_TRACK_POINTS = 5000
export const DEFAULT_MAX_SERIES_ROWS = 5000
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
 * Client-supplied `maxRows` / `maxPoints` may not exceed the published default
 * unless a server-side ceiling raises it. `1e12` is a valid integer; it is
 * still refused.
 */
function assertWorkingSetSize(
  label: string,
  value: number | undefined,
  defaultSize: number,
  ceiling: number,
): number {
  const resolvedCeiling = assertPositiveInteger(`${label}Ceiling`, ceiling)
  const resolved = assertPositiveInteger(label, value ?? Math.min(defaultSize, resolvedCeiling))
  if (resolved > resolvedCeiling) {
    throw new NardukTimeseriesError(
      'RANGE_INVALID',
      `${label} must be at most ${resolvedCeiling}.`,
      { ceiling: resolvedCeiling, label, value: resolved },
    )
  }
  return resolved
}

export interface RollupQueryLimits {
  maxRowsCeiling?: number
}

export interface TrackQueryLimits {
  maxPointsCeiling?: number
}

export interface SeriesListQueryLimits {
  maxRowsCeiling?: number
}

export interface RollupRangePlan {
  /** True when the tier window moved `range.start` forward. */
  clipped: boolean
  /** True when the whole requested range is older than the tier window. */
  empty: boolean
  range: TimeRange
}

/**
 * Clip a requested range to the tier's history depth.
 *
 * Rollups are retained globally at the most generous tier's depth, so a
 * narrower tier is a READ boundary, not a delete: without this clip a Free
 * vessel could read a Cruiser's worth of history simply by asking for it. The
 * clip is reported rather than silent -- a consumer that asked for a year and
 * received a month needs to be able to say so in its response.
 *
 * `tierWindowMs` is required. A caller with no tier boundary passes
 * `'unrestricted'` and says so out loud; there is no shape of this call that
 * silently skips the only tier gate the read path has.
 *
 * The floor clock is `max(real now, query.now)`. A client-supplied past `now`
 * cannot slide this gate backward; a future `now` may only raise the floor.
 */
export function clipRollupRange(query: RollupQuery): RollupRangePlan {
  assertRange(query.range)
  const { tierWindowMs } = query
  if (tierWindowMs === 'unrestricted') {
    return { clipped: false, empty: false, range: query.range }
  }
  if (typeof tierWindowMs !== 'number' || !Number.isFinite(tierWindowMs) || tierWindowMs <= 0) {
    throw new NardukTimeseriesError(
      'RANGE_INVALID',
      "tierWindowMs must be a positive, finite number of milliseconds, or the literal 'unrestricted'.",
      { tierWindowMs },
    )
  }

  const floorMs = clampQueryNowMs(query.now) - tierWindowMs
  if (query.range.end.getTime() <= floorMs) {
    // Zero-width at the floor: the honest answer to "what range did you read"
    // when the tier window starts after the request ended is "none".
    return {
      clipped: true,
      empty: true,
      range: { end: new Date(floorMs), start: new Date(floorMs) },
    }
  }
  if (query.range.start.getTime() >= floorMs) {
    return { clipped: false, empty: false, range: query.range }
  }
  return {
    clipped: true,
    empty: false,
    range: { end: query.range.end, start: new Date(floorMs) },
  }
}

export interface RollupBuiltQuery extends BuiltQuery {
  clipped: boolean
  /** The range the statement actually reads, after tier clipping. */
  range: TimeRange
}

/**
 * `avg` is computed here, from `sum_value / n`, rather than read from a stored
 * `avg` column. Migration 0002 explains why: chaining an average of averages is
 * only correct when every bucket has the same number of points, which a
 * telemetry store cannot promise. The division is guarded so a bucket that
 * somehow recorded zero rows returns 0 instead of NaN.
 */
export function buildRollupQuery(
  query: RollupQuery,
  plan?: RollupRangePlan,
  limits?: RollupQueryLimits,
): RollupBuiltQuery {
  const table = rollupTable(query.bucket)
  // The caller may have clipped already -- the store does, to decide whether
  // there is a statement to run at all. Clipping twice means two `new Date()`
  // calls a few microseconds apart and therefore two different floors, so the
  // range the store reports is not quite the range the statement read.
  const resolvedPlan = plan ?? clipRollupRange(query)
  if (resolvedPlan.empty) {
    throw new NardukTimeseriesError(
      'RANGE_INVALID',
      'The whole requested range is older than the tier window, so there is no statement to build. Callers going through the store get an empty, clipped result instead.',
      {
        end: query.range.end.toISOString(),
        start: query.range.start.toISOString(),
        tierWindowMs: query.tierWindowMs,
      },
    )
  }

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

  const maxRows = assertWorkingSetSize(
    'maxRows',
    query.maxRows,
    DEFAULT_MAX_ROLLUP_ROWS,
    limits?.maxRowsCeiling ?? DEFAULT_MAX_ROLLUP_ROWS,
  )

  return {
    clipped: resolvedPlan.clipped,
    // The limit is maxRows + 1 so a full page is distinguishable from an exact
    // fit: the adapter reports `truncated` on the extra row and drops it.
    params: [
      query.vesselId,
      // One comma-joined text parameter, never a bare array: an unprepared
      // (Hyperdrive, prepare: false) connection sends a JS array as untyped
      // text and Postgres answers 22P02 (narduk-libs#311, #304).
      query.seriesIds.join(','),
      resolvedPlan.range.start,
      resolvedPlan.range.end,
      maxRows + 1,
    ],
    range: resolvedPlan.range,
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
      `   AND series_id = ANY(string_to_array($2::text, ',')::bigint[])`,
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

/**
 * The widest range one `refresh_continuous_aggregate` call may cover, per level.
 *
 * A refresh is not a query: it materializes every bucket in the range, holds
 * its work in memory per invalidation batch, and gives the caller nothing back
 * until it finishes. A year-wide refresh of the 1m level is 525 600 buckets per
 * series in one statement -- exactly the shape that OOM-killed the Influx
 * replica during parity work. These ceilings are per level because the bucket
 * count, not the wall-clock width, is what costs: a month of 1d buckets is 30
 * rows per series and a month of 1m buckets is 43 200.
 */
export const REFRESH_MAX_WINDOW_MS: Readonly<Record<RollupBucket, number>> = Object.freeze({
  '15m': 30 * 24 * 60 * 60 * 1000,
  '1d': 365 * 24 * 60 * 60 * 1000,
  '1h': 90 * 24 * 60 * 60 * 1000,
  '1m': 7 * 24 * 60 * 60 * 1000,
})

export interface RefreshRollupStatement extends BuiltQuery {
  bucket: RollupBucket
  /** The window this single CALL refreshes. */
  range: TimeRange
}

export interface RefreshRollupsInput {
  /** Levels to refresh. Defaults to the whole ladder; always emitted fine-first. */
  buckets?: readonly RollupBucket[]
  /**
   * A narrower per-call window than `REFRESH_MAX_WINDOW_MS`. Wider is refused:
   * the ceiling is the point.
   */
  maxWindowMs?: number
  range: TimeRange
}

/**
 * The explicit refresh for a backfilled range, split into bounded windows and
 * ordered so the ladder is materialized bottom-up.
 *
 * The scheduled policies in migration 0002 reconsider the last 7 days, which
 * is the whole global raw window -- so anything raw still holds can still be
 * materialized by the scheduler. A store-and-forward consumer that
 * deliberately accepts a batch OLDER than that has to say so, because no
 * policy will ever look at those buckets again: it calls this for the range it
 * just wrote and runs the statements in the order returned.
 *
 * **Order is load-bearing.** The ladder is hierarchical -- 15m reads 1m, 1h
 * reads 15m, 1d reads 1h -- so every window of a level runs before any window
 * of the next level up, coarsest last. Refresh 1d first and it summarizes 1h
 * buckets that do not exist yet, and nothing reports the hole.
 *
 * **Each statement is bounded.** `assertRange` only proves end > start, which
 * let a single call cover an arbitrarily wide range; the range is now split at
 * `REFRESH_MAX_WINDOW_MS[level]` (or a narrower `maxWindowMs`) exactly as
 * `splitRangeIntoWindows` bounds an Influx read, so a ten-year backfill is a
 * long list of bounded statements rather than one statement that never returns.
 *
 * **Each window is bucket-aligned.** A ten-minute store-and-forward batch is
 * narrower than a 15m, 1h or 1d bucket. TimescaleDB has historically refused
 * a refresh window that does not cover a bucket ("refresh window too small").
 * The requested range is snapped outward onto `ROLLUP_BUCKET_MS[level]` first,
 * then walked in whole-bucket steps no wider than `maxWindowMs` so neighbours
 * abut, every overlapping bucket is covered, and no CALL exceeds the level
 * ceiling. A leftover narrower than one bucket is folded into the previous
 * window (narduk-libs#293).
 *
 * `refresh_continuous_aggregate` is a procedure, so each is a `CALL`, and it
 * cannot run inside a transaction block -- run them one at a time, not inside
 * `executor.transaction()`.
 */
export function refreshRollupsStatements(input: RefreshRollupsInput): RefreshRollupStatement[] {
  assertRange(input.range)
  const buckets = input.buckets ?? ROLLUP_BUCKETS
  // rollupTable is the single gate on a bucket name; calling it here means an
  // unknown level fails before any statement is built rather than half way
  // through the list.
  for (const bucket of buckets) rollupTable(bucket)
  // maxWindowMs used to be checked inside the per-bucket loop, so
  // `buckets: []` returned [] without ever seeing a non-positive value.
  if (
    input.maxWindowMs !== undefined &&
    (!Number.isFinite(input.maxWindowMs) || input.maxWindowMs <= 0)
  ) {
    throw new NardukTimeseriesError(
      'RANGE_INVALID',
      'maxWindowMs must be a positive number of milliseconds.',
      { maxWindowMs: input.maxWindowMs },
    )
  }
  if (buckets.length === 0) {
    throw new NardukTimeseriesError(
      'RANGE_INVALID',
      'buckets must name at least one rollup level.',
      { buckets },
    )
  }

  const statements: RefreshRollupStatement[] = []
  // ROLLUP_BUCKETS is the ladder in order, so filtering it rather than
  // iterating the caller's array is what makes "coarsest last" true no matter
  // what order the caller asked in.
  for (const bucket of ROLLUP_BUCKETS.filter((level) => buckets.includes(level))) {
    const ceiling = REFRESH_MAX_WINDOW_MS[bucket]
    const requested = input.maxWindowMs ?? ceiling
    if (requested > ceiling) {
      throw new NardukTimeseriesError(
        'REFRESH_WINDOW_TOO_WIDE',
        `A ${bucket} refresh window wider than ${ceiling} ms materializes too many buckets in one statement. Narrow it.`,
        { bucket, ceiling, maxWindowMs: requested },
      )
    }

    const view = rollupTable(bucket)
    for (const window of splitRefreshWindows(input.range, ROLLUP_BUCKET_MS[bucket], requested)) {
      statements.push({
        bucket,
        params: [window.start, window.end],
        range: window,
        text: `CALL refresh_continuous_aggregate('${view}', $1::timestamptz, $2::timestamptz)`,
      })
    }
  }
  return statements
}

function alignDown(ms: number, bucketMs: number): number {
  return Math.floor(ms / bucketMs) * bucketMs
}

function alignUp(ms: number, bucketMs: number): number {
  return Math.ceil(ms / bucketMs) * bucketMs
}

/**
 * Snap `range` outward onto `bucketMs`, then walk whole-bucket steps no
 * wider than `maxWindowMs`. A raw step that is not a multiple of the bucket
 * would hand Timescale windows whose inscribed complete-bucket range skips
 * a bucket between neighbours (narduk-libs#293 / PR 550).
 *
 * A leftover narrower than one bucket is folded into the previous window so
 * the last CALL is never a sliver Timescale can refuse.
 */
function splitRefreshWindows(range: TimeRange, bucketMs: number, maxWindowMs: number): TimeRange[] {
  const rangeStart = alignDown(range.start.getTime(), bucketMs)
  const rangeEnd = alignUp(range.end.getTime(), bucketMs)
  const stepMs = Math.max(bucketMs, Math.floor(maxWindowMs / bucketMs) * bucketMs)
  const raw: Array<{ end: number; start: number }> = []
  for (let cursor = rangeStart; cursor < rangeEnd; cursor += stepMs) {
    raw.push({ end: Math.min(cursor + stepMs, rangeEnd), start: cursor })
  }
  if (raw.length >= 2) {
    const last = raw[raw.length - 1]!
    if (last.end - last.start < bucketMs) {
      raw[raw.length - 2]!.end = last.end
      raw.pop()
    }
  }
  return raw.map((window) => ({
    end: new Date(window.end),
    start: new Date(window.start),
  }))
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
 * be finer than the data. Decimated buckets start at `range.start`, so a fully
 * covered range yields at most `maxPoints` of them and `truncated` is never
 * set by bucket alignment alone. A caller asking for 5000 points over a year gets
 * about 5000 rows; the same caller over ten minutes gets every point.
 */
export function planTrackQuery(query: TrackQuery, limits?: TrackQueryLimits): TrackPlan {
  assertRange(query.range)
  const maxPoints = assertWorkingSetSize(
    'maxPoints',
    query.maxPoints,
    DEFAULT_MAX_TRACK_POINTS,
    limits?.maxPointsCeiling ?? DEFAULT_MAX_TRACK_POINTS,
  )
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
      // The buckets are anchored on `range.start` ($2): Timescale's default
      // origin is 2000-01-03, and a range off that grid touches
      // `maxPoints + 1` buckets (a partial one at each end). The extra row
      // then read as truncation and the slice dropped the newest bucket, the
      // vessel's latest position (narduk-libs#939). From `range.start`,
      // `ceil(rangeMs / bucketMs) <= maxPoints` buckets cover the range.
      params: [
        query.vesselId,
        query.range.start,
        query.range.end,
        `${bucketMs} milliseconds`,
        maxPoints + 1,
      ],
      text: [
        `SELECT time_bucket($4::interval, ts, $2::timestamptz) AS ts,`,
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

/**
 * The series catalogue read: a vessel's series, or the named subset of them.
 *
 * Three parameters whatever the path count. The path filter goes in as one
 * JSON text parameter expanded server-side, never as a bare array (an
 * unprepared Hyperdrive connection sends a JS array as untyped text and
 * Postgres answers 22P02, narduk-libs#311) and never as a comma-joined string
 * (a SignalK path may legally contain a comma, and splitting one path into two
 * would widen the read). `$2` is null when the caller asked for every series,
 * so the statement text is the same either way.
 *
 * It is a SELECT and only a SELECT: `history_reader` can run it, and asking
 * about a path the vessel never recorded creates nothing. `resolveSeries` is
 * the write path's lookup and upserts.
 */
export function buildSeriesListQuery(
  query: SeriesListQuery,
  limits?: SeriesListQueryLimits,
): BuiltQuery {
  if (typeof query.vesselId !== 'string' || query.vesselId.length === 0) {
    throw new NardukTimeseriesError('SERIES_DESCRIPTOR_INVALID', 'A series list needs a vesselId.')
  }
  const maxRows = assertWorkingSetSize(
    'maxRows',
    query.maxRows,
    DEFAULT_MAX_SERIES_ROWS,
    limits?.maxRowsCeiling ?? DEFAULT_MAX_SERIES_ROWS,
  )
  let paths: string | null = null
  if (query.paths !== undefined) {
    if (!Array.isArray(query.paths) || query.paths.length === 0) {
      throw new NardukTimeseriesError(
        'SERIES_DESCRIPTOR_INVALID',
        'A series list path filter must name at least one path; omit `paths` to list every series.',
        { vesselId: query.vesselId },
      )
    }
    for (const path of query.paths) {
      if (typeof path !== 'string' || path.length === 0) {
        throw new NardukTimeseriesError(
          'SERIES_DESCRIPTOR_INVALID',
          'Every path in a series list filter must be a non-empty string.',
          { vesselId: query.vesselId },
        )
      }
    }
    paths = JSON.stringify([...new Set(query.paths)])
  }

  return {
    // maxRows + 1 so a full page is distinguishable from an exact fit.
    params: [query.vesselId, paths, maxRows + 1],
    text: [
      `SELECT series_id, vessel_id, path, unit, value_kind`,
      `  FROM ${SERIES_TABLE}`,
      ` WHERE vessel_id = $1::uuid`,
      // `$2` is bound as TEXT and cast to jsonb in SQL, never bound as jsonb. postgres.js -- the
      // Worker driver behind Hyperdrive -- asks the server for each parameter's type and
      // JSON-encodes any value bound to a json/jsonb parameter, so the already-serialized
      // filter arrived as a JSON *string* and failed with "cannot extract elements from a
      // scalar". node-postgres sends strings as-is, which is why the live suite never saw it.
      `   AND ($2::text IS NULL OR path IN (SELECT jsonb_array_elements_text($2::text::jsonb)))`,
      ` ORDER BY path ASC`,
      ` LIMIT $3`,
    ].join('\n'),
  }
}
