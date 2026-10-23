/**
 * The `TelemetryHistoryStore` boundary.
 *
 * ADR-0004 is explicit that route handlers never query Postgres directly: the
 * history store is reached through this interface and nothing else. That is
 * what makes the store swappable (the Influx adapter in `./influx` reads the
 * same shapes for dual-run parity) and what keeps the SQL in one place where
 * its parameter counts can be bounded and asserted.
 *
 * Every method is batch- or range-shaped on purpose. There is no
 * `writeOnePoint` and no `getSeriesFor(point)`, because a per-item method is an
 * invitation to call it in a loop -- which is the awaited-call-per-item shape
 * the estate's data-path contract exists to forbid.
 */

export type ValueKind = 'numeric' | 'position' | 'attitude' | 'text' | 'bool' | 'json'

export const VALUE_KINDS: readonly ValueKind[] = [
  'numeric',
  'position',
  'attitude',
  'text',
  'bool',
  'json',
]

/** The rollup ladder, coarsest last. `raw` is the hypertable itself. */
export type RollupBucket = '1m' | '15m' | '1h' | '1d'

export const ROLLUP_BUCKETS: readonly RollupBucket[] = ['1m', '15m', '1h', '1d']

export interface SeriesDescriptor {
  path: string
  unit?: string | null
  valueKind: ValueKind
  vesselId: string
}

export interface ResolvedSeries extends SeriesDescriptor {
  seriesId: number
}

/**
 * A read of the series catalogue: which series a vessel has, without creating
 * any.
 *
 * `resolveSeries` is the write path's lookup and it upserts, so a reader that
 * used it to turn a path into a `seriesId` would create an empty series for
 * every path it asked about -- and would need the writer's grants to do it.
 * This is the read-only counterpart a route handler needs before it can call
 * `queryRollup`, which takes ids.
 */
export interface SeriesListQuery {
  /**
   * Cap on returned series. The store reports truncation rather than lying.
   * Values above `DEFAULT_MAX_SERIES_ROWS` (5_000) are `RANGE_INVALID` unless
   * the store was constructed with a higher `maxSeriesRows` ceiling.
   */
  maxRows?: number
  /**
   * Only these paths. Omitted lists every series the vessel has. A path the
   * vessel has no series for is simply absent from the answer -- never
   * created, never an error.
   */
  paths?: readonly string[]
  vesselId: string
}

export interface SeriesListResult {
  /** Ordered by `path`. */
  series: ResolvedSeries[]
  truncated: boolean
}

export interface NumericPoint {
  /** 0 primary, 1 shadow -- docs/04 `installation_role`. */
  installationRole?: number
  path: string
  quality?: number
  ts: Date
  unit?: string | null
  value: number
  vesselId: string
}

export interface TrackPoint {
  cog?: number | null
  depth?: number | null
  heading?: number | null
  latitude: number
  longitude: number
  sog?: number | null
  ts: Date
  vesselId: string
}

export interface TimeRange {
  /** Exclusive. */
  end: Date
  /** Inclusive. */
  start: Date
}

export interface WriteResult {
  /** How many statements the write cost, in total. */
  statements: number
  /** How many bound parameters the write cost, in total. */
  parameters: number
  /** Rows handed to the database. */
  rows: number
  /** Distinct series the batch touched. */
  seriesResolved: number
  /** Series answered from the in-process cache rather than the database. */
  seriesFromCache: number
}

export interface RollupQuery {
  bucket: RollupBucket
  /**
   * Cap on returned rows. The store reports truncation rather than lying.
   * Client values above `DEFAULT_MAX_ROLLUP_ROWS` (50_000) are
   * `RANGE_INVALID` unless the store was constructed with a higher
   * `maxRollupRows` ceiling.
   */
  maxRows?: number
  /**
   * Optional clock for the tier-floor calculation.
   *
   * A supplied value may only **tighten** the read window: the floor is
   * `max(real now, now) - tierWindowMs`. A past `now` is ignored so a
   * client-supplied body cannot disable the only rollup-tier gate. A future
   * `now` raises the floor (more history is clipped). Omitted, non-Date, and
   * invalid values use real time.
   *
   * Deterministic tests that need a frozen *past* clock must freeze `Date`
   * (for example `vi.setSystemTime`) rather than relying on a past `now` to
   * loosen the floor. A `now` that matches a frozen clock still pins the
   * floor.
   */
  now?: Date
  range: TimeRange
  seriesIds: readonly number[]
  /**
   * The requesting tier's history depth in ms, or the literal `'unrestricted'`.
   *
   * Rollups are retained globally at the most generous tier's depth (see
   * `RetentionPolicyInput.globalRollupWindowMs`), so a tier's own depth is
   * enforced HERE, on read: the store clips `range.start` up to
   * `max(real now, now) - tierWindowMs` and reports the clip in
   * `RollupResult`.
   *
   * **Required, and required on purpose.** Read-side clipping is the only tier
   * gate there is, so an optional field would mean a route handler that forgot
   * it failed OPEN -- serving a Free vessel a Cruiser's worth of history and
   * reporting `clipped: false` while doing it. A caller that genuinely has no
   * tier boundary says so with `'unrestricted'`, which is a decision in the
   * code review rather than an omission nobody sees.
   */
  tierWindowMs: number | 'unrestricted'
  vesselId: string
}

export interface RollupRow {
  avg: number
  bucket: Date
  /**
   * `min`, `max` and `last` are null when the bucket recorded no value for
   * them -- they are not zero. Reporting a missing extreme as 0 puts a reading
   * on a chart that the instrument never produced, and 0 is a plausible depth,
   * speed or temperature, so nothing downstream can tell the difference.
   */
  last: number | null
  max: number | null
  min: number | null
  n: number
  seriesId: number
}

export interface RollupResult {
  bucket: RollupBucket
  /** True when `tierWindowMs` moved `range.start` forward. */
  clipped: boolean
  /** The range actually read, after tier clipping. */
  range: TimeRange
  rows: RollupRow[]
  truncated: boolean
}

export interface TrackQuery {
  /**
   * The response-byte bound. Above this density the store decimates in the
   * database with `time_bucket` rather than returning every row. Client
   * values above `DEFAULT_MAX_TRACK_POINTS` (5_000) are `RANGE_INVALID`
   * unless the store was constructed with a higher `maxTrackPoints` ceiling.
   */
  maxPoints?: number
  range: TimeRange
  vesselId: string
}

export interface TrackRow {
  cog: number | null
  depth: number | null
  heading: number | null
  latitude: number
  longitude: number
  sog: number | null
  ts: Date
}

export interface TrackResult {
  /** The bucket the store decimated to, in ms; null when the rows are raw. */
  bucketMs: number | null
  decimated: boolean
  rows: TrackRow[]
  truncated: boolean
}

export interface RetentionResult {
  /** True when a concurrent sweep already held the lock and this one stood down. */
  coalesced: boolean
  deletedRowsByTarget: Record<string, number>
  /** Per-level rollup cutoffs this sweep dropped chunks older than. */
  droppedRollupsOlderThan: Partial<Record<RollupBucket, Date>>
  droppedRawOlderThan: Date | null
  /**
   * A stable digest of the validated policy this result describes. The
   * in-process single-flight is keyed on it, so a `coalesced: true` result
   * names the policy it was coalesced onto rather than leaving the caller to
   * assume it was their own.
   */
  policyIdentity: string
  skipped: string[]
  statements: number
}

/**
 * A non-number value for `telemetry_state`: a string, a bool, or any other
 * JSON value (an object such as a SignalK notification, an array, or JSON
 * null). A number is not a state: it belongs in `writeNumeric`, and an object
 * whose leaves are all numbers is the consumer's to flatten into numeric
 * children (docs/19 § 5.1).
 */
export type StateValue =
  string | boolean | null | readonly unknown[] | { readonly [key: string]: unknown }

/** The `series.value_kind` a state value is stored under. */
export type StateValueKind = 'text' | 'bool' | 'json'

/**
 * One CHANGE of a non-number path. The edge sends a changed value once, plus
 * its heartbeat; the store keeps each row as sent and never fills between them.
 */
export interface StatePoint {
  /** 0 primary, 1 shadow -- docs/04 `installation_role`. */
  installationRole?: number
  path: string
  ts: Date
  unit?: string | null
  value: StateValue
  vesselId: string
}

interface StateQueryBase {
  /** Defaults to 0, the primary installation. */
  installationRole?: number
  /** Optional clock for the tier floor; it may only tighten it, as `RollupQuery.now`. */
  now?: Date
  seriesIds: readonly number[]
  /**
   * The requesting tier's history depth in ms, or `'unrestricted'`. Required
   * for the reason `RollupQuery.tierWindowMs` is: an optional tier gate fails
   * open. A row older than the floor is never returned, even as "the state
   * at t".
   */
  tierWindowMs: number | 'unrestricted'
  vesselId: string
}

/** "What was the state at t": the last row at or before `at`, per series. */
export interface StateAtQuery extends StateQueryBase {
  at: Date
}

/** "What changed": every row in a range, oldest first. */
export interface StateTransitionsQuery extends StateQueryBase {
  /**
   * Cap on returned rows; truncation is reported. Values above
   * `DEFAULT_MAX_STATE_ROWS` (10_000) are `RANGE_INVALID` unless the store
   * was constructed with a higher `maxStateRows` ceiling.
   */
  maxRows?: number
  range: TimeRange
}

export interface StateRow {
  installationRole: number
  seriesId: number
  ts: Date
  /** Decoded by the series' kind: a bool series returns a boolean. */
  value: StateValue
  valueKind: StateValueKind
}

export interface StateAtResult {
  at: Date
  /** True when the tier floor bounded the lookup (or excluded `at` entirely). */
  clipped: boolean
  /** One row per series that had a state at `at` inside the tier window. */
  rows: StateRow[]
}

export interface StateTransitionsResult {
  clipped: boolean
  range: TimeRange
  rows: StateRow[]
  truncated: boolean
}

/**
 * A time-weighted rollup bucket (migration 0005).
 *
 * `avg` is the mean weighted by how long each value HELD inside the bucket,
 * over the covered time only: a change-only series that read 10 for 50 s and
 * 20 for 10 s averages 11.67 here and 15 in `queryRollup`.
 */
export interface TimeWeightedRollupRow {
  avg: number
  bucket: Date
  /** Milliseconds of the bucket a value covered. A gap over `maxHoldMs` is not covered. */
  heldMs: number
  /** The value held at the end of the covered time. */
  last: number | null
  /** Extremes of the values held in the bucket, including one carried in. */
  max: number | null
  min: number | null
  /** Raw rows that started in the bucket; 0 when the whole bucket was held. */
  n: number
  seriesId: number
}

export interface TimeWeightedRollupResult {
  bucket: RollupBucket
  clipped: boolean
  range: TimeRange
  rows: TimeWeightedRollupRow[]
  truncated: boolean
}

export interface TimeWeightedRefreshInput {
  /**
   * The longest a value may hold before the gap counts as no data, in ms.
   * Required, because it is the product's heartbeat contract, not this
   * library's: mybo-at-v2's edge repeats an unchanged value every 60 s (300 s
   * on Free), so a few heartbeats is a held value and an hour is an outage.
   * At most `MAX_TIME_WEIGHTED_HOLD_MS` (6 h).
   */
  maxHoldMs: number
  /**
   * The range whose raw rows changed (a batch just written, or a cron's
   * lookback). The refresh widens it: back to the minute, and forward by
   * `maxHoldMs`, because a late row changes how long the row before it held
   * and what every bucket after it carries in. Never past the current minute.
   */
  range: TimeRange
  /** One vessel, or every vessel when omitted. */
  vesselId?: string
}

export interface TimeWeightedRefreshResult {
  /** The 1-minute range actually recomputed from raw, after widening and clamping. */
  range: TimeRange | null
  statements: number
  /** Rows upserted, all levels. */
  rows: number
}

export interface TelemetryHistoryStore {
  applyRetention(policy: RetentionPolicyInput): Promise<RetentionResult>
  listSeries(query: SeriesListQuery): Promise<SeriesListResult>
  queryRollup(query: RollupQuery): Promise<RollupResult>
  queryTrack(query: TrackQuery): Promise<TrackResult>
  resolveSeries(descriptors: readonly SeriesDescriptor[]): Promise<ResolvedSeries[]>
  writeNumeric(batch: readonly NumericPoint[]): Promise<WriteResult>
  writeTrack(batch: readonly TrackPoint[]): Promise<WriteResult>
}

/**
 * Change-only history of non-number values (migration 0004). A separate
 * interface rather than new `TelemetryHistoryStore` methods, so an existing
 * implementation of that interface -- a test double, a second backend -- is
 * not broken by a minor release.
 */
export interface TelemetryStateStore {
  queryStateAt(query: StateAtQuery): Promise<StateAtResult>
  queryStateTransitions(query: StateTransitionsQuery): Promise<StateTransitionsResult>
  writeState(batch: readonly StatePoint[]): Promise<WriteResult>
}

/** Time-weighted rollups (migration 0005), opt-in beside the sample-mean ladder. */
export interface TimeWeightedRollupStore {
  queryTimeWeightedRollup(query: RollupQuery): Promise<TimeWeightedRollupResult>
  refreshTimeWeighted(input: TimeWeightedRefreshInput): Promise<TimeWeightedRefreshResult>
}

/**
 * Retention, parameterized entirely by the caller.
 *
 * No window in this library is a number. mybo-at-v2's tier windows come from
 * docs/13 §3.3 and §5 and Logan's round-20 answers; a farm or river product
 * using the same store will have different ones. The library's job is to apply
 * a policy correctly and to refuse an incoherent one, not to know what a
 * "Cruiser" is.
 */
export interface TierRetention {
  /** Vessel ids on this tier. The caller owns tier membership. */
  vesselIds: readonly string[]
  /**
   * Per-rollup-level history depth for this tier, in ms.
   *
   * This is a READ depth, not a delete. Rollup retention is one global
   * time-based window per level (`globalRollupWindowMs`); a per-vessel DELETE
   * against a continuous aggregate is not how a continuous aggregate is
   * pruned. What these numbers do is (a) get validated against the global
   * windows, so a tier cannot promise depth the store does not retain, and
   * (b) get passed by the consumer as `RollupQuery.tierWindowMs`, which clips
   * the range on read. A level omitted here reads the full retained range.
   */
  rollupWindowMs: Partial<Record<RollupBucket, number>>
  /** Track-point window in ms. Omitted means not swept. */
  trackWindowMs?: number
  /**
   * Raw READ depth in ms for this tier, when it is SHORTER than the global raw
   * window. Round 20: Free sees 24 h of raw inside the 7-day global window.
   * Omitted means the global window governs.
   *
   * This is not a delete (narduk-libs#1081). A per-vessel raw DELETE
   * invalidates the continuous aggregates, and their next refresh empties
   * the tier's rollups inside the refresh window. Raw is kept for the global
   * window for every vessel; a consumer reading raw for this tier clips the
   * range start to `now - rawWindowMs`, as `RollupQuery.tierWindowMs` does
   * for rollups. The validator still refuses a tier deeper than the global
   * window.
   */
  rawWindowMs?: number
}

export interface RetentionPolicyInput {
  /**
   * The global raw window in ms, or `'never'`: raw is never swept.
   *
   * A number drops raw chunks older than the window for every vessel (round
   * 20 (1A) for mybo-at-v2: 7 days). `'never'` is the lossless mode
   * (mybo-at-v2 D-140, "roll up, never delete"): the plan carries no raw
   * `drop_chunks` and no raw delete, `droppedRawOlderThan` is null, and the
   * result says so in `skipped`. A tier's `rawWindowMs` stays a read depth
   * and may be any positive window. Rollup and track windows are unaffected:
   * omit them as well for a plan that deletes nothing.
   */
  globalRawWindowMs: number | 'never'
  /**
   * One global window per rollup level, in ms: how long the store keeps that
   * level for EVERY vessel. Set it to the most generous tier's depth for that
   * level; shorter tiers are enforced on read (`RollupQuery.tierWindowMs`).
   *
   * A level omitted here is never swept -- which is a real choice (keep 1d
   * rollups forever) and not a mistake, so the validator reports the omitted
   * levels in `unsweptRollupLevels` and the sweep reports them in
   * `RetentionResult.skipped` instead of guessing a window.
   */
  globalRollupWindowMs?: Partial<Record<RollupBucket, number>>
  /**
   * Optional clock for retention cutoffs (`cutoff = now - windowMs`).
   *
   * A supplied value may only make cutoffs **earlier** (less deletion): the
   * clock is `min(real now, now)`. A future `now` is ignored so a caller
   * cannot delete more than real time would. A past `now` is honored, which
   * is the safe direction and is how snapshot tests pin cutoffs. Omitted,
   * non-Date, and invalid values use real time.
   */
  now?: Date
  tiers: Record<string, TierRetention>
  /** Vessels per statement in the per-tier deletes. Defaults to 1000. */
  maxVesselsPerStatement?: number
}
