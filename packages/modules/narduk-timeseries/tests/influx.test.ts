/**
 * The Influx parity reader.
 *
 * This adapter exists for one job -- reading the old stack during a dual run --
 * and its whole value is the shape it refuses. The host-safe rules are the ones
 * that kept the replica alive: bounded windows, a reduction before any regroup,
 * a capped timeout, and no credential anywhere near this module.
 */
import { describe, expect, it, vi } from 'vitest'

import {
  INFLUX_MAX_WINDOW_MS,
  INFLUX_TIMEOUT_MS,
  assertHostSafeFlux,
  readWindowed,
  renderFluxWindow,
  splitRangeIntoWindows,
} from '../src/influx.js'

const SAFE_FLUX = `from(bucket: "telemetry")
  |> range(start: :start:, stop: :end:)
  |> aggregateWindow(every: 1m, fn: mean)
  |> group(columns: ["vessel"])`

const RANGE = {
  end: new Date('2026-09-21T00:00:00.000Z'),
  start: new Date('2026-09-01T00:00:00.000Z'),
}

describe('splitRangeIntoWindows', () => {
  it('splits a 20-day range into contiguous windows no wider than four days', () => {
    const windows = splitRangeIntoWindows(RANGE)
    expect(windows).toHaveLength(5)
    expect(windows[0]!.start).toEqual(RANGE.start)
    expect(windows.at(-1)!.end).toEqual(RANGE.end)
    for (const [index, window] of windows.entries()) {
      expect(window.end.getTime() - window.start.getTime()).toBeLessThanOrEqual(
        INFLUX_MAX_WINDOW_MS,
      )
      if (index > 0) expect(window.start).toEqual(windows[index - 1]!.end)
    }
  })

  it('refuses a window wider than the host-safe ceiling', () => {
    expect(() => splitRangeIntoWindows(RANGE, INFLUX_MAX_WINDOW_MS + 1)).toThrow(/window/iu)
  })
})

describe('assertHostSafeFlux', () => {
  it('accepts a reduced, regrouped query', () => {
    expect(assertHostSafeFlux(SAFE_FLUX)).toBe(SAFE_FLUX)
  })

  it('refuses an unreduced query', () => {
    expect(() => assertHostSafeFlux('from(bucket: "telemetry") |> range(start: -1d)')).toThrow(
      /aggregateWindow/u,
    )
  })

  it('refuses group() before the reduction', () => {
    expect(() =>
      assertHostSafeFlux(
        'from(b) |> group(columns: ["v"]) |> aggregateWindow(every: 1m, fn: mean)',
      ),
    ).toThrow(/group\(\) appears before/u)
  })

  // The adapter never holds a credential: the caller injects an authenticated
  // client. A query that names a token is a query that is about to inline one.
  it('refuses a query that so much as mentions a token', () => {
    expect(() =>
      assertHostSafeFlux('token: "redacted" |> aggregateWindow(every: 1m, fn: mean)'),
    ).toThrow(/token/iu)
  })

  it('refuses an empty query', () => {
    expect(() => assertHostSafeFlux('   ')).toThrow(/empty/u)
  })
})

describe('readWindowed', () => {
  it('runs one capped query per window, in order, and concatenates', async () => {
    const seen: string[] = []
    const query = vi.fn(async (flux: string, options: { timeoutMs: number }) => {
      expect(options.timeoutMs).toBe(INFLUX_TIMEOUT_MS)
      seen.push(flux)
      return [{ index: seen.length }]
    })

    const rows = await readWindowed({ client: { query }, flux: SAFE_FLUX, range: RANGE })

    expect(query).toHaveBeenCalledTimes(5)
    expect(rows).toHaveLength(5)
    expect(seen[0]).toContain('2026-09-01T00:00:00.000Z')
    expect(seen[0]).not.toContain(':start:')
    expect(seen.at(-1)).toContain('2026-09-21T00:00:00.000Z')
  })

  it('refuses a timeout above the host-safe cap', async () => {
    await expect(
      readWindowed({
        client: { query: async () => [] },
        flux: SAFE_FLUX,
        range: RANGE,
        timeoutMs: INFLUX_TIMEOUT_MS + 1,
      }),
    ).rejects.toThrow(/timeout/iu)
  })

  it('validates the query before opening a single connection', async () => {
    const query = vi.fn(async () => [])
    await expect(
      readWindowed({ client: { query }, flux: 'from(b) |> range(start: -1d)', range: RANGE }),
    ).rejects.toThrow(/aggregateWindow/u)
    expect(query).not.toHaveBeenCalled()
  })
})

describe('renderFluxWindow', () => {
  it('substitutes every marker occurrence', () => {
    const rendered = renderFluxWindow(':start: :end: :start:', {
      end: new Date('2026-09-02T00:00:00.000Z'),
      start: new Date('2026-09-01T00:00:00.000Z'),
    })
    expect(rendered).toBe(
      '2026-09-01T00:00:00.000Z 2026-09-02T00:00:00.000Z 2026-09-01T00:00:00.000Z',
    )
  })
})

describe('cancellation', () => {
  it('stops at the next window boundary and hands the signal to the client', async () => {
    // A year-long parity run is 92 sequential queries at up to two minutes
    // each; without a signal a cancelled job keeps loading the replica host.
    const controller = new AbortController()
    const seen: Array<AbortSignal | undefined> = []
    const query = vi.fn(async (_flux: string, options: { signal?: AbortSignal }) => {
      seen.push(options.signal)
      controller.abort()
      return []
    })

    await expect(
      readWindowed({
        client: { query },
        flux: 'from(b) |> range(start: :start:, stop: :end:) |> aggregateWindow(every: 1m, fn: mean)',
        range: { end: new Date('2026-09-21T00:00:00.000Z'), start: new Date('2026-09-01T00:00:00.000Z') },
        signal: controller.signal,
      }),
    ).rejects.toThrow()

    expect(query).toHaveBeenCalledTimes(1)
    expect(seen[0]).toBe(controller.signal)
  })

  it('refuses before the first window when the signal is already aborted', async () => {
    const query = vi.fn(async () => [])
    await expect(
      readWindowed({
        client: { query },
        flux: 'from(b) |> range(start: :start:, stop: :end:) |> aggregateWindow(every: 1m, fn: mean)',
        range: { end: new Date('2026-09-02T00:00:00.000Z'), start: new Date('2026-09-01T00:00:00.000Z') },
        signal: AbortSignal.abort(),
      }),
    ).rejects.toThrow()
    expect(query).not.toHaveBeenCalled()
  })
})
