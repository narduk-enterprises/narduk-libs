/**
 * The cron-matched scheduled-job dispatcher every app hand-rolled
 * (narduk-libs#990): pick the jobs that answer to `controller.cron`, run each
 * one behind its own error boundary under narduk-logging's `logJob`, and
 * record the outcome rather than throw it.
 *
 * Why one dispatcher and not one hook per job: Nitro runs `cloudflare:scheduled`
 * hooks through hookable's serial `callHook`, so the first hook that rejects
 * skips every later one. operator-portal's `estate-export` throwing therefore
 * stopped `estate-retention` from ever pruning. Here the matched jobs run under
 * `Promise.allSettled`, and nothing this module returns rejects.
 *
 * - A cron no job declares is a logged no-op, never "run everything".
 * - `declaredCrons(jobs)` is the list to compare with wrangler's
 *   `triggers.crons`, and `cronParity()` says which side is missing what.
 * - An optional D1 lease (one conditional upsert, released by lease id) keeps
 *   a cron run and a manual trigger of the same job from overlapping. A run
 *   that finds the lease held is reported as `skipped: 'lease-held'`.
 *
 * Framework-free on purpose, so a plain Worker's `scheduled` handler uses the
 * same code. Import it explicitly from
 * `@narduk-enterprises/narduk-core/server/scheduled-jobs`. It is not under
 * `server/utils`, so it adds no auto-imported names to consuming apps.
 */

import { createLogger } from '@narduk-enterprises/narduk-logging'

import type { Logger } from '@narduk-enterprises/narduk-logging'

/** The `ScheduledController` fields the dispatcher reads. */
export interface ScheduledControllerLike {
  cron: string
  scheduledTime: number
}

/** The `ExecutionContext` field the Nitro plugin uses. */
export interface WaitUntilContext {
  waitUntil(promise: Promise<unknown>): void
}

/** The D1 surface the lease uses. */
export interface LeaseDatabase {
  prepare(query: string): {
    bind(...values: unknown[]): {
      run(): Promise<{ meta?: { changes?: number } }>
    }
  }
}

export interface ScheduledJobContext<Env> {
  cron: string
  env: Env
  log: Logger
  scheduledTime: number
}

export interface ScheduledJobLease<Env> {
  /** The D1 database holding {@link SCHEDULED_JOB_LEASES_TABLE}. */
  d1: (env: Env) => LeaseDatabase
  /** Lease key; defaults to the job name. Share it with the manual trigger. */
  key?: string
  /** How long a lease holds if its run dies without releasing it. */
  ttlSeconds: number
}

export interface ScheduledJob<Env> {
  /** The exact cron expressions this job answers to. */
  cron: string | readonly string[]
  lease?: ScheduledJobLease<Env>
  name: string
  run: (context: ScheduledJobContext<Env>) => unknown
}

export type ScheduledJobOutcome =
  | { durationMs: number; name: string; status: 'succeeded' }
  | { durationMs: number; error: unknown; name: string; status: 'failed' }
  | { durationMs: number; name: string; skipped: 'lease-held'; status: 'skipped' }

export interface ScheduledRunResult {
  cron: string
  /** One entry per matched job, in declaration order. Empty for an unmatched cron. */
  outcomes: ScheduledJobOutcome[]
}

export interface RunScheduledJobsOptions {
  /** Lease id generator; defaults to `crypto.randomUUID`. */
  leaseId?: () => string
  /** Defaults to a worker logger for service `scheduled-jobs`. */
  logger?: Logger
  /** Clock for lease expiry; defaults to `Date.now`. */
  now?: () => number
}

/**
 * The lease table, for an app's own migrations. A lease row is held while
 * `expires_at` (epoch ms) is in the future.
 */
export const SCHEDULED_JOB_LEASES_TABLE = 'narduk_scheduled_job_leases'

export const SCHEDULED_JOB_LEASES_SQL = `CREATE TABLE IF NOT EXISTS ${SCHEDULED_JOB_LEASES_TABLE} (
  key TEXT PRIMARY KEY NOT NULL,
  lease_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL
)`

function cronsOf<Env>(job: ScheduledJob<Env>): readonly string[] {
  return typeof job.cron === 'string' ? [job.cron] : job.cron
}

/** Every cron expression the jobs declare, sorted and de-duplicated. */
export function declaredCrons<Env>(jobs: ReadonlyArray<ScheduledJob<Env>>): string[] {
  return [...new Set(jobs.flatMap((job) => cronsOf(job)))].sort()
}

/**
 * Compare the jobs' crons with wrangler's `triggers.crons`. `unscheduled` are
 * declared by a job but never fired by wrangler, so the job is dead code (the
 * favicon-checker case). `unhandled` fire but match no job, so they are no-ops.
 */
export function cronParity<Env>(
  jobs: ReadonlyArray<ScheduledJob<Env>>,
  wranglerCrons: readonly string[],
): { unhandled: string[]; unscheduled: string[] } {
  const declared = new Set(declaredCrons(jobs))
  const fired = new Set(wranglerCrons)
  return {
    unhandled: [...fired].filter((cron) => !declared.has(cron)).sort(),
    unscheduled: [...declared].filter((cron) => !fired.has(cron)).sort(),
  }
}

/**
 * The cron expression from Nitro's `cloudflare:scheduled` payload, or from a
 * `ScheduledController`. `undefined` when neither carries one.
 */
export function scheduledCron(payload: unknown): string | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined
  const record = payload as { controller?: { cron?: unknown }; cron?: unknown }
  if (typeof record.controller?.cron === 'string') return record.controller.cron
  return typeof record.cron === 'string' ? record.cron : undefined
}

/**
 * Take the lease with one conditional upsert: the row is written only when no
 * row exists or the existing lease has expired, so two racing runs cannot both
 * see `changes === 1`. Compare-and-swap, not check-then-act.
 */
export async function acquireScheduledJobLease(
  db: LeaseDatabase,
  key: string,
  leaseId: string,
  now: number,
  ttlSeconds: number,
): Promise<boolean> {
  const result = await db
    .prepare(
      `INSERT INTO ${SCHEDULED_JOB_LEASES_TABLE} (key, lease_id, expires_at) VALUES (?1, ?2, ?3)
       ON CONFLICT(key) DO UPDATE SET lease_id = excluded.lease_id, expires_at = excluded.expires_at
       WHERE ${SCHEDULED_JOB_LEASES_TABLE}.expires_at <= ?4`,
    )
    .bind(key, leaseId, now + ttlSeconds * 1000, now)
    .run()
  return (result.meta?.changes ?? 0) === 1
}

/** Release only the lease this run took; a lease another run re-took after expiry stays. */
export async function releaseScheduledJobLease(
  db: LeaseDatabase,
  key: string,
  leaseId: string,
): Promise<void> {
  await db
    .prepare(`DELETE FROM ${SCHEDULED_JOB_LEASES_TABLE} WHERE key = ?1 AND lease_id = ?2`)
    .bind(key, leaseId)
    .run()
}

function defaultLogger(): Logger {
  return createLogger({ environment: 'unknown', runtime: 'worker', service: 'scheduled-jobs' })
}

async function runOne<Env>(
  job: ScheduledJob<Env>,
  controller: ScheduledControllerLike,
  env: Env,
  logger: Logger,
  options: RunScheduledJobsOptions,
): Promise<ScheduledJobOutcome> {
  const now = options.now ?? Date.now
  const started = now()
  const elapsed = () => Math.max(0, now() - started)
  const jobLogger = logger.withContext({ source: 'job' })
  let lease: { db: LeaseDatabase; id: string; key: string } | undefined
  try {
    if (job.lease) {
      const db = job.lease.d1(env)
      const key = job.lease.key ?? job.name
      const id = (options.leaseId ?? (() => crypto.randomUUID()))()
      if (!(await acquireScheduledJobLease(db, key, id, started, job.lease.ttlSeconds))) {
        jobLogger.info('Scheduled job skipped: lease held', {
          job: job.name,
          cron: controller.cron,
        })
        return { durationMs: elapsed(), name: job.name, skipped: 'lease-held', status: 'skipped' }
      }
      lease = { db, id, key }
    }
    // logJob's shape: narduk-logging's operation() logs start, completion and
    // failure with the duration, then rethrows into this boundary.
    await jobLogger.operation(
      job.name,
      (log) =>
        job.run({ cron: controller.cron, env, log, scheduledTime: controller.scheduledTime }),
      { cron: controller.cron },
    )
    return { durationMs: elapsed(), name: job.name, status: 'succeeded' }
  } catch (error) {
    return { durationMs: elapsed(), error, name: job.name, status: 'failed' }
  } finally {
    if (lease) {
      try {
        await releaseScheduledJobLease(lease.db, lease.key, lease.id)
      } catch (error) {
        // The lease still expires on its own; a failed release only delays
        // the next run by the TTL.
        jobLogger.warn('Scheduled job lease release failed', { error, job: job.name })
      }
    }
  }
}

/**
 * Run every job that declares `controller.cron`, each isolated from the
 * others. Never rejects: a job's failure is logged and returned in `outcomes`.
 */
export async function runScheduledJobs<Env>(
  controller: ScheduledControllerLike,
  env: Env,
  jobs: ReadonlyArray<ScheduledJob<Env>>,
  options: RunScheduledJobsOptions = {},
): Promise<ScheduledRunResult> {
  const logger = options.logger ?? defaultLogger()
  const matched = jobs.filter((job) => cronsOf(job).includes(controller.cron))
  if (matched.length === 0) {
    logger.warn('Scheduled trigger matched no job', {
      cron: controller.cron,
      declared: declaredCrons(jobs),
    })
    return { cron: controller.cron, outcomes: [] }
  }
  const settled = await Promise.allSettled(
    matched.map((job) => runOne(job, controller, env, logger, options)),
  )
  // runOne catches everything, so a rejection here is a bug in this module;
  // it is still reported rather than lost.
  const outcomes = settled.map((result, index): ScheduledJobOutcome =>
    result.status === 'fulfilled'
      ? result.value
      : { durationMs: 0, error: result.reason, name: matched[index]!.name, status: 'failed' },
  )
  const failed = outcomes.filter((outcome) => outcome.status === 'failed')
  if (failed.length > 0) {
    logger.error('Scheduled jobs failed', {
      cron: controller.cron,
      failed: failed.map((outcome) => outcome.name),
    })
  }
  return { cron: controller.cron, outcomes }
}

/** The part of Nitro's app the plugin touches. */
interface NitroAppLike {
  hooks: {
    hook(
      name: 'cloudflare:scheduled',
      handler: (payload: {
        context?: WaitUntilContext
        controller: ScheduledControllerLike
        env: unknown
      }) => Promise<void> | void,
    ): unknown
  }
}

/**
 * One Nitro plugin for all of an app's scheduled jobs. Put it in
 * `server/plugins/scheduled-jobs.ts` as the default export, and delete the
 * per-job `cloudflare:scheduled` hooks it replaces:
 *
 *     export default defineScheduledJobs<Env>([{ name, cron, run }, ...])
 *
 * The hook resolves only after every matched job settles and never rejects,
 * so no other `cloudflare:scheduled` hook is skipped because of it.
 */
export function defineScheduledJobs<Env>(
  jobs: ReadonlyArray<ScheduledJob<Env>>,
  options: RunScheduledJobsOptions = {},
): (nitroApp: NitroAppLike) => void {
  return (nitroApp) => {
    nitroApp.hooks.hook('cloudflare:scheduled', async ({ controller, env }) => {
      await runScheduledJobs(controller, env as Env, jobs, options)
    })
  }
}
