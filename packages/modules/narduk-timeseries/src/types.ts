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
   * Raw window in ms for this tier, when it is SHORTER than the global raw
   * window. Round 20: Free writes raw and keeps it 24 h, inside the 7-day
   * global window. Omitted means the global window governs.
   */
  rawWindowMs?: number
}

export interface RetentionPolicyInput {
  /** The global raw window in ms. Round 20 (1A) for mybo-at-v2: 7 days. */
  globalRawWindowMs: number
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
