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
 *    cheap operation and it is why docs/13 keeps the raw window short and
 *    global rather than per vessel.
 *  - **Global rollups**, one `drop_chunks` per level. A continuous aggregate is
 *    a hypertable of materialized buckets, and dropping its old chunks is how
 *    it is pruned. Per-VESSEL rollup retention was the earlier shape here and
 *    it was wrong twice over: a `DELETE` against a continuous aggregate is not
 *    a supported way to prune one, and it needed a DELETE grant on the view
 *    that did nothing. Rollups are therefore retained globally at the most
 *    generous tier's depth, and a shorter tier is enforced on READ, where
 *    `queryRollup` clips the requested range to the tier window the consumer
 *    passes in.
 *  - **Per-tier track** is the remaining per-vessel delete, chunked by vessel
 *    so one statement never carries an unbounded array.
 *  - **Per-tier raw is enforced on READ, like rollups** (narduk-libs#1081).
 *    A per-tier raw row delete invalidated the continuous aggregates over
 *    that range, and the next refresh emptied the tier's rollups inside the
 *    refresh window. Raw is kept for the global window for every vessel and
 *    a tier's `rawWindowMs` is the depth a consumer's raw read clips to.
 */

import { NardukTimeseriesError } from '../errors.js'
import { validateRetentionPolicy } from '../policy.js'
import { ROLLUP_BUCKETS, type RetentionPolicyInput, type RollupBucket } from '../types.js'
import { NUMERIC_TABLE, ROLLUP_TABLES, SERIES_TABLE, TRACK_TABLE, rollupTable } from './tables.js'

export interface RetentionStatement {
  /** `drop_chunks` unlinks chunks; `delete` removes rows. */
  kind: 'drop_chunks' | 'delete'
  params: unknown[]
  /** Set for a rollup-level statement, null for raw and track. */
  rollup: RollupBucket | null
  /** The table or view this statement touches, for the result breakdown. */
  target: string
  text: string
  /** null for a global statement. */
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
    rollup: null,
    target: NUMERIC_TABLE,
    text: `SELECT drop_chunks('${NUMERIC_TABLE}', older_than => $1::timestamptz)`,
    tier: null,
  })

  // One global window per rollup level. A level the policy omits is reported
  // as unswept by the validator, never given a guessed window here.
  for (const bucket of ROLLUP_BUCKETS) {
    const windowMs = validated.globalRollupWindowMs?.[bucket]
    if (windowMs === undefined) continue
    const view = rollupTable(bucket)
    statements.push({
      kind: 'drop_chunks',
      params: [cutoff(validated.now, windowMs)],
      rollup: bucket,
      target: view,
      text: `SELECT drop_chunks('${view}', older_than => $1::timestamptz)`,
      tier: null,
    })
  }

  // Tier order is the caller's declaration order, kept stable so the plan is
  // byte-comparable between runs.
  for (const [tierName, tier] of Object.entries(validated.tiers)) {
    if (tier.vesselIds.length === 0) continue
    const batches = chunkVessels(tier.vesselIds, validated.maxVesselsPerStatement)

    if (tier.trackWindowMs !== undefined) {
      for (const vesselIds of batches) {
        statements.push({
          kind: 'delete',
          params: [vesselIds.join(','), cutoff(validated.now, tier.trackWindowMs)],
          rollup: null,
          target: TRACK_TABLE,
          text: `DELETE FROM ${TRACK_TABLE} WHERE vessel_id = ANY(string_to_array($1::text, ',')::uuid[]) AND ts < $2::timestamptz`,
          tier: tierName,
        })
      }
    }

    // No per-tier raw DELETE (narduk-libs#1081). A row DELETE on the raw
    // hypertable invalidates the continuous aggregates over that range, and
    // the next refresh re-materializes those buckets from the raw that is
    // left: none. Live on TimescaleDB 2.30.1 a Free vessel's 1m rollups 3
    // days back went from 2 rows to 0. `tier.rawWindowMs` is a read depth
    // the consumer clips raw reads to; Logan 2026-09-26: "Prove, then
    // read-gate (Recommended)".
  }

  for (const statement of statements) assertRetentionTarget(statement.target)
  return statements
}

/**
 * The advisory-lock pair the retention sweep uses.
 *
 * Retention is the one operation here that two schedulers can plausibly start
 * at once -- a cron Workflow and an operator running it by hand -- and two
 * concurrent sweeps against the same columnstore chunks is how a nightly job
 * becomes an outage. A `pg_try_advisory_lock` that is not granted means another
 * sweep is already doing the work, so this one stands down and says so rather
 * than queueing behind it.
 *
 * The lock is SESSION-scoped, which is a hard constraint on where retention
 * may run: lock and unlock must reach the same backend. Through a pool -- or
 * through Hyperdrive, which is a pool -- they may not, and a lock left held by
 * a backend nobody is talking to any more makes every later sweep stand down
 * with `coalesced: true` and delete nothing until that backend is recycled.
 * The store therefore refuses to sweep without an executor the caller has
 * declared session-pinned, and checks the backend pid on both ends.
 */
export const RETENTION_LOCK_KEY: readonly [number, number] = [0x6e_61_72_64, 0x72_65_74_6e]

export function retentionLockStatement(): { params: unknown[]; text: string } {
  return {
    params: [RETENTION_LOCK_KEY[0], RETENTION_LOCK_KEY[1]],
    text: 'SELECT pg_try_advisory_lock($1, $2) AS locked, pg_backend_pid() AS pid',
  }
}

export function retentionUnlockStatement(): { params: unknown[]; text: string } {
  return {
    params: [RETENTION_LOCK_KEY[0], RETENTION_LOCK_KEY[1]],
    text: 'SELECT pg_advisory_unlock($1, $2) AS unlocked, pg_backend_pid() AS pid',
  }
}

/**
 * Every relation a retention statement from this package may name, as an exact
 * set.
 *
 * The earlier version of this check was a prefix test -- `startsWith`
 * `telemetry_numeric` -- which accepted `telemetry_numeric_anything`, and
 * nothing called it. An exact set called on every emitted statement is the
 * difference between a guard and a comment.
 */
export const RETENTION_TARGETS: ReadonlySet<string> = new Set<string>([
  NUMERIC_TABLE,
  TRACK_TABLE,
  ...Object.values(ROLLUP_TABLES),
])

export function assertRetentionTarget(target: string): string {
  if (!RETENTION_TARGETS.has(target)) {
    throw new NardukTimeseriesError(
      'RETENTION_POLICY_INVALID',
      `A retention statement may only target the history tables this package owns: ${[...RETENTION_TARGETS].join(', ')}. The ${SERIES_TABLE} dimension is deliberately not one of them -- a series row outlives its points.`,
      { known: [...RETENTION_TARGETS], target },
    )
  }
  return target
}
