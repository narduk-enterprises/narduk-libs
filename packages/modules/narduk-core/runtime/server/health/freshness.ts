import type { HealthCheckDetail, HealthCheckOutcome, HealthCheckSeverity } from './checks'

/**
 * Age evaluation for data-freshness health checks.
 *
 * This module is internal and side-effect free: apps call
 * `registerFreshnessCheck` from `server/utils/freshness-checks.ts`, which reads
 * the timestamp and hands it here. Keeping the arithmetic separate is what lets
 * the age math, the threshold boundaries, and the fail-closed paths be tested
 * against an injected clock instead of the wall clock.
 */

/** Published verbatim as the report entry's `kind`, so detectors can select these. */
export const FRESHNESS_CHECK_KIND = 'freshness'

/**
 * Why a freshness check failed.
 *
 * - `stale` — the timestamp was read and is older than a threshold.
 * - `missing-timestamp` — the source produced no `at` value at all.
 * - `invalid-timestamp` — `at` was present but is not a usable instant.
 * - `unreadable` — reading the source threw.
 *
 * The last three never pass: a freshness check that cannot prove the data is
 * fresh reports a failure rather than assuming the best.
 */
export type FreshnessFailureReason =
  'invalid-timestamp' | 'missing-timestamp' | 'stale' | 'unreadable'

/** What a freshness check's `read` resolves to. */
export interface FreshnessReading {
  /**
   * When the data was produced. A `Date`, an ISO 8601 string, or epoch
   * **milliseconds** as a number (the units `Date.now()` uses).
   */
  at: Date | number | string | null | undefined
  /**
   * Extra fields to publish beside the computed freshness fields. The freshness
   * fields win on a key collision, and the whole object still goes through the
   * usual `detail` sanitizer (1 KiB, no `status`/`database` keys).
   */
  detail?: HealthCheckDetail
}

export interface FreshnessThresholds {
  /**
   * Seconds of age past which the check fails at `error` severity, making the
   * whole report `error` (HTTP 503). Omitted, the check can never do worse than
   * `degraded`.
   */
  failAfter?: number
  /**
   * Seconds of age past which the check fails at `degraded` severity, leaving
   * the report `degraded` (HTTP 200).
   */
  warnAfter: number
}

export interface FreshnessEvaluationInput extends FreshnessThresholds {
  /** The raw timestamp from the reading, in any accepted form. */
  at: unknown
  /** Extra detail from the reading, merged under the computed fields. */
  detail?: unknown
  /** `Date.now()`-style epoch milliseconds, injected so tests own the clock. */
  now: number
  /** Which feed this check watches; published so one app can run several. */
  source: string
}

/** The strongest severity a set of thresholds can ever report. */
export function worstFreshnessSeverity(thresholds: FreshnessThresholds): HealthCheckSeverity {
  return thresholds.failAfter === undefined ? 'degraded' : 'error'
}

/**
 * `undefined` means no timestamp was supplied; `null` means one was supplied
 * but is not a usable instant. Both fail, with different reasons.
 */
function toEpochMs(at: unknown): number | null | undefined {
  if (at === undefined || at === null) {
    return undefined
  }
  if (at instanceof Date) {
    const epoch = at.getTime()
    return Number.isNaN(epoch) ? null : epoch
  }
  if (typeof at === 'number') {
    return Number.isFinite(at) ? at : null
  }
  if (typeof at === 'string') {
    const epoch = Date.parse(at)
    return Number.isNaN(epoch) ? null : epoch
  }
  return null
}

function isPlainDetail(value: unknown): value is HealthCheckDetail {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function baseDetail(thresholds: FreshnessThresholds, source: string): HealthCheckDetail {
  return {
    source,
    warnAfterSeconds: thresholds.warnAfter,
    failAfterSeconds: thresholds.failAfter ?? null,
  }
}

/**
 * Build the failing outcome for a source whose timestamp could not be read.
 * Exported so the register helper reports a thrown `read` the same way this
 * module reports a missing or unparseable one.
 */
export function unreadableFreshnessOutcome(
  thresholds: FreshnessThresholds,
  source: string,
  reason: FreshnessFailureReason = 'unreadable',
): HealthCheckOutcome {
  return {
    ok: false,
    severity: worstFreshnessSeverity(thresholds),
    detail: { ...baseDetail(thresholds, source), reason },
  }
}

/**
 * Compare one reading against its thresholds.
 *
 * A timestamp in the future is never stale — a clock skew between the producer
 * and this Worker is reported as a negative `ageSeconds` rather than treated as
 * a freshness failure. `ageSeconds` is rounded to the nearest second for
 * publication, while the thresholds are compared at full millisecond precision
 * so a check does not flap across a rounding boundary.
 */
export function evaluateFreshness(input: FreshnessEvaluationInput): HealthCheckOutcome {
  const epoch = toEpochMs(input.at)
  if (epoch === undefined || epoch === null) {
    return unreadableFreshnessOutcome(
      input,
      input.source,
      epoch === undefined ? 'missing-timestamp' : 'invalid-timestamp',
    )
  }

  const ageMs = input.now - epoch
  const detail: HealthCheckDetail = {
    ...(isPlainDetail(input.detail) ? input.detail : {}),
    ...baseDetail(input, input.source),
    observedAt: new Date(epoch).toISOString(),
    ageSeconds: Math.round(ageMs / 1000),
  }

  if (input.failAfter !== undefined && ageMs > input.failAfter * 1000) {
    return { ok: false, severity: 'error', detail: { ...detail, reason: 'stale' } }
  }
  if (ageMs > input.warnAfter * 1000) {
    return { ok: false, severity: 'degraded', detail: { ...detail, reason: 'stale' } }
  }
  return { detail }
}
