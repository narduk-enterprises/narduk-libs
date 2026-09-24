import {
  evaluateFreshness,
  FRESHNESS_CHECK_KIND,
  type FreshnessReading,
  type FreshnessThresholds,
  unreadableFreshnessOutcome,
} from '../health/freshness'

import { registerHealthCheck } from './health-checks'
import { useLogger } from './logger'

import type { HealthCheckContext, HealthCheckOutcome } from '../health/checks'

export { FRESHNESS_CHECK_KIND } from '../health/freshness'
export type {
  FreshnessFailureReason,
  FreshnessReading,
  FreshnessThresholds,
} from '../health/freshness'

/** Longest age either threshold may name: 365 days, in seconds. */
export const MAX_FRESHNESS_THRESHOLD_SECONDS = 365 * 24 * 60 * 60
/** Longest `source` label a check may publish. */
export const MAX_FRESHNESS_SOURCE_LENGTH = 128

export interface FreshnessCheckDefinition extends FreshnessThresholds {
  /** The health-check name: 1-63 lowercase letters, digits or hyphens. */
  name: string
  /** Epoch-millisecond clock, injected by tests. Defaults to `Date.now`. */
  now?: () => number
  /** Read the newest timestamp this app has published for `source`. */
  read: (context: HealthCheckContext) => FreshnessReading | Promise<FreshnessReading>
  /**
   * Which upstream feed this check watches, published in `detail.source` so one
   * app can register a check per feed. 1-128 characters.
   */
  source: string
  /** Defaults to 3000 ms; at most 30000 ms. A read that runs out of time fails. */
  timeoutMs?: number
}

function assertThresholdSeconds(name: string, label: string, value: number | undefined): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new TypeError(
      `[narduk-core] Freshness check '${name}' ${label} must be a positive number of seconds.`,
    )
  }
  if (value > MAX_FRESHNESS_THRESHOLD_SECONDS) {
    throw new TypeError(
      `[narduk-core] Freshness check '${name}' ${label} must be at most ${MAX_FRESHNESS_THRESHOLD_SECONDS} seconds.`,
    )
  }
}

/**
 * Report how stale an app's published data is, as a registered `/api/health`
 * check.
 *
 * The check reads one timestamp, compares its age against `warnAfter` and the
 * optional `failAfter`, and publishes the result with a stable
 * `kind: 'freshness'` so an uptime detector can pick freshness out of the
 * `checks` array without knowing app-chosen names.
 *
 * - Fresh enough: `result: 'pass'`, and `detail` still carries `observedAt` and
 *   `ageSeconds` so a dashboard can plot age while everything is fine.
 * - Older than the optional `noticeAfter`: `result: 'fail'` with
 *   `notice: true`, and the report's `status` is unchanged. Nothing pages.
 * - Older than `warnAfter`: `result: 'fail'` with `required: false`, so the
 *   report is `degraded` and `/api/health` still answers HTTP 200. That is not
 *   harmless: a monitor matching `"status":"ok"` -- the estate uptime detector
 *   -- reads `degraded` as down and pages as hard as it does for `error`
 *   (narduk-libs#414). Set `warnAfter` to the age that deserves a page.
 * - Older than `failAfter`: `result: 'fail'` with `required: true`, so the
 *   report is `error` and `/api/health` answers HTTP 503. Without `failAfter` a
 *   freshness check can never reach that state.
 * - No timestamp, an unparseable one, a `read` that throws, or a `read` that
 *   runs out of time: the check **fails closed** at the strongest severity its
 *   thresholds allow, with a `detail.reason` saying which. It never passes for
 *   want of evidence. The underlying error goes to the server log only.
 *
 * Seconds, everywhere: `noticeAfter`, `warnAfter` and `failAfter` are seconds, while a numeric
 * `at` is epoch milliseconds (the units `Date.now()` uses).
 *
 * @example
 * ```ts
 * // server/plugins/health-checks.ts
 * export default defineNitroPlugin(() => {
 *   registerFreshnessCheck({
 *     name: 'observations-freshness',
 *     source: 'ndbc-realtime-observations',
 *     warnAfter: 45 * 60,
 *     failAfter: 6 * 60 * 60,
 *     timeoutMs: 30_000,
 *     async read() {
 *       const { product } = await readCachedPublishedBuoyStatus()
 *       return { at: product.freshness.asOf, detail: { state: product.freshness.state } }
 *     },
 *   })
 * })
 * ```
 *
 * @returns A function that removes this check again.
 */
export function registerFreshnessCheck(definition: FreshnessCheckDefinition): () => void {
  if (definition === null || typeof definition !== 'object') {
    throw new TypeError('[narduk-core] registerFreshnessCheck expects a check definition object.')
  }
  const {
    failAfter,
    name,
    noticeAfter,
    now = Date.now,
    read,
    source,
    timeoutMs,
    warnAfter,
  } = definition
  // `name` and `timeoutMs` are validated by registerHealthCheck below; the
  // label here only has to be safe to interpolate into these messages.
  const label = typeof name === 'string' ? name : JSON.stringify(name)

  if (
    typeof source !== 'string' ||
    source.length === 0 ||
    source.length > MAX_FRESHNESS_SOURCE_LENGTH
  ) {
    throw new TypeError(
      `[narduk-core] Freshness check '${label}' source must be a string of 1-${MAX_FRESHNESS_SOURCE_LENGTH} characters.`,
    )
  }
  if (typeof read !== 'function') {
    throw new TypeError(`[narduk-core] Freshness check '${label}' needs a read function.`)
  }
  if (typeof now !== 'function') {
    throw new TypeError(`[narduk-core] Freshness check '${label}' now must be a function.`)
  }
  assertThresholdSeconds(label, 'warnAfter', warnAfter)
  if (failAfter !== undefined) {
    assertThresholdSeconds(label, 'failAfter', failAfter)
    if (failAfter < warnAfter) {
      throw new TypeError(
        `[narduk-core] Freshness check '${label}' failAfter (${failAfter}s) must be at least warnAfter (${warnAfter}s).`,
      )
    }
  }

  if (noticeAfter !== undefined) {
    assertThresholdSeconds(label, 'noticeAfter', noticeAfter)
    if (noticeAfter > warnAfter) {
      throw new TypeError(
        `[narduk-core] Freshness check '${label}' noticeAfter (${noticeAfter}s) must be at most warnAfter (${warnAfter}s).`,
      )
    }
  }

  const thresholds: FreshnessThresholds = {
    ...(noticeAfter === undefined ? {} : { noticeAfter }),
    warnAfter,
    ...(failAfter === undefined ? {} : { failAfter }),
  }

  return registerHealthCheck({
    kind: FRESHNESS_CHECK_KIND,
    name,
    // The declared ceiling. Only a check with failAfter may ever reach HTTP 503,
    // and a warn-level failure lowers that one entry back down to `degraded`.
    required: failAfter !== undefined,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    async run(context): Promise<HealthCheckOutcome> {
      let reading: FreshnessReading | null | undefined
      try {
        reading = await read(context)
      } catch (error) {
        useLogger(context.event)
          .child('Health')
          .error('Freshness check could not read its source', {
            check: label,
            source,
            error: String(error),
          })
        return unreadableFreshnessOutcome(thresholds, source)
      }
      return evaluateFreshness({
        ...thresholds,
        at: reading?.at,
        detail: reading?.detail,
        now: now(),
        source,
      })
    },
  })
}
