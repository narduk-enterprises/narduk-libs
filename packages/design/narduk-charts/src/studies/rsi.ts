/** Wilder-smoothed RSI (same recursion as many trading platforms). */
export function rsi(closes: number[], period = 14): (number | null)[] {
  const p = Math.max(1, Math.floor(period))
  const out: (number | null)[] = closes.map(() => null)
  if (closes.length < p + 1) return out

  let gain = 0
  let loss = 0
  for (let i = 1; i <= p; i++) {
    const ch = closes[i]! - closes[i - 1]!
    if (ch >= 0) gain += ch
    else loss -= ch
  }
  let avgG = gain / p
  let avgL = loss / p

  const rsiAt = (g: number, l: number) => {
    if (l === 0 && g === 0) return 50
    if (l === 0) return 100
    const rs = g / l
    return 100 - 100 / (1 + rs)
  }

  out[p] = rsiAt(avgG, avgL)

  for (let i = p + 1; i < closes.length; i++) {
    const ch = closes[i]! - closes[i - 1]!
    const g = ch > 0 ? ch : 0
    const l = ch < 0 ? -ch : 0
    avgG = (avgG * (p - 1) + g) / p
    avgL = (avgL * (p - 1) + l) / p
    out[i] = rsiAt(avgG, avgL)
  }
  return out
}
