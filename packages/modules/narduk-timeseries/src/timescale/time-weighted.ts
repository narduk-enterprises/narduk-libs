/**
 * Time-weighted rollups (migration 0005): the bounded refresh statements and
 * the read.
 *
 * A continuous aggregate cannot hold this rollup (0005 says why: the integral
 * needs each row's next row and each bucket's carried-in value), so the
 * library refreshes `telemetry_numeric_tw` itself, in two statements per
 * window:
 *
 *  1. **1-minute rows from raw.** Rows tagged `quality = 3` (import
 *     provenance, `IMPORT_OVERLAY_QUALITY`) are left out before `lead()`, as
 *     the 1m continuous aggregate leaves them out (migration 0008), so the row
 *     before one holds across its time. `lead(ts)` gives each primary row its hold,
 *     capped at `maxHoldMs` and clipped to the window; the hold is split at
 *     minute boundaries with `generate_series`; each minute's integral, covered
 *     seconds, extremes and last value are upserted. Raw is read from
 *     `window.start - maxHold`, so a value held across the window start is
 *     carried in.
 *  2. **15m, 1h and 1d rows from the 1-minute rows**, summed over the UTC days
 *     the window touches. Exact, because each 1-minute row is the integral over
 *     exactly that minute.
 *
 * The refresh is idempotent (an upsert of values computed from raw) and its
 * cost is bounded by the window, never by retained history: a window is at
 * most one UTC day of raw for the vessel (or every vessel), plus `maxHoldMs`.
 *
 * Who runs it: `ops`. It reads raw, which `ingest_writer` cannot, and it is a
 * job like retention -- a cron's lookback, or a consumer after a backfill.
 * Nothing runs it automatically; until a consumer does, the table is empty
 * and every existing read is unchanged.
 */

import { NardukTimeseriesError } from '../errors.js'
import type {
  RollupQuery,
  TimeRange,
  TimeWeightedRefreshInput,
  TimeWeightedRollupRow,
} from '../types.js'
import { DEFAULT_MAX_ROLLUP_ROWS, assertRange, clipRollupRange, type BuiltQuery } from './query.js'
import {
  NUMERIC_TABLE,
  TIME_WEIGHTED_BUCKET_SECONDS,
  TIME_WEIGHTED_TABLE,
  rollupTable,
} from './tables.js'

/** The longest hold a refresh accepts: it bounds the minutes one row fans out to. */
export const MAX_TIME_WEIGHTED_HOLD_MS = 6 * 60 * 60 * 1000

const MINUTE_MS = 60_000
const DAY_MS = 86_400_000

export interface TimeWeightedRefreshStatement extends BuiltQuery {
  /** `minute` reads raw; `coarse` sums minutes into 15m, 1h and 1d. */
  kind: 'minute' | 'coarse'
  /** The window this statement recomputes. */
  range: TimeRange
}

export interface TimeWeightedRefreshPlan {
  /** The minute range recomputed from raw; null when it is empty after clamping. */
  range: TimeRange | null
  statements: TimeWeightedRefreshStatement[]
}

const UPSERT_TAIL = [
  `ON CONFLICT (vessel_id, series_id, bucket_seconds, bucket) DO UPDATE`,
  `   SET n = EXCLUDED.n,`,
  `       held_seconds = EXCLUDED.held_seconds,`,
  `       weighted_sum = EXCLUDED.weighted_sum,`,
  `       min_value = EXCLUDED.min_value,`,
  `       max_value = EXCLUDED.max_value,`,
  `       last_value = EXCLUDED.last_value`,
]

const COLUMNS = `(bucket_seconds, bucket, vessel_id, series_id, n, held_seconds, weighted_sum, min_value, max_value, last_value)`

/**
 * Raw -> 1-minute rows for one window. Parameters: `$1` vessel id or null,
 * `$2` window start, `$3` window end, `$4` max hold. Four, whatever the data.
 */
export const TIME_WEIGHTED_MINUTE_SQL = [
  `WITH raw AS (`,
  `  SELECT vessel_id, series_id, ts, value,`,
  `         lead(ts) OVER (PARTITION BY vessel_id, series_id ORDER BY ts) AS next_ts`,
  `    FROM ${NUMERIC_TABLE}`,
  `   WHERE installation_role = 0`,
  `     AND quality <> 3`,
  `     AND ts >= $2::timestamptz - $4::interval`,
  `     AND ts <  $3::timestamptz`,
  `     AND ($1::text IS NULL OR vessel_id = $1::uuid)`,
  `), pieces AS (`,
  `  SELECT vessel_id, series_id, ts, value,`,
  `         greatest(ts, $2::timestamptz) AS piece_start,`,
  `         least(coalesce(next_ts, 'infinity'::timestamptz), ts + $4::interval, $3::timestamptz) AS piece_end`,
  `    FROM raw`,
  `), split AS (`,
  `  SELECT p.vessel_id, p.series_id, p.ts, p.value, b.bucket,`,
  `         extract(epoch FROM least(p.piece_end, b.bucket + INTERVAL '1 minute')`,
  `                            - greatest(p.piece_start, b.bucket))::double precision AS held`,
  `    FROM pieces p`,
  `   CROSS JOIN LATERAL generate_series(`,
  `           time_bucket(INTERVAL '1 minute', p.piece_start),`,
  `           p.piece_end - INTERVAL '1 microsecond',`,
  `           INTERVAL '1 minute') AS b(bucket)`,
  `   WHERE p.piece_end > p.piece_start`,
  `)`,
  `INSERT INTO ${TIME_WEIGHTED_TABLE} ${COLUMNS}`,
  `SELECT 60, bucket, vessel_id, series_id,`,
  `       count(*) FILTER (WHERE ts >= bucket),`,
  `       sum(held), sum(value * held), min(value), max(value), last(value, ts)`,
  `  FROM split`,
  ` GROUP BY bucket, vessel_id, series_id`,
  ...UPSERT_TAIL,
].join('\n')

/**
 * 1-minute rows -> 15m, 1h and 1d rows over whole UTC days. Parameters: `$1`
 * vessel id or null, `$2` day-aligned start, `$3` day-aligned end.
 */
export const TIME_WEIGHTED_COARSE_SQL = [
  `INSERT INTO ${TIME_WEIGHTED_TABLE} ${COLUMNS}`,
  `SELECT level.seconds, time_bucket(level.width, t.bucket), t.vessel_id, t.series_id,`,
  `       sum(t.n), sum(t.held_seconds), sum(t.weighted_sum),`,
  `       min(t.min_value), max(t.max_value), last(t.last_value, t.bucket)`,
  `  FROM ${TIME_WEIGHTED_TABLE} t`,
  ` CROSS JOIN (VALUES (900, INTERVAL '15 minutes'), (3600, INTERVAL '1 hour'), (86400, INTERVAL '1 day'))`,
  `       AS level(seconds, width)`,
  ` WHERE t.bucket_seconds = 60`,
  `   AND t.bucket >= $2::timestamptz`,
  `   AND t.bucket <  $3::timestamptz`,
  `   AND ($1::text IS NULL OR t.vessel_id = $1::uuid)`,
  ` GROUP BY 1, 2, 3, 4`,
  ...UPSERT_TAIL,
].join('\n')

function alignDown(ms: number, unit: number): number {
  return Math.floor(ms / unit) * unit
}

function alignUp(ms: number, unit: number): number {
  return Math.ceil(ms / unit) * unit
}

/**
 * The refresh plan for a range whose raw changed.
 *
 * The range is widened before it is split, by `maxHoldMs` both ways, to the
 * minute. Forward, because a late row shortens the hold of the row before it
 * and changes what every following minute carries in, up to one hold later.
 * Back, because the end is clamped to the current minute, so no bucket is
 * written for time that has not happened (the last value would otherwise
 * "hold" into the future), and the minutes an earlier refresh left unfinished
 * -- held by a row that was then the latest -- end at most one hold after it:
 * any later refresh within `maxHoldMs` of the last one settles them. Windows
 * never cross a UTC day, and each minute window is followed by the coarse
 * statement for its day, so the coarse levels always sum finished minutes.
 */
export function planTimeWeightedRefresh(
  input: TimeWeightedRefreshInput,
  realNowMs: number = Date.now(),
): TimeWeightedRefreshPlan {
  assertRange(input.range)
  const { maxHoldMs } = input
  if (
    typeof maxHoldMs !== 'number' ||
    !Number.isInteger(maxHoldMs) ||
    maxHoldMs < 1000 ||
    maxHoldMs > MAX_TIME_WEIGHTED_HOLD_MS
  ) {
    throw new NardukTimeseriesError(
      'RANGE_INVALID',
      `maxHoldMs must be a whole number of milliseconds between 1000 and ${MAX_TIME_WEIGHTED_HOLD_MS}.`,
      { maxHoldMs },
    )
  }
  if (
    input.vesselId !== undefined &&
    (typeof input.vesselId !== 'string' || input.vesselId.length === 0)
  ) {
    throw new NardukTimeseriesError(
      'RANGE_INVALID',
      'vesselId, when given, must be a non-empty string.',
    )
  }
  const vessel = input.vesselId ?? null

  const start = alignDown(input.range.start.getTime() - maxHoldMs, MINUTE_MS)
  const end = Math.min(
    alignUp(input.range.end.getTime() + maxHoldMs, MINUTE_MS),
    alignDown(realNowMs, MINUTE_MS),
  )
  if (!(end > start)) return { range: null, statements: [] }

  const statements: TimeWeightedRefreshStatement[] = []
  const hold = `${maxHoldMs} milliseconds`
  for (let cursor = start; cursor < end;) {
    const dayStart = alignDown(cursor, DAY_MS)
    const windowEnd = Math.min(end, dayStart + DAY_MS)
    const window = { end: new Date(windowEnd), start: new Date(cursor) }
    statements.push({
      kind: 'minute',
      params: [vessel, window.start, window.end, hold],
      range: window,
      text: TIME_WEIGHTED_MINUTE_SQL,
    })
    const day = { end: new Date(dayStart + DAY_MS), start: new Date(dayStart) }
    statements.push({
      kind: 'coarse',
      params: [vessel, day.start, day.end],
      range: day,
      text: TIME_WEIGHTED_COARSE_SQL,
    })
    cursor = windowEnd
  }
  return { range: { end: new Date(end), start: new Date(start) }, statements }
}

export interface TimeWeightedRollupBuiltQuery extends BuiltQuery {
  clipped: boolean
  range: TimeRange
}

/**
 * The time-weighted read: the same series set, range, tier clip and row
 * ceiling as `buildRollupQuery`, from `telemetry_numeric_tw` at one level.
 */
export function buildTimeWeightedRollupQuery(
  query: RollupQuery,
  limits?: { maxRowsCeiling?: number },
): TimeWeightedRollupBuiltQuery {
  // rollupTable is the gate on the bucket name; the level then selects a
  // bound parameter, never a string in the statement.
  rollupTable(query.bucket)
  const plan = clipRollupRange(query)
  if (plan.empty) {
    throw new NardukTimeseriesError(
      'RANGE_INVALID',
      'The whole requested range is older than the tier window, so there is no statement to build. Callers going through the store get an empty, clipped result instead.',
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
  const ceiling = limits?.maxRowsCeiling ?? DEFAULT_MAX_ROLLUP_ROWS
  const maxRows = query.maxRows ?? Math.min(DEFAULT_MAX_ROLLUP_ROWS, ceiling)
  if (!Number.isInteger(maxRows) || maxRows <= 0 || maxRows > ceiling) {
    throw new NardukTimeseriesError(
      'RANGE_INVALID',
      `maxRows must be a positive integer of at most ${ceiling}.`,
      { ceiling, maxRows },
    )
  }
  return {
    clipped: plan.clipped,
    params: [
      query.vesselId,
      query.seriesIds.join(','),
      TIME_WEIGHTED_BUCKET_SECONDS[query.bucket],
      plan.range.start,
      plan.range.end,
      maxRows + 1,
    ],
    range: plan.range,
    text: [
      `SELECT bucket,`,
      `       series_id,`,
      `       n,`,
      `       held_seconds,`,
      `       CASE WHEN held_seconds > 0 THEN weighted_sum / held_seconds ELSE 0 END AS avg,`,
      `       min_value AS min,`,
      `       max_value AS max,`,
      `       last_value AS last`,
      `  FROM ${TIME_WEIGHTED_TABLE}`,
      ` WHERE vessel_id = $1::uuid`,
      `   AND series_id = ANY(string_to_array($2::text, ',')::bigint[])`,
      `   AND bucket_seconds = $3::integer`,
      `   AND bucket >= $4::timestamptz`,
      `   AND bucket <  $5::timestamptz`,
      ` ORDER BY bucket ASC, series_id ASC`,
      ` LIMIT $6`,
    ].join('\n'),
  }
}

export interface TimeWeightedSqlRow {
  avg: number | string
  bucket: Date | string
  held_seconds: number | string
  last: number | string | null
  max: number | string | null
  min: number | string | null
  n: number | string
  series_id: number | string
}

export function toTimeWeightedRow(row: TimeWeightedSqlRow): TimeWeightedRollupRow {
  const optional = (value: number | string | null): number | null =>
    value === null ? null : Number(value)
  return {
    avg: Number(row.avg),
    bucket: row.bucket instanceof Date ? row.bucket : new Date(row.bucket),
    heldMs: Math.round(Number(row.held_seconds) * 1000),
    last: optional(row.last),
    max: optional(row.max),
    min: optional(row.min),
    n: Number(row.n),
    seriesId: Number(row.series_id),
  }
}
