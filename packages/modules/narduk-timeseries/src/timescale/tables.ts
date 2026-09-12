/**
 * Every table and view name this package will ever put into a statement, as
 * constants.
 *
 * A rollup bucket arrives from a query string; it selects a TABLE NAME, which
 * has no parameterized form. The only safe construction is a lookup in a frozen
 * map that fails closed -- so `'1m'` resolves and `'1m; DROP TABLE'` throws
 * `BUCKET_UNKNOWN` before any string is concatenated.
 */

import { NardukTimeseriesError } from '../errors.js'
import { ROLLUP_BUCKETS, type RollupBucket } from '../types.js'

export const SERIES_TABLE = 'series'
export const NUMERIC_TABLE = 'telemetry_numeric'
export const TRACK_TABLE = 'track_points'

export const ROLLUP_TABLES: Readonly<Record<RollupBucket, string>> = Object.freeze({
  '1m': 'telemetry_numeric_1m',
  '15m': 'telemetry_numeric_15m',
  '1h': 'telemetry_numeric_1h',
  '1d': 'telemetry_numeric_1d',
})

export const ROLLUP_BUCKET_MS: Readonly<Record<RollupBucket, number>> = Object.freeze({
  '1m': 60_000,
  '15m': 900_000,
  '1h': 3_600_000,
  '1d': 86_400_000,
})

export function rollupTable(bucket: RollupBucket): string {
  const table = Object.prototype.hasOwnProperty.call(ROLLUP_TABLES, bucket)
    ? ROLLUP_TABLES[bucket]
    : undefined
  if (!table) {
    throw new NardukTimeseriesError(
      'BUCKET_UNKNOWN',
      `Unknown rollup bucket. Expected one of: ${ROLLUP_BUCKETS.join(', ')}.`,
      { known: [...ROLLUP_BUCKETS] },
    )
  }
  return table
}
