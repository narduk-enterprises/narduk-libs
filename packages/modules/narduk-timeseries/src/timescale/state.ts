/**
 * `telemetry_state`: the change-only history of non-number values
 * (migration 0004, mybo-at-v2 docs/19 § 5.1).
 *
 * The write path is the numeric one's shape: one series resolve per batch,
 * multi-row INSERTs sized by the parameter budget, `ON CONFLICT DO NOTHING`
 * against the natural key so a redelivered batch inserts nothing.
 *
 * The encoding is fixed here and nowhere else:
 *
 *  - a string goes to `value_text`, series kind `text`;
 *  - a bool goes to `value_text` as `'true'` or `'false'`, series kind `bool`;
 *  - anything else JSON can carry -- an object, an array, JSON null -- goes
 *    to `value_json`, series kind `json`.
 *
 * A number is refused. It is a numeric reading, and a state row for it would
 * be invisible to every rollup and every chart that reads `telemetry_numeric`.
 *
 * The reads decode by the series' kind, so a bool series reads back as a
 * boolean and a JSON series as the parsed value. Both reads are bounded: the
 * series set is one text parameter, "state at t" stops at one row per series,
 * and "transitions" takes a row ceiling and reports truncation.
 */

import { chunkRowsByParameterBudget } from '@narduk-enterprises/narduk-postgres'

import { clampQueryNowMs } from '../clock.js'
import { NardukTimeseriesError } from '../errors.js'
import type {
  StateAtQuery,
  StatePoint,
  StateRow,
  StateTransitionsQuery,
  StateValue,
  StateValueKind,
  TimeRange,
} from '../types.js'
import { assertRange, type BuiltQuery } from './query.js'
import { SERIES_TABLE, STATE_TABLE } from './tables.js'
import type { WriteStatement } from './write.js'

export const STATE_PARAMETERS_PER_ROW = 6
export const DEFAULT_MAX_STATE_ROWS = 10_000

export interface EncodedStateValue {
  json: string | null
  kind: StateValueKind
  text: string | null
}

export interface ResolvedStatePoint extends StatePoint {
  seriesId: number
}

/**
 * The one place a state value becomes columns. Throws `WRITE_BATCH_INVALID`
 * for a number, `undefined`, a function, a symbol, a bigint, or an object JSON
 * cannot serialize (a cycle).
 */
export function encodeStateValue(value: StateValue, index = 0): EncodedStateValue {
  if (typeof value === 'string') return { json: null, kind: 'text', text: value }
  if (typeof value === 'boolean')
    return { json: null, kind: 'bool', text: value ? 'true' : 'false' }
  if (typeof value === 'number') {
    throw new NardukTimeseriesError(
      'WRITE_BATCH_INVALID',
      `Point ${index} is a number. Numbers are numeric readings: write them with writeNumeric.`,
      { index },
    )
  }
  if (value === null || typeof value === 'object') {
    let json: string | undefined
    try {
      json = JSON.stringify(value)
    } catch (error) {
      throw new NardukTimeseriesError(
        'WRITE_BATCH_INVALID',
        `Point ${index} has a value JSON cannot serialize.`,
        { index },
        { cause: error },
      )
    }
    if (typeof json === 'string') return { json, kind: 'json', text: null }
  }
  throw new NardukTimeseriesError(
    'WRITE_BATCH_INVALID',
    `Point ${index} has no storable state value. A state is a string, a boolean or a JSON value.`,
    { index, type: typeof value },
  )
}

/**
 * The inverse of {@link encodeStateValue}. The column decides first: a set
 * `value_json` is parsed, a set `value_text` is a string -- and a `bool`
 * series turns `'true'`/`'false'` back into a boolean. A series keeps the kind
 * it was created with, so a path that once sent a bool and later a string
 * reads its string back as a string rather than as `false`.
 */
export function decodeStateValue(
  kind: string,
  text: string | null,
  json: string | null,
): StateValue {
  if (json !== null) return JSON.parse(json) as StateValue
  if (kind === 'bool' && (text === 'true' || text === 'false')) return text === 'true'
  return text
}

function assertTimestamp(ts: unknown, index: number): Date {
  if (!(ts instanceof Date) || Number.isNaN(ts.getTime())) {
    throw new NardukTimeseriesError(
      'WRITE_BATCH_INVALID',
      `Point ${index} has no valid timestamp. A point's ts must be a Date.`,
      { index },
    )
  }
  return ts
}

/**
 * Multi-row INSERTs for a resolved state batch. `value_json` is bound as TEXT
 * and cast in SQL, never bound as jsonb: postgres.js JSON-encodes a value
 * bound to a json parameter, so an already-serialized object would arrive as
 * a JSON string (the same trap `buildSeriesListQuery` documents).
 */
export function buildStateWriteStatements(
  batch: readonly ResolvedStatePoint[],
  budget?: number,
): WriteStatement[] {
  if (batch.length === 0) return []
  const chunks = chunkRowsByParameterBudget(batch, STATE_PARAMETERS_PER_ROW, budget)
  const statements: WriteStatement[] = []
  let base = 0
  for (const chunk of chunks) {
    const params: unknown[] = []
    const tuples: string[] = []
    for (const [offset, point] of chunk.entries()) {
      const index = base + offset
      const encoded = encodeStateValue(point.value, index)
      const p = offset * STATE_PARAMETERS_PER_ROW + 1
      tuples.push(
        `($${p}::timestamptz, $${p + 1}::uuid, $${p + 2}::bigint, $${p + 3}::smallint, $${p + 4}::text, $${p + 5}::text::jsonb)`,
      )
      params.push(
        assertTimestamp(point.ts, index),
        point.vesselId,
        point.seriesId,
        point.installationRole ?? 0,
        encoded.text,
        encoded.json,
      )
    }
    statements.push({
      params,
      rows: chunk.length,
      text:
        `INSERT INTO ${STATE_TABLE} (ts, vessel_id, series_id, installation_role, value_text, value_json)\n` +
        `VALUES ${tuples.join(', ')}\n` +
        `ON CONFLICT DO NOTHING`,
    })
    base += chunk.length
  }
  return statements
}

function assertSeriesIds(seriesIds: readonly number[]): string {
  if (!Array.isArray(seriesIds) || seriesIds.length === 0) {
    throw new NardukTimeseriesError(
      'SERIES_UNRESOLVED',
      'A state query needs at least one resolved series id.',
    )
  }
  for (const seriesId of seriesIds) {
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
  return [...new Set(seriesIds)].join(',')
}

function assertRole(role: number | undefined): number {
  const resolved = role ?? 0
  if (!Number.isInteger(resolved) || resolved < 0 || resolved > 32_767) {
    throw new NardukTimeseriesError('RANGE_INVALID', 'installationRole must be a small integer.', {
      installationRole: role,
    })
  }
  return resolved
}

/** The tier floor in ms, or null for `'unrestricted'`. Same rule as `clipRollupRange`. */
export function stateTierFloorMs(query: {
  now?: Date
  tierWindowMs: number | 'unrestricted'
}): number | null {
  const { tierWindowMs } = query
  if (tierWindowMs === 'unrestricted') return null
  if (typeof tierWindowMs !== 'number' || !Number.isFinite(tierWindowMs) || tierWindowMs <= 0) {
    throw new NardukTimeseriesError(
      'RANGE_INVALID',
      "tierWindowMs must be a positive, finite number of milliseconds, or the literal 'unrestricted'.",
      { tierWindowMs },
    )
  }
  return clampQueryNowMs(query.now) - tierWindowMs
}

export interface StateAtPlan {
  clipped: boolean
  /** True when `at` is older than the tier floor: no statement to run. */
  empty: boolean
  query: BuiltQuery | null
}

const STATE_COLUMNS = [
  `       st.ts,`,
  `       st.series_id,`,
  `       st.installation_role,`,
  `       st.value_text,`,
  `       st.value_json::text AS value_json,`,
  `       s.value_kind`,
]

/**
 * "The state at t": one backward index probe per series, each stopping at its
 * first row. The lookup never reaches below the tier floor, so a tier cannot
 * learn a value it is not entitled to by asking for "the state now".
 */
export function planStateAtQuery(query: StateAtQuery): StateAtPlan {
  const at = query.at
  if (!(at instanceof Date) || Number.isNaN(at.getTime())) {
    throw new NardukTimeseriesError('RANGE_INVALID', 'at must be a Date.')
  }
  const ids = assertSeriesIds(query.seriesIds)
  const role = assertRole(query.installationRole)
  const floorMs = stateTierFloorMs(query)
  if (floorMs !== null && at.getTime() < floorMs) {
    return { clipped: true, empty: true, query: null }
  }
  const floor = floorMs === null ? null : new Date(floorMs)
  return {
    clipped: floor !== null,
    empty: false,
    query: {
      params: [query.vesselId, ids, at, floor, role],
      text: [
        `SELECT`,
        ...STATE_COLUMNS,
        `  FROM unnest(string_to_array($2::text, ',')::bigint[]) AS wanted(series_id)`,
        ` CROSS JOIN LATERAL (`,
        `   SELECT ts, series_id, installation_role, value_text, value_json`,
        `     FROM ${STATE_TABLE}`,
        `    WHERE vessel_id = $1::uuid`,
        `      AND series_id = wanted.series_id`,
        `      AND installation_role = $5::smallint`,
        `      AND ts <= $3::timestamptz`,
        `      AND ($4::timestamptz IS NULL OR ts >= $4::timestamptz)`,
        `    ORDER BY ts DESC`,
        `    LIMIT 1`,
        ` ) AS st`,
        ` JOIN ${SERIES_TABLE} s ON s.series_id = st.series_id`,
        ` ORDER BY st.series_id ASC`,
      ].join('\n'),
    },
  }
}

export interface StateTransitionsPlan {
  clipped: boolean
  empty: boolean
  maxRows: number
  query: BuiltQuery | null
  range: TimeRange
}

export function planStateTransitionsQuery(
  query: StateTransitionsQuery,
  limits?: { maxRowsCeiling?: number },
): StateTransitionsPlan {
  assertRange(query.range)
  const ids = assertSeriesIds(query.seriesIds)
  const role = assertRole(query.installationRole)
  const ceiling = limits?.maxRowsCeiling ?? DEFAULT_MAX_STATE_ROWS
  if (!Number.isInteger(ceiling) || ceiling <= 0) {
    throw new NardukTimeseriesError('RANGE_INVALID', 'maxRowsCeiling must be a positive integer.', {
      ceiling,
    })
  }
  const maxRows = query.maxRows ?? Math.min(DEFAULT_MAX_STATE_ROWS, ceiling)
  if (!Number.isInteger(maxRows) || maxRows <= 0 || maxRows > ceiling) {
    throw new NardukTimeseriesError(
      'RANGE_INVALID',
      `maxRows must be a positive integer of at most ${ceiling}.`,
      { ceiling, maxRows },
    )
  }

  const floorMs = stateTierFloorMs(query)
  let range = query.range
  let clipped = false
  if (floorMs !== null) {
    if (range.end.getTime() <= floorMs) {
      const floor = new Date(floorMs)
      return {
        clipped: true,
        empty: true,
        maxRows,
        query: null,
        range: { end: floor, start: floor },
      }
    }
    if (range.start.getTime() < floorMs) {
      range = { end: range.end, start: new Date(floorMs) }
      clipped = true
    }
  }

  return {
    clipped,
    empty: false,
    maxRows,
    query: {
      // maxRows + 1 so a full page is distinguishable from an exact fit.
      params: [query.vesselId, ids, range.start, range.end, role, maxRows + 1],
      text: [
        `SELECT`,
        ...STATE_COLUMNS,
        `  FROM ${STATE_TABLE} st`,
        `  JOIN ${SERIES_TABLE} s ON s.series_id = st.series_id`,
        ` WHERE st.vessel_id = $1::uuid`,
        `   AND st.series_id = ANY(string_to_array($2::text, ',')::bigint[])`,
        `   AND st.ts >= $3::timestamptz`,
        `   AND st.ts <  $4::timestamptz`,
        `   AND st.installation_role = $5::smallint`,
        ` ORDER BY st.ts ASC, st.series_id ASC`,
        ` LIMIT $6`,
      ].join('\n'),
    },
    range,
  }
}

export interface StateSqlRow {
  installation_role: number | string
  series_id: number | string
  ts: Date | string
  value_json: string | null
  value_kind: string
  value_text: string | null
}

export function toStateRow(row: StateSqlRow): StateRow {
  const value = decodeStateValue(row.value_kind, row.value_text, row.value_json)
  // The row's own encoding, not the series': see decodeStateValue.
  const valueKind: StateValueKind =
    row.value_json !== null ? 'json' : typeof value === 'boolean' ? 'bool' : 'text'
  return {
    installationRole: Number(row.installation_role),
    seriesId: Number(row.series_id),
    ts: row.ts instanceof Date ? row.ts : new Date(row.ts),
    value,
    valueKind,
  }
}
