/**
 * Series resolution: one statement for a whole batch, not one per point.
 *
 * A `NumericPoint` carries a SignalK path; the hypertable stores a
 * `series_id`. The obvious implementation -- look up the id for each point as
 * it is written -- is an awaited database round trip per item, which is the
 * exact shape the estate's data-path contract forbids and the exact shape that
 * turns a 2,000-point upload into 2,000 queries across a Cloudflare Tunnel.
 *
 * So resolution is set-based. The distinct descriptors of a batch go into one
 * `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` -- one round trip, whether
 * the batch touches one series or four hundred. A bounded in-process cache
 * then removes even that for the steady state: a vessel's path set is stable,
 * so after the first batch the resolve statement count is zero.
 *
 * `DO UPDATE` rather than `DO NOTHING` is the correctness-critical part.
 * `DO NOTHING` returns no row for a conflicting tuple, so the statement needed
 * a second branch to read the rows that already existed -- and that branch
 * cannot see a row inserted by a *concurrent uncommitted* transaction, which
 * is the ordinary case when two queue consumers pick up the same vessel's
 * first batch at once. The statement then returned nothing for that descriptor
 * and the store raised `SERIES_UNRESOLVED` on a perfectly healthy database.
 * `DO UPDATE` takes the conflicting row's lock, waits for the other
 * transaction, and returns the row either way.
 *
 * The cache is bounded (insertion-order eviction) because an unbounded map in a
 * long-lived Node process is a slow memory leak that only shows up at fleet
 * scale.
 */

import { placeholderTuplesWithCasts } from '@narduk-enterprises/narduk-postgres'

import { NardukTimeseriesError } from '../errors.js'
import {
  VALUE_KINDS,
  type ResolvedSeries,
  type SeriesDescriptor,
  type ValueKind,
} from '../types.js'
import { SERIES_TABLE } from './tables.js'

/** Four columns per descriptor: vessel_id, path, unit, value_kind. */
export const SERIES_PARAMETERS_PER_ROW = 4

export const DEFAULT_SERIES_CACHE_SIZE = 5000

/**
 * Length-prefixed so the two halves cannot collide: a path may legally contain
 * any separator character an implementation might otherwise pick.
 */
export function seriesCacheKey(vesselId: string, path: string): string {
  return `${vesselId.length}:${vesselId}:${path}`
}

export function assertSeriesDescriptor(descriptor: SeriesDescriptor): SeriesDescriptor {
  if (typeof descriptor.vesselId !== 'string' || descriptor.vesselId.length === 0) {
    throw new NardukTimeseriesError(
      'SERIES_DESCRIPTOR_INVALID',
      'A series descriptor needs a vesselId.',
    )
  }
  if (typeof descriptor.path !== 'string' || descriptor.path.length === 0) {
    throw new NardukTimeseriesError(
      'SERIES_DESCRIPTOR_INVALID',
      'A series descriptor needs a SignalK path.',
      { vesselId: descriptor.vesselId },
    )
  }
  if (!VALUE_KINDS.includes(descriptor.valueKind)) {
    throw new NardukTimeseriesError(
      'VALUE_KIND_UNKNOWN',
      `Unknown value kind. Expected one of: ${VALUE_KINDS.join(', ')}.`,
      { known: [...VALUE_KINDS], path: descriptor.path },
    )
  }
  return descriptor
}

/** Distinct by (vesselId, path), first occurrence wins, order preserved. */
export function distinctDescriptors(descriptors: readonly SeriesDescriptor[]): SeriesDescriptor[] {
  const seen = new Map<string, SeriesDescriptor>()
  for (const descriptor of descriptors) {
    assertSeriesDescriptor(descriptor)
    const key = seriesCacheKey(descriptor.vesselId, descriptor.path)
    if (!seen.has(key)) seen.set(key, descriptor)
  }
  return [...seen.values()]
}

export interface SeriesResolveStatement {
  params: unknown[]
  text: string
}

/**
 * One statement that both inserts the missing rows and returns the ids of all
 * of them.
 *
 * The `input` CTE needs its casts: a bare multi-row `VALUES` list feeding a CTE
 * has no target column to infer from, so without `::uuid` the insert into
 * `series.vessel_id` resolves to text and fails at plan time.
 *
 * The conflict action updates `unit` from the incoming descriptor when the
 * incoming one is non-null and keeps the stored one otherwise -- a batch that
 * omits the unit must not erase a unit the store already knows. `value_kind`
 * is never overwritten: the kind a series was created with is its identity.
 */
export function buildSeriesResolveStatement(
  descriptors: readonly SeriesDescriptor[],
): SeriesResolveStatement {
  if (descriptors.length === 0) {
    throw new NardukTimeseriesError(
      'SERIES_DESCRIPTOR_INVALID',
      'Cannot build a resolve statement for an empty descriptor set.',
    )
  }

  const tuples = placeholderTuplesWithCasts(descriptors.length, ['uuid', 'text', 'text', 'text'])
  const params: unknown[] = []
  for (const descriptor of descriptors) {
    params.push(descriptor.vesselId, descriptor.path, descriptor.unit ?? null, descriptor.valueKind)
  }

  const text = [
    `WITH input (vessel_id, path, unit, value_kind) AS (VALUES ${tuples})`,
    `INSERT INTO ${SERIES_TABLE} (vessel_id, path, unit, value_kind)`,
    `SELECT vessel_id, path, unit, value_kind FROM input`,
    `ON CONFLICT (vessel_id, path) DO UPDATE`,
    `   SET unit = COALESCE(EXCLUDED.unit, ${SERIES_TABLE}.unit)`,
    `RETURNING series_id, vessel_id, path, unit, value_kind`,
  ].join('\n')

  return { params, text }
}

export interface SeriesRow {
  path: string
  series_id: number | string
  unit: string | null
  value_kind: string
  vessel_id: string
}

export function toResolvedSeries(row: SeriesRow): ResolvedSeries {
  return {
    path: row.path,
    seriesId: Number(row.series_id),
    unit: row.unit,
    valueKind: row.value_kind as ValueKind,
    vesselId: row.vessel_id,
  }
}

/**
 * Insertion-ordered cache with a hard entry ceiling.
 *
 * Deliberately not an LRU: a telemetry vessel's path set is stable, so the hit
 * rate difference is noise, and insertion order keeps eviction O(1) with no
 * per-read bookkeeping on the hot path.
 */
export class SeriesCache {
  readonly maxEntries: number

  #entries = new Map<string, ResolvedSeries>()

  constructor(maxEntries: number = DEFAULT_SERIES_CACHE_SIZE) {
    this.maxEntries = maxEntries
  }

  get size(): number {
    return this.#entries.size
  }

  get(vesselId: string, path: string): ResolvedSeries | undefined {
    return this.#entries.get(seriesCacheKey(vesselId, path))
  }

  set(series: ResolvedSeries): void {
    const key = seriesCacheKey(series.vesselId, series.path)
    if (!this.#entries.has(key) && this.#entries.size >= this.maxEntries) {
      const oldest = this.#entries.keys().next()
      if (!oldest.done) this.#entries.delete(oldest.value)
    }
    this.#entries.set(key, series)
  }

  clear(): void {
    this.#entries.clear()
  }
}
