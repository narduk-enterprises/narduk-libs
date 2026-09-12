/**
 * The batched write path.
 *
 * Two numbers govern it, and both are stated rather than assumed:
 *
 *  - `NUMERIC_PARAMETERS_PER_ROW = 6` and `TRACK_PARAMETERS_PER_ROW = 8`;
 *  - the bound-parameter budget from `@narduk-enterprises/narduk-postgres`,
 *    32768 by default against a protocol ceiling of 65535.
 *
 * Together they fix the rows per statement (5461 numeric, 4096 track) and make
 * the statement count a pure function of the batch size -- which is what the
 * scale tests assert. A writer that sizes its `VALUES` list from the caller's
 * array instead works in every test and fails on the first busy minute; that is
 * not a hypothetical, it is mybo-at-v2#83 with a different ceiling.
 *
 * **COPY, and why this is multi-row INSERT.** `COPY ... FROM STDIN` is faster
 * per row and is the right tool for a bulk backfill from a Node process. It is
 * not reachable here: the write path is a Cloudflare Queue consumer holding an
 * `SqlExecutor`, and a COPY stream is a driver-specific streaming API rather
 * than a parameterized statement -- adding it to this seam would mean either a
 * driver dependency in the library or a second interface every backend must
 * implement, for batches of a few thousand rows where the round trip, not the
 * row encoding, dominates. The seed and backfill jobs that DO want COPY run on
 * Node with a driver in hand and can use it directly against the same schema.
 * This is a deliberate boundary, not an oversight.
 */

import { chunkRowsByParameterBudget, placeholderTuples } from '@narduk-enterprises/narduk-postgres'

import { NardukTimeseriesError } from '../errors.js'
import type { NumericPoint, TrackPoint } from '../types.js'
import { NUMERIC_TABLE, TRACK_TABLE } from './tables.js'

export const NUMERIC_PARAMETERS_PER_ROW = 6
export const TRACK_PARAMETERS_PER_ROW = 8

export interface WriteStatement {
  params: unknown[]
  rows: number
  text: string
}

export interface ResolvedNumericPoint extends NumericPoint {
  seriesId: number
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

function assertFiniteNumber(value: unknown, label: string, index: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new NardukTimeseriesError(
      'WRITE_BATCH_INVALID',
      `Point ${index} has a non-finite ${label}. NaN and Infinity are not storable values.`,
      { index, label },
    )
  }
  return value
}

function optionalNumber(value: unknown, label: string, index: number): number | null {
  if (value === undefined || value === null) return null
  return assertFiniteNumber(value, label, index)
}

/**
 * Multi-row INSERT statements for a resolved numeric batch.
 *
 * There is no `ON CONFLICT` clause. docs/04 declares no unique constraint on
 * `telemetry_numeric`, so `ON CONFLICT DO NOTHING` would be a no-op that reads
 * like idempotency -- worse than nothing. De-duplication for the at-least-once
 * queue path is the consumer's, and is named as an open item in the README.
 */
export function buildNumericWriteStatements(
  batch: readonly ResolvedNumericPoint[],
  budget?: number,
): WriteStatement[] {
  if (batch.length === 0) return []

  const chunks = chunkRowsByParameterBudget(batch, NUMERIC_PARAMETERS_PER_ROW, budget)
  return chunks.map((chunk) => {
    const params: unknown[] = []
    for (const [offset, point] of chunk.entries()) {
      params.push(
        assertTimestamp(point.ts, offset),
        point.vesselId,
        point.seriesId,
        point.installationRole ?? 0,
        assertFiniteNumber(point.value, 'value', offset),
        point.quality ?? 0,
      )
    }
    return {
      params,
      rows: chunk.length,
      text:
        `INSERT INTO ${NUMERIC_TABLE} (ts, vessel_id, series_id, installation_role, value, quality)\n` +
        `VALUES ${placeholderTuples(chunk.length, NUMERIC_PARAMETERS_PER_ROW)}`,
    }
  })
}

/**
 * Multi-row INSERT statements for a track batch.
 *
 * Longitude and latitude are two parameters, not one: `ST_MakePoint($n, $n+1)`
 * takes x then y, so the ordering is lon, lat. Getting that backwards produces
 * coordinates that are silently valid and geographically absurd, which is why
 * the column order is asserted in the snapshot test rather than left to review.
 */
export function buildTrackWriteStatements(
  batch: readonly TrackPoint[],
  budget?: number,
): WriteStatement[] {
  if (batch.length === 0) return []

  const chunks = chunkRowsByParameterBudget(batch, TRACK_PARAMETERS_PER_ROW, budget)
  return chunks.map((chunk) => {
    const params: unknown[] = []
    const tuples: string[] = []
    for (const [offset, point] of chunk.entries()) {
      const base = offset * TRACK_PARAMETERS_PER_ROW + 1
      tuples.push(
        `($${base}, $${base + 1}, ST_SetSRID(ST_MakePoint($${base + 2}, $${base + 3}), 4326)::geography, ` +
          `$${base + 4}, $${base + 5}, $${base + 6}, $${base + 7})`,
      )
      params.push(
        assertTimestamp(point.ts, offset),
        point.vesselId,
        assertFiniteNumber(point.longitude, 'longitude', offset),
        assertFiniteNumber(point.latitude, 'latitude', offset),
        optionalNumber(point.sog, 'sog', offset),
        optionalNumber(point.cog, 'cog', offset),
        optionalNumber(point.heading, 'heading', offset),
        optionalNumber(point.depth, 'depth', offset),
      )
    }
    return {
      params,
      rows: chunk.length,
      text:
        `INSERT INTO ${TRACK_TABLE} (ts, vessel_id, geom, sog, cog, heading, depth)\n` +
        `VALUES ${tuples.join(', ')}`,
    }
  })
}
