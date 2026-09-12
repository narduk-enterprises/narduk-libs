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
 *    That is guarded twice: in-process single-flight, and a Postgres advisory
 *    lock so a second *process* stands down with `coalesced: true` instead of
 *    running concurrent deletes against the same compressed chunks.
 *
 * **Nothing scales with retained history.** Every statement is bounded by the
 * batch or the requested range: the write path by the parameter budget, the
 * reads by their row ceilings, retention by the tier's vessel list. The store
 * never issues a statement whose cost grows with how much history the database
 * happens to be holding.
 */

import type { SqlExecutor } from '@narduk-enterprises/narduk-postgres'

import { NardukTimeseriesError } from '../errors.js'
import type {
  NumericPoint,
  ResolvedSeries,
  RetentionPolicyInput,
  RetentionResult,
  RollupQuery,
  RollupResult,
  RollupRow,
  SeriesDescriptor,
  TelemetryHistoryStore,
  TrackPoint,
  TrackQuery,
  TrackResult,
  TrackRow,
  WriteResult,
} from '../types.js'
import { buildRollupQuery, planTrackQuery } from './query.js'
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
} from './write.js'

export * from './query.js'
export * from './retention.js'
export * from './series.js'
export * from './tables.js'
export * from './write.js'

export interface TimescaleStoreOptions {
  executor: SqlExecutor
  /** Bound-parameter budget for the write path. Defaults to the package default. */
  parameterBudget?: number
  seriesCacheSize?: number
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

  #inFlightResolves = new Map<string, Promise<ResolvedSeries[]>>()

  #inFlightRetention: Promise<RetentionResult> | null = null

  constructor(options: TimescaleStoreOptions) {
    this.#executor = options.executor
    this.#parameterBudget = options.parameterBudget
    this.cache = new SeriesCache(options.seriesCacheSize ?? DEFAULT_SERIES_CACHE_SIZE)
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
    const key = missing.map((d) => seriesCacheKey(d.vesselId, d.path)).join('|')
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
    let parameters = 0
    for (const statement of statements) {
      await this.#executor.query(statement.text, statement.params)
      parameters += statement.params.length
    }

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
    let parameters = 0
    for (const statement of statements) {
      await this.#executor.query(statement.text, statement.params)
      parameters += statement.params.length
    }
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
    const built = buildRollupQuery(query)
    const result = await this.#executor.query<RollupSqlRow>(built.text, built.params)
    const limit = Number(built.params.at(-1)) - 1
    const truncated = result.rows.length > limit
    const rows: RollupRow[] = result.rows.slice(0, limit).map((row) => ({
      avg: toNumber(row.avg),
      bucket: toDate(row.bucket),
      last: toNumber(row.last ?? 0),
      max: toNumber(row.max ?? 0),
      min: toNumber(row.min ?? 0),
      n: toNumber(row.n),
      seriesId: toNumber(row.series_id),
    }))
    return { bucket: query.bucket, rows, truncated }
  }

  async queryTrack(query: TrackQuery): Promise<TrackResult> {
    const plan = planTrackQuery(query)
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
    if (this.#inFlightRetention) {
      const running = await this.#inFlightRetention
      return { ...running, coalesced: true }
    }

    const run = this.#runRetention(policy)
    this.#inFlightRetention = run
    try {
      return await run
    } finally {
      this.#inFlightRetention = null
    }
  }

  async #runRetention(policy: RetentionPolicyInput): Promise<RetentionResult> {
    const statements = buildRetentionStatements(policy)
    const lock = retentionLockStatement()
    const locked = await this.#executor.query<{ locked: boolean }>(lock.text, lock.params)
    if (locked.rows[0]?.locked !== true) {
      return {
        coalesced: true,
        deletedRowsByTarget: {},
        droppedRawOlderThan: null,
        skipped: ['another retention sweep holds the advisory lock'],
        statements: 1,
      }
    }

    const deletedRowsByTarget: Record<string, number> = {}
    let droppedRawOlderThan: Date | null = null
    let executed = 1

    try {
      for (const statement of statements) {
        const result = await this.#executor.query(statement.text, statement.params)
        executed += 1
        if (statement.kind === 'drop_chunks') {
          droppedRawOlderThan = statement.params[0] as Date
          continue
        }
        deletedRowsByTarget[statement.target] =
          (deletedRowsByTarget[statement.target] ?? 0) + (result.rowCount || 0)
      }
    } finally {
      const unlock = retentionUnlockStatement()
      await this.#executor.query(unlock.text, unlock.params)
      executed += 1
    }

    return {
      coalesced: false,
      deletedRowsByTarget,
      droppedRawOlderThan,
      skipped: [],
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
