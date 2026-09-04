import { sma } from './sma'

export interface BollingerBandRow {
  mid: number | null
  upper: number | null
  lower: number | null
}

export function bollinger(closes: number[], period: number, mult = 2): BollingerBandRow[] {
  const p = Math.max(2, Math.floor(period))
  const mid = sma(closes, p)
  const out: BollingerBandRow[] = []
  for (let i = 0; i < closes.length; i++) {
    const m = mid[i]
    if (m === null) {
      out.push({ mid: null, upper: null, lower: null })
      continue
    }
    let sumSq = 0
    for (let j = i - p + 1; j <= i; j++) {
      const d = closes[j]! - m
      sumSq += d * d
    }
    const sd = Math.sqrt(sumSq / p)
    out.push({
      mid: m,
      upper: m + mult * sd,
      lower: m - mult * sd,
    })
  }
  return out
}
