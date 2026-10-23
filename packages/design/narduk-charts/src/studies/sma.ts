/**
 * Simple moving average over closing values (or any aligned series). A window that holds a
 * non-finite value yields `null`, and the value stops counting once it leaves the window.
 */
export function sma(values: number[], period: number): Array<number | null> {
  const p = Math.max(1, Math.floor(period))
  const out: Array<number | null> = []
  let sum = 0
  let bad = 0
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!
    if (Number.isFinite(v)) sum += v
    else bad++
    if (i >= p) {
      const old = values[i - p]!
      if (Number.isFinite(old)) sum -= old
      else bad--
    }
    out.push(i >= p - 1 && bad === 0 ? sum / p : null)
  }
  return out
}
