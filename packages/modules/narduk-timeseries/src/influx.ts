/**
 * A read-only InfluxDB adapter, for dual-run parity and nothing else.
 *
 * ADR-0004 keeps Influx alive in exactly two places: the optional on-boat
 * `local-history` profile, and a read-only adapter used to compare the new
 * Timescale store against the old one until G4 parity is signed off. This is
 * that adapter, and it is deliberately tiny -- no write path, no schema
 * knowledge, no client.
 *
 * **It never holds a token.** The caller injects an object with a `query`
 * method; this module has no credential, no URL and no HTTP. That is not
 * squeamishness: the Influx replica lives on a Linode host being retired, and a
 * library that stored its token would outlive the host it belongs to.
 *
 * **It enforces the host-safe query shape**, because the unsafe shape has
 * already taken that host down once: a wide unwindowed query OOM-killed it on
 * 2026-09-09. Three rules, all checked before a query is sent:
 *
 *  - windows of at most four days, so a year-long parity run is 92 bounded
 *    queries rather than one unbounded one;
 *  - `aggregateWindow` before any `group()`, so the reduction happens per
 *    series in the storage engine instead of after a cross-series regroup;
 *  - a 120-second timeout on every request.
 */

import { NardukTimeseriesError } from './errors.js'
import type { TimeRange } from './types.js'

export const INFLUX_MAX_WINDOW_MS = 4 * 24 * 60 * 60 * 1000
export const INFLUX_TIMEOUT_MS = 120_000

export interface InfluxQueryClient {
  query(flux: string, options: { timeoutMs: number }): Promise<unknown[]>
}

export interface InfluxWindowedRead {
  client: InfluxQueryClient
  /**
   * A Flux query carrying the `:start:` and `:end:` markers this module
   * substitutes per window. Everything else in it is the caller's.
   */
  flux: string
  maxWindowMs?: number
  range: TimeRange
  timeoutMs?: number
}

/** Split a range into windows no wider than `maxWindowMs`, in order. */
export function splitRangeIntoWindows(
  range: TimeRange,
  maxWindowMs: number = INFLUX_MAX_WINDOW_MS,
): TimeRange[] {
  if (!Number.isFinite(maxWindowMs) || maxWindowMs <= 0) {
    throw new NardukTimeseriesError(
      'INFLUX_WINDOW_INVALID',
      'maxWindowMs must be a positive number of milliseconds.',
      { maxWindowMs },
    )
  }
  if (maxWindowMs > INFLUX_MAX_WINDOW_MS) {
    throw new NardukTimeseriesError(
      'INFLUX_WINDOW_INVALID',
      `A window wider than ${INFLUX_MAX_WINDOW_MS} ms is what OOM-killed the replica host. Narrow it.`,
      { ceiling: INFLUX_MAX_WINDOW_MS, maxWindowMs },
    )
  }
  const startMs = range.start.getTime()
  const endMs = range.end.getTime()
  if (!(endMs > startMs)) {
    throw new NardukTimeseriesError('RANGE_INVALID', 'range.end must be after range.start.')
  }

  const windows: TimeRange[] = []
  for (let cursor = startMs; cursor < endMs; cursor += maxWindowMs) {
    windows.push({
      end: new Date(Math.min(cursor + maxWindowMs, endMs)),
      start: new Date(cursor),
    })
  }
  return windows
}

/**
 * Reject a query whose shape can take the replica host down, and one that
 * carries a credential.
 *
 * The token check is not theatre: a Flux file with an inlined token is how a
 * secret gets committed, and this is the one place every parity query passes
 * through.
 */
export function assertHostSafeFlux(flux: string): string {
  if (typeof flux !== 'string' || flux.trim().length === 0) {
    throw new NardukTimeseriesError('FLUX_UNSAFE', 'The Flux query is empty.')
  }
  if (/\btoken\b/iu.test(flux)) {
    throw new NardukTimeseriesError(
      'FLUX_UNSAFE',
      'The Flux query mentions a token. This adapter never carries a credential: the caller injects an authenticated client.',
    )
  }
  if (!flux.includes('aggregateWindow')) {
    throw new NardukTimeseriesError(
      'FLUX_UNSAFE',
      'The Flux query has no aggregateWindow. An unreduced parity read is what OOM-killed the replica host.',
    )
  }

  const groupIndex = flux.indexOf('group(')
  const aggregateIndex = flux.indexOf('aggregateWindow')
  if (groupIndex !== -1 && groupIndex < aggregateIndex) {
    throw new NardukTimeseriesError(
      'FLUX_UNSAFE',
      'group() appears before aggregateWindow. Reduce per series first, then regroup.',
      { aggregateIndex, groupIndex },
    )
  }
  return flux
}

export function renderFluxWindow(flux: string, window: TimeRange): string {
  return flux
    .replaceAll(':start:', window.start.toISOString())
    .replaceAll(':end:', window.end.toISOString())
}

/**
 * Run one query per window, in sequence, and concatenate the rows.
 *
 * Sequential on purpose. The point of windowing is to bound the replica's peak
 * memory; firing the windows concurrently would restore exactly the load the
 * windowing exists to avoid.
 */
export async function readWindowed(request: InfluxWindowedRead): Promise<unknown[]> {
  assertHostSafeFlux(request.flux)
  const windows = splitRangeIntoWindows(request.range, request.maxWindowMs)
  const timeoutMs = request.timeoutMs ?? INFLUX_TIMEOUT_MS
  if (timeoutMs > INFLUX_TIMEOUT_MS) {
    throw new NardukTimeseriesError(
      'INFLUX_WINDOW_INVALID',
      `The parity read timeout is capped at ${INFLUX_TIMEOUT_MS} ms.`,
      { ceiling: INFLUX_TIMEOUT_MS, timeoutMs },
    )
  }

  const rows: unknown[] = []
  for (const window of windows) {
    const result = await request.client.query(renderFluxWindow(request.flux, window), {
      timeoutMs,
    })
    rows.push(...result)
  }
  return rows
}
