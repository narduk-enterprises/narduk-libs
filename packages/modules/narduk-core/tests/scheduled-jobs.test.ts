/**
 * The scheduled-job dispatcher (narduk-libs#990): exact cron dispatch, one
 * error boundary per job, the Nitro plugin under hookable's real serial
 * `callHook`, and the optional lease against the real D1 driver (Miniflare).
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createLogger } from '@narduk-enterprises/narduk-logging'
import { createHooks } from 'hookable'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { createD1QueryHarness } from '../../../tooling/narduk-testkit/src/d1'
import {
  acquireScheduledJobLease,
  cronParity,
  declaredCrons,
  defineScheduledJobs,
  releaseScheduledJobLease,
  runScheduledJobs,
  SCHEDULED_JOB_LEASES_SQL,
  SCHEDULED_JOB_LEASES_TABLE,
  scheduledCron,
  type ScheduledJob,
} from '../runtime/server/scheduled-jobs'

import type { D1QueryHarness } from '../../../tooling/narduk-testkit/src/d1'
import type { LogRecord } from '@narduk-enterprises/narduk-logging'
import type { NitroApp } from 'nitropack/types'

const DAILY = '0 3 * * *'
const HOURLY = '0 * * * *'
const QUARTER_HOURLY = '*/15 * * * *'
const EXPORT_REFUSED = 'export refused'
const HOOK = 'cloudflare:scheduled'

function capturingLogger() {
  const records: LogRecord[] = []
  const logger = createLogger({
    environment: 'test',
    runtime: 'worker',
    service: 'scheduled-jobs-test',
    sinks: [{ write: (record) => void records.push(record) }],
  })
  return { logger, records }
}

const controller = (cron: string) => ({ cron, scheduledTime: 1_790_000_000_000 })

describe('runScheduledJobs', () => {
  it('runs only the jobs that declare the fired cron, and passes them the run context', async () => {
    const seen: string[] = []
    const jobs: Array<ScheduledJob<{ tag: string }>> = [
      {
        cron: QUARTER_HOURLY,
        name: 'pull',
        run: ({ cron, env, scheduledTime }) =>
          seen.push(`pull:${cron}:${env.tag}:${scheduledTime}`),
      },
      { cron: [DAILY, '0 15 * * *'], name: 'export', run: () => seen.push('export') },
    ]
    const { logger } = capturingLogger()

    const result = await runScheduledJobs(controller('0 15 * * *'), { tag: 't' }, jobs, { logger })
    expect(seen).toEqual(['export'])
    expect(result.outcomes).toEqual([
      expect.objectContaining({ name: 'export', status: 'succeeded' }),
    ])

    await runScheduledJobs(controller(QUARTER_HOURLY), { tag: 't' }, jobs, { logger })
    expect(seen).toEqual(['export', 'pull:*/15 * * * *:t:1790000000000'])
  })

  it('treats a cron no job declares as a logged no-op, never "run everything"', async () => {
    let ran = false
    const { logger, records } = capturingLogger()
    const result = await runScheduledJobs(
      controller('23 * * * *'),
      {},
      [{ cron: HOURLY, name: 'hourly', run: () => (ran = true) }],
      { logger },
    )
    expect(ran).toBe(false)
    expect(result.outcomes).toEqual([])
    expect(records.map((record) => record.message)).toContain('Scheduled trigger matched no job')
  })

  it('isolates each job: one throwing does not stop, or hide, the others, and nothing rejects', async () => {
    const ran: string[] = []
    const { logger, records } = capturingLogger()
    const jobs: Array<ScheduledJob<unknown>> = [
      {
        cron: DAILY,
        name: 'estate-export',
        run: () => {
          throw new Error(EXPORT_REFUSED)
        },
      },
      {
        cron: DAILY,
        name: 'estate-retention',
        run: async () => {
          ran.push('retention')
        },
      },
    ]

    const result = await runScheduledJobs(controller(DAILY), {}, jobs, { logger })
    expect(ran).toEqual(['retention'])
    expect(result.outcomes.map((outcome) => [outcome.name, outcome.status])).toEqual([
      ['estate-export', 'failed'],
      ['estate-retention', 'succeeded'],
    ])
    const failure = result.outcomes[0]
    expect(failure?.status === 'failed' && (failure.error as Error).message).toBe(EXPORT_REFUSED)
    // Each job is logged the way logJob logs it, and the run names what failed.
    const messages = records.map((record) => record.message)
    expect(messages).toContain('Operation failed')
    expect(messages).toContain('Operation completed')
    expect(messages).toContain('Scheduled jobs failed')
  })
})

describe('defineScheduledJobs under Nitro’s serial cloudflare:scheduled hooks', () => {
  // Nitro calls `hooks.callHook(HOOK, …)`; hookable runs the
  // hooks in series and the first rejection skips the rest.
  const payload = { context: { waitUntil: () => {} }, controller: controller(DAILY), env: {} }

  it('reproduces the operator-portal bug with one hook per job', async () => {
    const hooks = createHooks<{
      'cloudflare:scheduled': (p: typeof payload) => Promise<void> | void
    }>()
    const ran: string[] = []
    hooks.hook(HOOK, async () => {
      throw new Error(EXPORT_REFUSED)
    })
    hooks.hook(HOOK, async () => {
      ran.push('retention')
    })
    await expect(hooks.callHook(HOOK, payload)).rejects.toThrow(EXPORT_REFUSED)
    expect(ran).toEqual([])
  })

  it('runs every matched job, resolves, and leaves later hooks running', async () => {
    const hooks = createHooks<{
      'cloudflare:scheduled': (p: typeof payload) => Promise<void> | void
    }>()
    const ran: string[] = []
    const { logger } = capturingLogger()
    defineScheduledJobs(
      [
        {
          cron: DAILY,
          name: 'estate-export',
          run: () => {
            throw new Error(EXPORT_REFUSED)
          },
        },
        { cron: DAILY, name: 'estate-retention', run: () => ran.push('retention') },
      ],
      { logger },
    )({ hooks })
    hooks.hook(HOOK, () => {
      ran.push('a later hook')
    })

    await expect(hooks.callHook(HOOK, payload)).resolves.toBeUndefined()
    expect(ran).toEqual(['retention', 'a later hook'])
  })
})

describe('cron declarations', () => {
  const jobs: Array<ScheduledJob<unknown>> = [
    { cron: [DAILY, QUARTER_HOURLY], name: 'a', run: () => {} },
    { cron: DAILY, name: 'b', run: () => {} },
  ]

  it('lists the declared crons once each, sorted', () => {
    expect(declaredCrons(jobs)).toEqual([QUARTER_HOURLY, DAILY])
  })

  it('names crons wrangler never fires and crons no job handles', () => {
    expect(cronParity(jobs, [DAILY, QUARTER_HOURLY])).toEqual({
      unhandled: [],
      unscheduled: [],
    })
    // favicon-checker: the job declares a cron whose wrangler entry is commented out.
    expect(cronParity(jobs, [DAILY, '23 * * * *'])).toEqual({
      unhandled: ['23 * * * *'],
      unscheduled: [QUARTER_HOURLY],
    })
  })

  it('reads the cron from a Nitro payload or a controller', () => {
    expect(scheduledCron({ controller: controller(DAILY) })).toBe(DAILY)
    expect(scheduledCron(controller('*/5 * * * *'))).toBe('*/5 * * * *')
    expect(scheduledCron({})).toBeUndefined()
    expect(scheduledCron(null)).toBeUndefined()
  })
})

describe('scheduled-job lease (real D1)', () => {
  let harness: D1QueryHarness
  let migrationsDir: string

  beforeAll(async () => {
    migrationsDir = mkdtempSync(join(tmpdir(), 'scheduled-job-lease-'))
    writeFileSync(join(migrationsDir, '0000_leases.sql'), `${SCHEDULED_JOB_LEASES_SQL};\n`)
    harness = await createD1QueryHarness({ migrations: migrationsDir })
  })

  afterAll(async () => {
    await harness.dispose()
    rmSync(migrationsDir, { force: true, recursive: true })
  })

  beforeEach(async () => {
    await harness.clearData()
  })

  const T0 = 1_790_000_000_000

  it('is compare-and-swap: a held lease refuses a second taker until it expires', async () => {
    const db = harness.raw
    expect(await acquireScheduledJobLease(db, 'collect', 'run-a', T0, 60)).toBe(true)
    expect(await acquireScheduledJobLease(db, 'collect', 'run-b', T0 + 1_000, 60)).toBe(false)
    expect(await acquireScheduledJobLease(db, 'collect', 'run-b', T0 + 60_000, 60)).toBe(true)

    // run-a's late release must not free run-b's lease.
    await releaseScheduledJobLease(db, 'collect', 'run-a')
    expect(await acquireScheduledJobLease(db, 'collect', 'run-c', T0 + 61_000, 60)).toBe(false)
    await releaseScheduledJobLease(db, 'collect', 'run-b')
    expect(await acquireScheduledJobLease(db, 'collect', 'run-c', T0 + 61_000, 60)).toBe(true)
  })

  it('lets exactly one of two concurrent takers win', async () => {
    const db = harness.raw
    const results = await Promise.all([
      acquireScheduledJobLease(db, 'race', 'x', T0, 60),
      acquireScheduledJobLease(db, 'race', 'y', T0, 60),
    ])
    expect(results.filter(Boolean)).toHaveLength(1)
  })

  it('skips a run while the lease is held, and releases it after a run, even a failed one', async () => {
    const db = harness.raw
    const { logger } = capturingLogger()
    let runs = 0
    const job = (shouldThrow: boolean): ScheduledJob<unknown> => ({
      cron: HOURLY,
      lease: { d1: () => db, key: 'collect', ttlSeconds: 300 },
      name: 'collect',
      run: () => {
        runs += 1
        if (shouldThrow) throw new Error('collector down')
      },
    })

    // A manual trigger holds the lease.
    expect(await acquireScheduledJobLease(db, 'collect', 'manual', T0, 300)).toBe(true)
    const skipped = await runScheduledJobs(controller(HOURLY), {}, [job(false)], {
      logger,
      now: () => T0 + 1_000,
    })
    expect(skipped.outcomes).toEqual([
      expect.objectContaining({ name: 'collect', skipped: 'lease-held', status: 'skipped' }),
    ])
    expect(runs).toBe(0)
    await releaseScheduledJobLease(db, 'collect', 'manual')

    const failed = await runScheduledJobs(controller(HOURLY), {}, [job(true)], {
      logger,
      now: () => T0 + 2_000,
    })
    expect(failed.outcomes[0]?.status).toBe('failed')
    const rows = await db
      .prepare(`SELECT count(*) AS n FROM ${SCHEDULED_JOB_LEASES_TABLE}`)
      .first<{ n: number }>()
    expect(rows?.n).toBe(0)

    const ok = await runScheduledJobs(controller(HOURLY), {}, [job(false)], {
      logger,
      now: () => T0 + 3_000,
    })
    expect(ok.outcomes[0]?.status).toBe('succeeded')
    expect(runs).toBe(2)
  })

  it('fails the job closed, without running it, when the lease table is missing', async () => {
    const { logger } = capturingLogger()
    let ran = false
    await harness.raw.prepare(`DROP TABLE ${SCHEDULED_JOB_LEASES_TABLE}`).run()
    try {
      const result = await runScheduledJobs(
        controller(HOURLY),
        {},
        [
          {
            cron: HOURLY,
            lease: { d1: () => harness.raw, key: 'k', ttlSeconds: 60 },
            name: 'no-table',
            run: () => (ran = true),
          },
        ],
        { logger },
      )
      expect(result.outcomes[0]?.status).toBe('failed')
      expect(ran).toBe(false)
    } finally {
      await harness.raw.prepare(SCHEDULED_JOB_LEASES_SQL).run()
    }
  })
})

// Type-level: the plugin accepts Nitro's own `NitroApp`, so it can be the
// default export of a server plugin or wrapped in `defineNitroPlugin`.
const nitroPluginShape: (nitroApp: NitroApp) => void = defineScheduledJobs([])
void nitroPluginShape
