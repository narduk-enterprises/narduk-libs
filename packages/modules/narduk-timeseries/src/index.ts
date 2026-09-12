/**
 * `@narduk-enterprises/narduk-timeseries` -- the `TelemetryHistoryStore`
 * boundary and its TimescaleDB + PostGIS adapter.
 *
 * The root entry is the interface and its types: what a history store is, what
 * a retention policy looks like, what the rollup ladder is called. The adapter
 * and the parity reader are subpaths, so a consumer that only needs the types
 * (a route handler, a test double, a second backend) imports no SQL:
 *
 *  - `./timescale` -- the adapter, the SQL builders and the migration set;
 *  - `./influx`    -- the read-only dual-run parity adapter;
 *  - `./migrations/*` -- the `.sql` files themselves, for a deploy job.
 */

export {
  NardukTimeseriesError,
  TIMESERIES_ERROR_CODES,
  isNardukTimeseriesError,
  type TimeseriesErrorCode,
} from './errors.js'
export {
  DEFAULT_MAX_VESSELS_PER_STATEMENT,
  validateRetentionPolicy,
  type ValidatedRetentionPolicy,
} from './policy.js'
export {
  ROLLUP_BUCKETS,
  VALUE_KINDS,
  type NumericPoint,
  type ResolvedSeries,
  type RetentionPolicyInput,
  type RetentionResult,
  type RollupBucket,
  type RollupQuery,
  type RollupResult,
  type RollupRow,
  type SeriesDescriptor,
  type TelemetryHistoryStore,
  type TierRetention,
  type TimeRange,
  type TrackPoint,
  type TrackQuery,
  type TrackResult,
  type TrackRow,
  type ValueKind,
  type WriteResult,
} from './types.js'
