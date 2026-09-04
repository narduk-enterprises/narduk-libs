/** Exponential moving average; seeds with SMA of first `period` closes. */
export function ema(values: number[], period: number): (number | null)[] {
  const p = Math.max(1, Math.floor(period))
  const alpha = 2 / (p + 1)
  const out: (number | null)[] = new Array(values.length).fill(null)
  if (values.length < p) return out
  let s = 0
  for (let j = 0; j < p; j++) s += values[j]!
  let em = s / p
  out[p - 1] = em
  for (let i = p; i < values.length; i++) {
    em = alpha * values[i]! + (1 - alpha) * em
    out[i] = em
  }
  return out
}
