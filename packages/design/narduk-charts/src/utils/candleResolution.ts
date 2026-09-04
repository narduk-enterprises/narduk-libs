import type { CandleBar } from '../types'

/** Calendar-style bar intervals (UTC bucket starts via `Math.floor(t / ms) * ms`). */
export type CandleResolutionId = '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1D'

export const CANDLE_RESOLUTION_MS: Record<CandleResolutionId, number> = {
  '1m': 60_000,
  '5m': 5 * 60_000,
  '15m': 15 * 60_000,
  '30m': 30 * 60_000,
  '1h': 60 * 60_000,
  '4h': 4 * 60 * 60_000,
  '1D': 86_400_000,
}

export const CANDLE_RESOLUTION_LABEL: Record<CandleResolutionId, string> = {
  '1m': '1 minute',
  '5m': '5 minutes',
  '15m': '15 minutes',
  '30m': '30 minutes',
  '1h': '1 hour',
  '4h': '4 hours',
  '1D': '1 day',
}

export function resolutionMsFromId(id: CandleResolutionId): number {
  return CANDLE_RESOLUTION_MS[id]
}

/**
 * Merge sorted OHLC bars into fixed-width time buckets (UTC).
 * First bar in a bucket sets `o`; `h`/`l`/`c` aggregate; `v` sums when present.
 */
export function aggregateCandlesToResolution(
  bars: CandleBar[],
  resolutionMs: number,
): CandleBar[] {
  if (bars.length === 0 || resolutionMs <= 0) return []
  const sorted = [...bars].sort((a, b) => a.t - b.t)
  const out: CandleBar[] = []
  let curKey: number | null = null
  let acc: CandleBar | null = null

  for (const b of sorted) {
    const key = Math.floor(b.t / resolutionMs) * resolutionMs
    if (curKey === null || key !== curKey) {
      if (acc) out.push(acc)
      curKey = key
      acc = {
        t: key,
        o: b.o,
        h: b.h,
        l: b.l,
        c: b.c,
        v: b.v,
      }
    }
    else if (acc) {
      acc.h = Math.max(acc.h, b.h)
      acc.l = Math.min(acc.l, b.l)
      acc.c = b.c
      if (b.v != null) acc.v = (acc.v ?? 0) + b.v
    }
  }
  if (acc) out.push(acc)
  return out
}
