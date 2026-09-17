/**
 * Retention-policy validation.
 *
 * A retention policy is the one input to this library that deletes data, so an
 * incoherent one is refused rather than half-applied. The rules, each of which
 * is a real way to lose history by accident:
 *
 *  - **A tier's raw window may not exceed the global raw window.** Round 20
 *    chose one short global raw window with tiers enforced above the raw level
 *    (option 1A); a tier claiming 90 days of raw against a 7-day global window
 *    is a policy that reads as a promise and behaves as a lie.
 *  - **A tier's rollup depth may not exceed that level's global window.**
 *    Rollups are retained globally per level and tier depth is enforced on
 *    read, so a tier promising a year of 1h rows against a 90-day global 1h
 *    window is the same lie one level up.
 *  - **The rollup ladder must not narrow as it coarsens**, in the global
 *    windows and within every tier. Keeping 1-minute rows for a year and
 *    hourly rows for a month deletes the summary while retaining the detail it
 *    summarizes, which is the opposite of a ladder.
 *  - **Every window must be a positive, finite number of milliseconds.** A
 *    zero or a NaN that reaches a `DELETE ... WHERE ts < now() - $1` deletes
 *    everything or nothing, and neither failure announces itself.
 *
 * What the validator does NOT do is invent a window. A rollup level with no
 * global window is never swept -- a deliberate choice for a level a product
 * wants to keep indefinitely -- so it is *reported*, in
 * `unsweptRollupLevels`, and the sweep repeats that in
 * `RetentionResult.skipped`. Silence there was the bug: "1d is missing from
 * the policy" and "1d is kept forever" looked identical from the outside.
 */

import { clampRetentionNow } from './clock.js'
import { NardukTimeseriesError } from './errors.js'
import { ROLLUP_BUCKETS, type RetentionPolicyInput, type RollupBucket } from './types.js'

export const DEFAULT_MAX_VESSELS_PER_STATEMENT = 1000

export interface ValidatedRetentionPolicy extends RetentionPolicyInput {
  maxVesselsPerStatement: number
  now: Date
  /** Rollup levels with no global window: retained indefinitely, never swept. */
  unsweptRollupLevels: RollupBucket[]
}

function assertWindow(label: string, value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new NardukTimeseriesError(
      'RETENTION_POLICY_INVALID',
      `${label} must be a positive, finite number of milliseconds.`,
      { label, value },
    )
  }
  return value
}

/** A coarser level must never be dropped before the finer level it summarizes. */
function assertLadder(label: string, windows: Partial<Record<RollupBucket, number>>): void {
  let previous: { bucket: RollupBucket; window: number } | null = null
  for (const bucket of ROLLUP_BUCKETS) {
    const window = windows[bucket]
    if (window === undefined) continue
    assertWindow(`${label}.${bucket}`, window)
    if (previous && window < previous.window) {
      throw new NardukTimeseriesError(
        'RETENTION_POLICY_INVALID',
        `${label} keeps ${previous.bucket} rollups for longer than ${bucket} rollups. A coarser level must not be dropped before the finer level it summarizes.`,
        { coarser: bucket, finer: previous.bucket, label },
      )
    }
    previous = { bucket, window }
  }
}

export function validateRetentionPolicy(policy: RetentionPolicyInput): ValidatedRetentionPolicy {
  const globalRawWindowMs = assertWindow('globalRawWindowMs', policy.globalRawWindowMs)

  const globalRollupWindowMs = policy.globalRollupWindowMs ?? {}
  assertLadder('globalRollupWindowMs', globalRollupWindowMs)
  const unsweptRollupLevels = ROLLUP_BUCKETS.filter(
    (bucket) => globalRollupWindowMs[bucket] === undefined,
  )

  const maxVesselsPerStatement = policy.maxVesselsPerStatement ?? DEFAULT_MAX_VESSELS_PER_STATEMENT
  if (!Number.isInteger(maxVesselsPerStatement) || maxVesselsPerStatement <= 0) {
    throw new NardukTimeseriesError(
      'RETENTION_POLICY_INVALID',
      'maxVesselsPerStatement must be a positive integer.',
      { maxVesselsPerStatement },
    )
  }

  for (const [tierName, tier] of Object.entries(policy.tiers)) {
    if (!Array.isArray(tier.vesselIds)) {
      throw new NardukTimeseriesError(
        'RETENTION_POLICY_INVALID',
        `Tier ${tierName} has no vesselIds array. Tier membership is the caller's.`,
        { tier: tierName },
      )
    }

    if (tier.rawWindowMs !== undefined) {
      const raw = assertWindow(`tiers.${tierName}.rawWindowMs`, tier.rawWindowMs)
      if (raw > globalRawWindowMs) {
        throw new NardukTimeseriesError(
          'RETENTION_POLICY_INVALID',
          `Tier ${tierName} asks for ${raw} ms of raw history, more than the global raw window of ${globalRawWindowMs} ms. Raise the global window or lower the tier.`,
          { globalRawWindowMs, rawWindowMs: raw, tier: tierName },
        )
      }
    }

    if (tier.trackWindowMs !== undefined) {
      assertWindow(`tiers.${tierName}.trackWindowMs`, tier.trackWindowMs)
    }

    assertLadder(`tiers.${tierName}.rollupWindowMs`, tier.rollupWindowMs)

    for (const bucket of ROLLUP_BUCKETS) {
      const window = tier.rollupWindowMs[bucket]
      const global = globalRollupWindowMs[bucket]
      if (window === undefined || global === undefined) continue
      if (window > global) {
        throw new NardukTimeseriesError(
          'RETENTION_POLICY_INVALID',
          `Tier ${tierName} asks for ${window} ms of ${bucket} rollups, more than the global ${bucket} window of ${global} ms. Rollups are retained globally and clipped per tier on read, so the global window must cover the most generous tier.`,
          { bucket, globalWindowMs: global, tier: tierName, tierWindowMs: window },
        )
      }
    }
  }

  return {
    ...policy,
    globalRollupWindowMs,
    maxVesselsPerStatement,
    // A future `now` must not deepen deletes; a past `now` may only retract them.
    now: clampRetentionNow(policy.now),
    unsweptRollupLevels,
  }
}

/**
 * A stable digest of what a validated policy would do, excluding `now`.
 *
 * The retention single-flight is keyed on this rather than on "a sweep is
 * running": two schedulers with *different* policies are two different
 * operations, and collapsing the second onto the first returned a result
 * describing deletions the caller never asked for. `now` is excluded on
 * purpose -- a policy is the same policy a minute later.
 *
 * FNV-1a over a canonical serialization, not a cryptographic hash: this is a
 * cache key, and reaching for `node:crypto` here would pull Node built-ins
 * into a module a Worker bundle can otherwise carry.
 */
export function retentionPolicyIdentity(policy: ValidatedRetentionPolicy): string {
  const canonical = JSON.stringify([
    policy.globalRawWindowMs,
    ROLLUP_BUCKETS.map((bucket) => policy.globalRollupWindowMs?.[bucket] ?? null),
    policy.maxVesselsPerStatement,
    Object.keys(policy.tiers)
      .sort()
      .map((name) => {
        const tier = policy.tiers[name]
        return [
          name,
          tier === undefined ? null : (tier.rawWindowMs ?? null),
          tier === undefined ? null : (tier.trackWindowMs ?? null),
          tier === undefined ? [] : ROLLUP_BUCKETS.map((b) => tier.rollupWindowMs[b] ?? null),
          tier === undefined ? [] : [...tier.vesselIds].sort(),
        ]
      }),
  ])

  let hash = 0x81_1c_9d_c5
  for (let index = 0; index < canonical.length; index += 1) {
    hash ^= canonical.charCodeAt(index)
    hash = Math.imul(hash, 0x01_00_01_93) >>> 0
  }
  return `${hash.toString(16).padStart(8, '0')}-${canonical.length.toString(16)}`
}
