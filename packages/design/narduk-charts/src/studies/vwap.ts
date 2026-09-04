import type { CandleBar } from '../types'

/** Session cumulative VWAP using typical price × volume. Bars without `v` repeat last VWAP. */
export function vwap(bars: CandleBar[]): (number | null)[] {
  const out: (number | null)[] = []
  let cumTpV = 0
  let cumV = 0
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i]!
    const v = b.v
    if (v != null && v > 0) {
      const tp = (b.h + b.l + b.c) / 3
      cumTpV += tp * v
      cumV += v
    }
    out.push(cumV > 0 ? cumTpV / cumV : null)
  }
  return out
}
