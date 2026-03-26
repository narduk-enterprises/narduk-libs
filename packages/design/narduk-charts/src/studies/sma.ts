/** Simple moving average over closing values (or any aligned series). */
export function sma(values: number[], period: number): (number | null)[] {
  const p = Math.max(1, Math.floor(period))
  const out: (number | null)[] = []
  let sum = 0
  for (let i = 0; i < values.length; i++) {
    sum += values[i]!
    if (i >= p) sum -= values[i - p]!
    out.push(i >= p - 1 ? sum / p : null)
  }
  return out
}
