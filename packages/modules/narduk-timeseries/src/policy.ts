/**
 * Retention-policy validation.
 *
 * A retention policy is the one input to this library that deletes data, so an
 * incoherent one is refused rather than half-applied. Three rules, each of
 * which is a real way to lose history by accident:
 *
 *  - **A tier's raw window may not exceed the global raw window.** Round 20
 *    chose one short global raw window with tiers enforced on the rollups
 *    (option 1A); a tier claiming 90 days of raw against a 7-day global window
 *    is a policy that reads as a promise and behaves as a lie.
 *  - **The rollup ladder must not narrow as it coarsens.** Keeping 1-minute
 *    rows for a year and hourly rows for a month deletes the summary while
 *    retaining the detail it summarizes, which is the opposite of a ladder.
 *  - **Every window must be a positive, finite number of milliseconds.** A
 *    zero or a NaN that reaches a `DELETE ... WHERE ts < now() - $1` deletes
 *    everything or nothing, and neither failure announces itself.
 */

import { NardukTimeseriesError } from './errors.js'
import { ROLLUP_BUCKETS, type RetentionPolicyInput, type RollupBucket } from './types.js'

export const DEFAULT_MAX_VESSELS_PER_STATEMENT = 1000

export interface ValidatedRetentionPolicy extends RetentionPolicyInput {
  maxVesselsPerStatement: number
  now: Date
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

export function validateRetentionPolicy(policy: RetentionPolicyInput): ValidatedRetentionPolicy {
  const globalRawWindowMs = assertWindow('globalRawWindowMs', policy.globalRawWindowMs)

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

    let previous: { bucket: RollupBucket; window: number } | null = null
    for (const bucket of ROLLUP_BUCKETS) {
      const window = tier.rollupWindowMs[bucket]
      if (window === undefined) continue
      assertWindow(`tiers.${tierName}.rollupWindowMs.${bucket}`, window)
      if (previous && window < previous.window) {
        throw new NardukTimeseriesError(
          'RETENTION_POLICY_INVALID',
          `Tier ${tierName} keeps ${previous.bucket} rollups for longer than ${bucket} rollups. A coarser level must not be dropped before the finer level it summarizes.`,
          { coarser: bucket, finer: previous.bucket, tier: tierName },
        )
      }
      previous = { bucket, window }
    }
  }

  return {
    ...policy,
    maxVesselsPerStatement,
    now: policy.now ?? new Date(),
  }
}
