/**
 * The TimescaleDB + PostGIS adapter.
 *
 * It holds three things the pure builders cannot: the series cache, the
 * single-flight guards, and the execution loop that turns a plan into
 * statements against an `SqlExecutor`.
 *
 * **Refresh races are explicit, not hoped away.** Two of these operations can
 * plausibly run twice at once:
 *
 *  - `resolveSeries`, when a burst of queue messages for the same vessel
 *    arrives together. Concurrent resolves of an identical descriptor set are
 *    coalesced onto one in-flight promise, so the burst costs one statement
 *    rather than one per message.
 *  - `applyRetention`, when a cron Workflow and an operator start it together.
 *    That is guarded twice: an in-process single-flight keyed on the policy's
 *    identity (two schedulers running two different policies are two
 *    operations, not one), and a Postgres advisory lock so a second *process*
 *    stands down with `coalesced: true` instead of running concurrent deletes
 *    against the same columnstore chunks. The lock is session-scoped, so the
 *    sweep refuses to run without an executor the caller has declared
 *    session-pinned.
 *
 * **Nothing scales with retained history.** Every statement is bounded by the
 * batch or the requested range: the write path by the parameter budget, the
 * reads by their row ceilings, retention by the tier's vessel list. The store
 * never issues a statement whose cost grows with how much history the database
 * happens to be holding.
 */

import { isTransactionalExecutor, type SqlExecutor } from '@narduk-enterprises/narduk-postgres'

import { NardukTimeseriesError } from '../errors.js'
import { retentionPolicyIdentity, validateRetentionPolicy } from '../policy.js'
import type {
  NumericPoint,
  RollupBucket,
  ResolvedSeries,
  RetentionPolicyInput,
  RetentionResult,
  RollupQuery,
  RollupResult,
  RollupRow,
  SeriesDescriptor,
  SeriesListQuery,
  SeriesListResult,
  TelemetryHistoryStore,
  TrackPoint,
  TrackQuery,
  TrackResult,
  TrackRow,
  WriteResult,
} from '../types.js'
import {
  DEFAULT_MAX_ROLLUP_ROWS,
  DEFAULT_MAX_SERIES_ROWS,
  DEFAULT_MAX_TRACK_POINTS,
  buildRollupQuery,
  buildSeriesListQuery,
  clipRollupRange,
  planTrackQuery,
} from './query.js'
import {
  buildRetentionStatements,
  retentionLockStatement,
  retentionUnlockStatement,
} from './retention.js'
import {
  DEFAULT_SERIES_CACHE_SIZE,
  SeriesCache,
  buildSeriesResolveStatement,
  distinctDescriptors,
  seriesCacheKey,
  toResolvedSeries,
  type SeriesRow,
} from './series.js'
import {
  buildNumericWriteStatements,
  buildTrackWriteStatements,
  type ResolvedNumericPoint,
  type WriteStatement,
} from './write.js'

export * from './query.js'
export * from './retention.js'
export * from './roles.js'
export * from './series.js'
export * from './tables.js'
export * from './write.js'

/**
 * The executor `applyRetention` is allowed to use.
 *
 * Retention takes a SESSION-scoped advisory lock, so lock and unlock must
 * reach the same backend. A pool -- and Hyperdrive is a pool -- can route them
 * to two, which leaves the lock held by a backend nobody is talking to and
 * makes every later sweep stand down with `coalesced: true` and delete
 * nothing. There is no way for this library to detect a pool from the
 * `SqlExecutor` interface, so pinning is declared: pass a `ManagedConnection`
 * from `@narduk-enterprises/narduk-postgres/node`, or a pool you have tuned to
 * `max: 1` and say so with `maxConnections`. Retention runs from Node, not
 * from a Hyperdrive Worker.
 */
export interface RetentionExecutorOptions {
  /** A single-connection executor: a ManagedConnection, or a `max: 1` pool. */
  executor: SqlExecutor
  /**
   * The executor's connection count. **Required, and anything but 1 is
   * refused.**
   *
   * Optional, this refused a pool only when the caller happened to mention its
   * size -- so the dangerous case, a pool handed over with no metadata, was
   * exactly the case that passed. A session advisory lock taken on one backend
   * cannot be released from another, so a sweep on a pool can unlock nothing
   * and leave the lock held until the connection is recycled.
   */
  maxConnections: 1
}

export interface TimescaleStoreOptions {
  executor: SqlExecutor
  /** Bound-parameter budget for the write path. Defaults to the package default. */
  parameterBudget?: number
  /**
   * The session-pinned executor for `applyRetention`. Without it the store
   * reads and writes normally and `applyRetention` throws
   * `RETENTION_EXECUTOR_UNPINNED` -- a Worker holding a Hyperdrive binding
   * should never be sweeping.
   */
  retention?: RetentionExecutorOptions
  seriesCacheSize?: number
  /**
   * Hard ceiling for `RollupQuery.maxRows`. Defaults to
   * `DEFAULT_MAX_ROLLUP_ROWS` (50_000). A client value above this is
   * `RANGE_INVALID`. Raise only from server-side construction.
   */
  maxRollupRows?: number
  /**
   * Hard ceiling for `TrackQuery.maxPoints`. Defaults to
   * `DEFAULT_MAX_TRACK_POINTS` (5_000). Raise only from server-side
   * construction.
   */
  maxTrackPoints?: number
  /**
   * Hard ceiling for `SeriesListQuery.maxRows`. Defaults to
   * `DEFAULT_MAX_SERIES_ROWS` (5_000). Raise only from server-side
   * construction.
   */
  maxSeriesRows?: number
}

interface RollupSqlRow {
  avg: number | string
  bucket: Date | string
  last: number | string | null
  max: number | string | null
  min: number | string | null
  n: number | string
  series_id: number | string
}

interface TrackSqlRow {
  cog: number | string | null
  depth: number | string | null
  heading: number | string | null
  latitude: number | string
  longitude: number | string
  sog: number | string | null
  ts: Date | string
}

function toNumber(value: unknown): number {
  return typeof value === 'number' ? value : Number(value)
}

function toOptionalNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : toNumber(value)
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value)
}

export class TimescaleHistoryStore implements TelemetryHistoryStore {
  readonly cache: SeriesCache

  #executor: SqlExecutor

  #parameterBudget: number | undefined

  #maxRollupRows: number

  #maxTrackPoints: number

  #maxSeriesRows: number

  #retention: RetentionExecutorOptions | undefined

  #inFlightResolves = new Map<string, Promise<ResolvedSeries[]>>()

  // Keyed by policy identity: two schedulers running DIFFERENT policies are
  // two different operations, and collapsing the second onto the first
  // returned a result describing deletions its caller never asked for.
  #inFlightRetention = new Map<string, Promise<RetentionResult>>()

  constructor(options: TimescaleStoreOptions) {
    this.#executor = options.executor
    this.#parameterBudget = options.parameterBudget
    this.#maxRollupRows = options.maxRollupRows ?? DEFAULT_MAX_ROLLUP_ROWS
    this.#maxTrackPoints = options.maxTrackPoints ?? DEFAULT_MAX_TRACK_POINTS
    this.#maxSeriesRows = options.maxSeriesRows ?? DEFAULT_MAX_SERIES_ROWS
    this.#retention = options.retention
    if (options.retention !== undefined && options.retention.maxConnections !== 1) {
      throw new NardukTimeseriesError(
        'RETENTION_EXECUTOR_UNPINNED',
        'The retention executor must be session-pinned and must say so: pass maxConnections: 1 with a ManagedConnection or a pool tuned to max: 1. A session advisory lock taken on one backend cannot be released from another.',
        { maxConnections: options.retention.maxConnections },
      )
    }
    this.cache = new SeriesCache(options.seriesCacheSize ?? DEFAULT_SERIES_CACHE_SIZE)
  }

  /**
   * Run a batch's statements, atomically when there is more than one.
   *
   * A multi-statement write is one batch as far as the caller is concerned, so
   * a failure halfway through must not leave half of it stored: the chunking
   * is this library's bookkeeping, not a fact about the data. One statement is
   * already atomic on its own, so it is not wrapped -- a BEGIN/COMMIT pair per
   * single-chunk write would be two extra round trips across a tunnel for
   * nothing. A non-transactional executor runs the statements in order and the
   * batch is not atomic; that is the seam's choice, and it is stated in the
   * README rather than silently assumed.
   */
  async #runWrite(statements: readonly WriteStatement[]): Promise<number> {
    let parameters = 0
    const run = async (executor: SqlExecutor): Promise<void> => {
      for (const statement of statements) {
        await executor.query(statement.text, statement.params)
        parameters += statement.params.length
      }
    }

    if (statements.length > 1 && isTransactionalExecutor(this.#executor)) {
      await this.#executor.transaction(run)
    } else {
      await run(this.#executor)
    }
    return parameters
  }

  async resolveSeries(descriptors: readonly SeriesDescriptor[]): Promise<ResolvedSeries[]> {
    const distinct = distinctDescriptors(descriptors)
    if (distinct.length === 0) return []

    const resolved: ResolvedSeries[] = []
    const missing: SeriesDescriptor[] = []
    for (const descriptor of distinct) {
      const cached = this.cache.get(descriptor.vesselId, descriptor.path)
      if (cached) resolved.push(cached)
      else missing.push(descriptor)
    }
    if (missing.length === 0) return resolved

    // Coalesce identical concurrent resolves onto one statement: a burst of
    // queue messages for the same vessel is the common case, not the rare one.
    // Sorted: the same descriptor set arriving in two orders is one resolve,
    // not two. Unsorted, a batch of the same paths in a different order missed
    // the in-flight entry and issued a second identical statement.
    const key = missing
      .map((d) => seriesCacheKey(d.vesselId, d.path))
      .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
      .join('|')
    const existing = this.#inFlightResolves.get(key)
    const inFlight =
      existing ??
      (async (): Promise<ResolvedSeries[]> => {
        const statement = buildSeriesResolveStatement(missing)
        const result = await this.#executor.query<SeriesRow>(statement.text, statement.params)
        const rows = result.rows.map((row) => toResolvedSeries(row))
        for (const row of rows) this.cache.set(row)
        return rows
      })()

    if (!existing) this.#inFlightResolves.set(key, inFlight)
    try {
      const rows = await inFlight
      const byKey = new Map(rows.map((row) => [seriesCacheKey(row.vesselId, row.path), row]))
      for (const descriptor of missing) {
        const row = byKey.get(seriesCacheKey(descriptor.vesselId, descriptor.path))
        if (!row) {
          throw new NardukTimeseriesError(
            'SERIES_UNRESOLVED',
            'The database returned no series id for a descriptor in the batch.',
            { path: descriptor.path, vesselId: descriptor.vesselId },
          )
        }
        resolved.push(row)
      }
      return resolved
    } finally {
      if (!existing) this.#inFlightResolves.delete(key)
    }
  }

  async writeNumeric(batch: readonly NumericPoint[]): Promise<WriteResult> {
    if (batch.length === 0) {
      return {
        parameters: 0,
        rows: 0,
        seriesFromCache: 0,
        seriesResolved: 0,
        statements: 0,
      }
    }

    const descriptors = batch.map((point) => ({
      path: point.path,
      unit: point.unit ?? null,
      valueKind: 'numeric' as const,
      vesselId: point.vesselId,
    }))
    const distinct = distinctDescriptors(descriptors)
    const cachedBefore = distinct.filter(
      (d) => this.cache.get(d.vesselId, d.path) !== undefined,
    ).length

    // Zero when the whole descriptor set was already cached -- the steady
    // state for a vessel whose path set has stopped changing.
    const resolveStatements = cachedBefore === distinct.length ? 0 : 1
    const series = await this.resolveSeries(distinct)

    const byKey = new Map(series.map((row) => [seriesCacheKey(row.vesselId, row.path), row]))
    const resolvedBatch: ResolvedNumericPoint[] = batch.map((point) => {
      const row = byKey.get(seriesCacheKey(point.vesselId, point.path))
      if (!row) {
        throw new NardukTimeseriesError(
          'SERIES_UNRESOLVED',
          'A point in the batch has no resolved series.',
          { path: point.path, vesselId: point.vesselId },
        )
      }
      return { ...point, seriesId: row.seriesId }
    })

    const statements = buildNumericWriteStatements(resolvedBatch, this.#parameterBudget)
    const parameters = await this.#runWrite(statements)

    return {
      parameters,
      rows: batch.length,
      seriesFromCache: cachedBefore,
      seriesResolved: distinct.length,
      statements: statements.length + resolveStatements,
    }
  }

  async writeTrack(batch: readonly TrackPoint[]): Promise<WriteResult> {
    const statements = buildTrackWriteStatements(batch, this.#parameterBudget)
    const parameters = await this.#runWrite(statements)
    return {
      parameters,
      rows: batch.length,
      seriesFromCache: 0,
      // The track has no series dimension: position is its own hypertable.
      seriesResolved: 0,
      statements: statements.length,
    }
  }

  async queryRollup(query: RollupQuery): Promise<RollupResult> {
    // A range entirely older than the tier's window is an empty answer, not an
    // error and not a statement: the database has the rows (they are retained
    // globally), the tier is simply not entitled to read that far back.
    const plan = clipRollupRange(query)
    if (plan.empty) {
      return { bucket: query.bucket, clipped: true, range: plan.range, rows: [], truncated: false }
    }

    // The plan computed above is handed on rather than recomputed: clipping
    // twice means two `new Date()` calls and therefore two floors, so the
    // range reported would not be quite the range the statement read.
    const built = buildRollupQuery(query, plan, { maxRowsCeiling: this.#maxRollupRows })
    const result = await this.#executor.query<RollupSqlRow>(built.text, built.params)
    const limit = Number(built.params.at(-1)) - 1
    const truncated = result.rows.length > limit
    // min/max/last stay null when the bucket has none: 0 is a plausible depth,
    // speed or temperature, so coercing a missing extreme to 0 puts a reading
    // on the chart that the instrument never produced.
    const rows: RollupRow[] = result.rows.slice(0, limit).map((row) => ({
      avg: toNumber(row.avg),
      bucket: toDate(row.bucket),
      last: toOptionalNumber(row.last),
      max: toOptionalNumber(row.max),
      min: toOptionalNumber(row.min),
      n: toNumber(row.n),
      seriesId: toNumber(row.series_id),
    }))
    return { bucket: query.bucket, clipped: built.clipped, range: built.range, rows, truncated }
  }

  async listSeries(query: SeriesListQuery): Promise<SeriesListResult> {
    // An explicit empty filter asks about no paths: the answer is empty and
    // costs no statement. Omitting `paths` is how a caller asks for them all.
    if (Array.isArray(query.paths) && query.paths.length === 0) {
      return { series: [], truncated: false }
    }
    const built = buildSeriesListQuery(query, { maxRowsCeiling: this.#maxSeriesRows })
    const result = await this.#executor.query<SeriesRow>(built.text, built.params)
    const limit = Number(built.params.at(-1)) - 1
    const series = result.rows.slice(0, limit).map((row) => toResolvedSeries(row))
    return { series, truncated: result.rows.length > limit }
  }

  async queryTrack(query: TrackQuery): Promise<TrackResult> {
    const plan = planTrackQuery(query, { maxPointsCeiling: this.#maxTrackPoints })
    const result = await this.#executor.query<TrackSqlRow>(plan.query.text, plan.query.params)
    const truncated = result.rows.length > plan.maxPoints
    const rows: TrackRow[] = result.rows.slice(0, plan.maxPoints).map((row) => ({
      cog: toOptionalNumber(row.cog),
      depth: toOptionalNumber(row.depth),
      heading: toOptionalNumber(row.heading),
      latitude: toNumber(row.latitude),
      longitude: toNumber(row.longitude),
      sog: toOptionalNumber(row.sog),
      ts: toDate(row.ts),
    }))
    return { bucketMs: plan.bucketMs, decimated: plan.decimated, rows, truncated }
  }

  async applyRetention(policy: RetentionPolicyInput): Promise<RetentionResult> {
    const validated = validateRetentionPolicy(policy)
    const identity = retentionPolicyIdentity(validated)

    const running = this.#inFlightRetention.get(identity)
    if (running) {
      const result = await running
      return { ...result, coalesced: true }
    }

    const run = this.#runRetention(policy, identity)
    this.#inFlightRetention.set(identity, run)
    try {
      return await run
    } finally {
      this.#inFlightRetention.delete(identity)
    }
  }

  async #runRetention(policy: RetentionPolicyInput, identity: string): Promise<RetentionResult> {
    const retention = this.#retention
    if (!retention) {
      throw new NardukTimeseriesError(
        'RETENTION_EXECUTOR_UNPINNED',
        'applyRetention needs a session-pinned executor (TimescaleStoreOptions.retention). The sweep holds a session advisory lock, so lock and unlock must reach the same backend; through a pool -- Hyperdrive is a pool -- they may not, and a leaked lock makes every later sweep stand down and delete nothing. Retention runs from Node.',
      )
    }
    const executor = retention.executor

    const validated = validateRetentionPolicy(policy)
    const statements = buildRetentionStatements(policy)
    const skipped = validated.unsweptRollupLevels.map(
      (bucket) =>
        `rollup level ${bucket} has no globalRollupWindowMs and is never swept (retained indefinitely)`,
    )

    const lock = retentionLockStatement()
    const locked = await executor.query<{ locked: boolean; pid: number }>(lock.text, lock.params)
    const lockRow = locked.rows[0]
    if (lockRow?.locked !== true) {
      return {
        coalesced: true,
        deletedRowsByTarget: {},
        droppedRawOlderThan: null,
        droppedRollupsOlderThan: {},
        policyIdentity: identity,
        skipped: [...skipped, 'another retention sweep holds the advisory lock'],
        statements: 1,
      }
    }

    const deletedRowsByTarget: Record<string, number> = {}
    const droppedRollupsOlderThan: Partial<Record<RollupBucket, Date>> = {}
    let droppedRawOlderThan: Date | null = null
    let executed = 1
    let primaryError: unknown = null

    try {
      for (const statement of statements) {
        const result = await executor.query(statement.text, statement.params)
        executed += 1
        if (statement.kind === 'drop_chunks') {
          if (statement.rollup === null) droppedRawOlderThan = statement.params[0] as Date
          else droppedRollupsOlderThan[statement.rollup] = statement.params[0] as Date
          continue
        }
        deletedRowsByTarget[statement.target] =
          (deletedRowsByTarget[statement.target] ?? 0) + (result.rowCount || 0)
      }
    } catch (error) {
      primaryError = error
    }

    // Unlocking outside the try, because a `finally` that throws replaces the
    // error that got us here and the sweep's real failure disappears.
    const unlock = retentionUnlockStatement()
    let unlockError: unknown = null
    try {
      const released = await executor.query<{ pid: number; unlocked: boolean }>(
        unlock.text,
        unlock.params,
      )
      executed += 1
      const unlockRow = released.rows[0]
      if (unlockRow?.unlocked !== true) {
        unlockError = new NardukTimeseriesError(
          'RETENTION_UNLOCK_FAILED',
          'pg_advisory_unlock returned false: this session does not hold the retention lock it took. That means the executor is not session-pinned -- lock and unlock reached different backends -- and the lock is now held by a backend nothing is talking to.',
          { lockPid: lockRow.pid, unlockPid: unlockRow?.pid },
        )
      } else if (unlockRow.pid !== lockRow.pid) {
        unlockError = new NardukTimeseriesError(
          'RETENTION_UNLOCK_FAILED',
          'The retention lock and unlock ran on different backends. The executor is pooled, not session-pinned.',
          { lockPid: lockRow.pid, unlockPid: unlockRow.pid },
        )
      }
    } catch (error) {
      unlockError = error
    }

    if (primaryError !== null) throw primaryError
    if (unlockError !== null) throw unlockError

    return {
      coalesced: false,
      deletedRowsByTarget,
      droppedRawOlderThan,
      droppedRollupsOlderThan,
      policyIdentity: identity,
      skipped,
      statements: executed,
    }
  }
}

export function createTimescaleHistoryStore(options: TimescaleStoreOptions): TimescaleHistoryStore {
  return new TimescaleHistoryStore(options)
}

/**
 * The directory holding this package's migration files, as a `file:` URL.
 *
 * The SQL ships as real `.sql` files rather than as generated TypeScript
 * constants, because the runner's immutability check is a checksum of the file
 * bytes -- generating them into a module would add a build step that can go
 * stale and a second copy that can disagree with the first. Migrations run from
 * Node (ADR-0004: "run from the app-local deploy job"), where a directory URL is
 * exactly what `loadMigrationsFromDirectory` takes.
 */
export const timescaleMigrationsUrl = new URL('../../migrations/', import.meta.url)

export const TIMESCALE_MIGRATION_NAMES: readonly string[] = [
  '0001_history_core.sql',
  '0002_history_rollups.sql',
  '0003_history_roles.sql',
]
