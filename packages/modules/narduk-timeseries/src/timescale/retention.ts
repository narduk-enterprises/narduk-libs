/**
 * Retention, as a plan you can read before it deletes anything.
 *
 * `buildRetentionStatements` is pure: policy in, an ordered list of statements
 * out, each labelled with the target it touches. That is what makes retention
 * reviewable -- a snapshot test shows exactly which tables a policy sweeps and
 * with which cutoffs, and the nightly job can log the plan before running it.
 *
 * Three shapes, for three different costs:
 *
 *  - **Global raw** uses `drop_chunks`, which unlinks whole chunks. It is the
 *    cheap operation and it is why docs/13 says per-tier deletes run against
 *    the aggregates rather than against compressed raw chunks.
 *  - **Per-tier rollups and track** are row deletes against small tables,
 *    chunked by vessel so one statement never carries an unbounded array.
 *  - **Per-tier raw**, which exists only because round 20 chose both a 7-day
 *    global raw window (1A) and a 24-hour Free raw window (2B). That is a row
 *    delete against a hypertable whose older chunks are compressed, so it is
 *    the expensive one; it is emitted only for a tier that declares
 *    `rawWindowMs`, and the README says plainly what it costs.
 */

import { NardukTimeseriesError } from '../errors.js'
import { validateRetentionPolicy } from '../policy.js'
import { ROLLUP_BUCKETS, type RetentionPolicyInput } from '../types.js'
import { NUMERIC_TABLE, TRACK_TABLE, rollupTable } from './tables.js'

export interface RetentionStatement {
  /** `drop_chunks` unlinks chunks; `delete` removes rows. */
  kind: 'drop_chunks' | 'delete'
  params: unknown[]
  /** The table or view this statement touches, for the result breakdown. */
  target: string
  text: string
  /** null for the global statement. */
  tier: string | null
}

function chunkVessels(vesselIds: readonly string[], size: number): string[][] {
  const chunks: string[][] = []
  for (let index = 0; index < vesselIds.length; index += size) {
    chunks.push([...vesselIds.slice(index, index + size)])
  }
  return chunks
}

function cutoff(now: Date, windowMs: number): Date {
  return new Date(now.getTime() - windowMs)
}

export function buildRetentionStatements(policy: RetentionPolicyInput): RetentionStatement[] {
  const validated = validateRetentionPolicy(policy)
  const statements: RetentionStatement[] = []

  statements.push({
    kind: 'drop_chunks',
    params: [cutoff(validated.now, validated.globalRawWindowMs)],
    target: NUMERIC_TABLE,
    text: `SELECT drop_chunks('${NUMERIC_TABLE}', older_than => $1::timestamptz)`,
    tier: null,
  })

  // Tier order is the caller's declaration order, kept stable so the plan is
  // byte-comparable between runs.
  for (const [tierName, tier] of Object.entries(validated.tiers)) {
    if (tier.vesselIds.length === 0) continue
    const batches = chunkVessels(tier.vesselIds, validated.maxVesselsPerStatement)

    for (const bucket of ROLLUP_BUCKETS) {
      const windowMs = tier.rollupWindowMs[bucket]
      if (windowMs === undefined) continue
      const table = rollupTable(bucket)
      for (const vesselIds of batches) {
        statements.push({
          kind: 'delete',
          params: [vesselIds, cutoff(validated.now, windowMs)],
          target: table,
          text: `DELETE FROM ${table} WHERE vessel_id = ANY($1::uuid[]) AND bucket < $2::timestamptz`,
          tier: tierName,
        })
      }
    }

    if (tier.trackWindowMs !== undefined) {
      for (const vesselIds of batches) {
        statements.push({
          kind: 'delete',
          params: [vesselIds, cutoff(validated.now, tier.trackWindowMs)],
          target: TRACK_TABLE,
          text: `DELETE FROM ${TRACK_TABLE} WHERE vessel_id = ANY($1::uuid[]) AND ts < $2::timestamptz`,
          tier: tierName,
        })
      }
    }

    if (tier.rawWindowMs !== undefined) {
      for (const vesselIds of batches) {
        statements.push({
          kind: 'delete',
          params: [vesselIds, cutoff(validated.now, tier.rawWindowMs)],
          target: NUMERIC_TABLE,
          text: `DELETE FROM ${NUMERIC_TABLE} WHERE vessel_id = ANY($1::uuid[]) AND ts < $2::timestamptz`,
          tier: tierName,
        })
      }
    }
  }

  return statements
}

/**
 * The advisory-lock pair the retention sweep uses.
 *
 * Retention is the one operation here that two schedulers can plausibly start
 * at once -- a cron Workflow and an operator running it by hand -- and two
 * concurrent sweeps against the same compressed chunks is how a nightly job
 * becomes an outage. A `pg_try_advisory_lock` that is not granted means another
 * sweep is already doing the work, so this one stands down and says so rather
 * than queueing behind it.
 */
export const RETENTION_LOCK_KEY: readonly [number, number] = [0x6e_61_72_64, 0x72_65_74_6e]

export function retentionLockStatement(): { params: unknown[]; text: string } {
  return {
    params: [RETENTION_LOCK_KEY[0], RETENTION_LOCK_KEY[1]],
    text: 'SELECT pg_try_advisory_lock($1, $2) AS locked',
  }
}

export function retentionUnlockStatement(): { params: unknown[]; text: string } {
  return {
    params: [RETENTION_LOCK_KEY[0], RETENTION_LOCK_KEY[1]],
    text: 'SELECT pg_advisory_unlock($1, $2)',
  }
}

export function assertRetentionTarget(target: string): string {
  if (target !== NUMERIC_TABLE && target !== TRACK_TABLE && !target.startsWith(NUMERIC_TABLE)) {
    throw new NardukTimeseriesError(
      'RETENTION_POLICY_INVALID',
      'A retention statement may only target the history tables this package owns.',
      { target },
    )
  }
  return target
}
