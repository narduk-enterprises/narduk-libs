/**
 * Effective clocks for the two operations that treat `now` as a security
 * boundary, not just a test hook.
 *
 * `RollupQuery.now` and `RetentionPolicyInput.now` are both documented as
 * deterministic-test injectors, and both sit on public input types a handler
 * can populate from a client body. They move the same arithmetic
 * (`cutoff = now - windowMs`) in opposite safe directions:
 *
 *  - On **read**, a later clock raises the tier floor and clips more history.
 *    A past `now` is the attack: it slides the only rollup-tier gate backward
 *    and returns unclipped data. The read clock is therefore
 *    `max(real now, supplied now)` -- a supplied value may only tighten.
 *  - On **retention**, a later clock raises every delete cutoff and drops more
 *    rows. A future `now` is the attack. The retention clock is therefore
 *    `min(real now, supplied now)` -- a supplied value may only make cutoffs
 *    earlier (less destructive). A past `now` stays honored, which is how
 *    snapshot tests pin cutoffs and is the safe direction.
 *
 * Neither path needs an `allowClockOverride` hook. Tests that need a frozen
 * *past* read clock freeze `Date` (`vi.setSystemTime`) so `Date.now()` itself
 * is the fixture; a past `now` without a frozen clock is ignored on read, by
 * design.
 */

function suppliedTimeMs(supplied: Date | undefined): number {
  if (!(supplied instanceof Date)) return Number.NaN
  return supplied.getTime()
}

/**
 * Milliseconds used as `now` when computing the rollup-tier read floor.
 *
 * A supplied `now` may only raise this value. A missing, non-Date, or invalid
 * `now` uses real time.
 */
export function clampQueryNowMs(
  supplied: Date | undefined,
  realNowMs: number = Date.now(),
): number {
  const suppliedMs = suppliedTimeMs(supplied)
  if (!Number.isFinite(suppliedMs)) return realNowMs
  return Math.max(realNowMs, suppliedMs)
}

/**
 * Clock used as `now` when computing retention delete cutoffs.
 *
 * A supplied `now` may only lower this value. A missing, non-Date, or invalid
 * `now` uses real time.
 */
export function clampRetentionNow(
  supplied: Date | undefined,
  realNowMs: number = Date.now(),
): Date {
  const suppliedMs = suppliedTimeMs(supplied)
  if (!Number.isFinite(suppliedMs)) return new Date(realNowMs)
  return new Date(Math.min(realNowMs, suppliedMs))
}
