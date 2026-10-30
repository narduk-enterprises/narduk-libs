/**
 * `clamp` and `median`, which five apps each wrote for themselves. Import from
 * `@narduk-enterprises/narduk-core/shared/utils/numbers`; nothing here is
 * auto-imported.
 */

/**
 * `value` held inside `[min, max]`. A `NaN` value stays `NaN` rather than
 * becoming a bound, so a missing reading is never silently drawn at an edge.
 */
export function clamp(value: number, min: number, max: number): number {
  if (min > max) throw new RangeError(`clamp: min (${min}) is greater than max (${max})`)
  return Math.min(max, Math.max(min, value))
}

/**
 * The median of the finite numbers in `values`, or `null` when there are
 * none. Non-finite entries (`NaN`, `±Infinity`) are skipped, not counted. The
 * input is not mutated.
 */
export function median(values: Iterable<number>): number | null {
  const sorted = [...values].filter((value) => Number.isFinite(value)).sort((a, b) => a - b)
  if (sorted.length === 0) return null
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1
    ? (sorted[middle] as number)
    : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2
}
