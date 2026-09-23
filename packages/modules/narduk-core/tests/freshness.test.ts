import { createServer } from 'node:http'

import { createApp, toNodeListener } from 'h3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import healthHandler from '../runtime/server/api/health.get'
import {
  getHealthCheckRegistry,
  type HealthCheckContext,
  resolveFailureRequired,
} from '../runtime/server/health/checks'
import {
  evaluateFreshness,
  FRESHNESS_CHECK_KIND,
  unreadableFreshnessOutcome,
  worstFreshnessSeverity,
} from '../runtime/server/health/freshness'
import {
  type FreshnessCheckDefinition,
  MAX_FRESHNESS_THRESHOLD_SECONDS,
  registerFreshnessCheck,
} from '../runtime/server/utils/freshness-checks'
import { registerHealthCheck } from '../runtime/server/utils/health-checks'

const { state, logger } = vi.hoisted(() => {
  const logger = {
    error: vi.fn(),
    child: () => logger,
  }
  return {
    state: { config: {} as Record<string, unknown> },
    logger,
  }
})

vi.mock('nitropack/runtime', () => ({ useRuntimeConfig: () => state.config }))
vi.mock('../runtime/server/utils/logger', () => ({ useLogger: () => logger }))
vi.mock('../runtime/server/utils/database', () => ({ probeDatabaseConnection: vi.fn() }))

/** The substring uptime monitors treat as healthy; see narduk-core README. */
const STATUS_OK = '"status":"ok"'
/** Monitors such as watchdog-uptime match substrings in this much of the body. */
const MONITOR_WINDOW_CHARS = 4096
const NO_DATABASE = { databaseBackend: 'none', databaseBackendSource: 'option' }
/** A fixed wall clock, so every expected age in this file is exact. */
const NOW = Date.parse('2026-09-16T12:00:00.000Z')
const SOURCE = 'ndbc-realtime-observations'
const CHECK_NAME = 'observations-freshness'
const MISSING = 'missing-timestamp'
const INVALID = 'invalid-timestamp'

interface HealthCheckBody {
  detail?: Record<string, unknown>
  detailOmitted?: string
  durationMs?: number
  error?: string
  kind?: string
  name: string
  notice?: true
  reason?: string
  required: boolean
  result: 'pass' | 'fail' | 'skipped'
}

interface HealthBody {
  data: {
    checks: HealthCheckBody[]
    database: string
    missingAuthTables: string[]
    status: 'ok' | 'degraded' | 'error'
    timestamp: string
  }
  success: true
}

async function requestHealth() {
  const app = createApp().use(healthHandler)
  const server = createServer(toNodeListener(app))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Expected TCP listener')
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/health`)
    const text = await response.text()
    return { httpStatus: response.status, text, body: JSON.parse(text) as HealthBody }
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
  }
}

/** Register a freshness check against the frozen clock and return its report entry. */
async function reportFor(overrides: Partial<FreshnessCheckDefinition> = {}) {
  state.config = { ...NO_DATABASE }
  registerFreshnessCheck({
    name: CHECK_NAME,
    source: SOURCE,
    warnAfter: 45 * 60,
    now: () => NOW,
    read: () => ({ at: new Date(NOW) }),
    ...overrides,
  })
  const { body, httpStatus, text } = await requestHealth()
  const entry = body.data.checks.find((check) => check.name === CHECK_NAME)
  if (!entry) throw new Error('Expected the freshness check in the report')
  return { entry, httpStatus, status: body.data.status, text }
}

function ageOf(seconds: number) {
  return new Date(NOW - seconds * 1000).toISOString()
}

beforeEach(() => {
  state.config = {}
  logger.error.mockReset()
})

afterEach(() => {
  getHealthCheckRegistry().clear()
})

describe('evaluateFreshness age math', () => {
  const thresholds = { warnAfter: 600, failAfter: 3600 }

  it('reports the age in whole seconds against the injected clock', () => {
    const outcome = evaluateFreshness({
      ...thresholds,
      at: ageOf(125),
      now: NOW,
      source: SOURCE,
    })

    expect(outcome.ok).toBeUndefined()
    expect(outcome.detail).toEqual({
      source: SOURCE,
      warnAfterSeconds: 600,
      failAfterSeconds: 3600,
      observedAt: ageOf(125),
      ageSeconds: 125,
    })
  })

  it.each([
    ['a Date', new Date(NOW - 90_000)],
    ['an ISO string', new Date(NOW - 90_000).toISOString()],
    ['epoch milliseconds', NOW - 90_000],
  ])('accepts %s', (_label, at) => {
    const outcome = evaluateFreshness({ ...thresholds, at, now: NOW, source: SOURCE })

    expect(outcome.ok).toBeUndefined()
    expect(outcome.detail).toMatchObject({ ageSeconds: 90, observedAt: ageOf(90) })
  })

  it('rounds a sub-second age to the nearest second without failing', () => {
    const outcome = evaluateFreshness({ ...thresholds, at: NOW - 1400, now: NOW, source: SOURCE })

    expect(outcome.detail).toMatchObject({ ageSeconds: 1 })
  })

  it('treats a timestamp from the future as fresh and reports a negative age', () => {
    const outcome = evaluateFreshness({
      ...thresholds,
      at: NOW + 30_000,
      now: NOW,
      source: SOURCE,
    })

    expect(outcome.ok).toBeUndefined()
    expect(outcome.detail).toMatchObject({ ageSeconds: -30 })
  })

  it('merges reading detail underneath the computed fields', () => {
    const outcome = evaluateFreshness({
      ...thresholds,
      at: NOW,
      detail: { releaseId: '2026-09-16.1', source: 'ignored' },
      now: NOW,
      source: SOURCE,
    })

    expect(outcome.detail).toMatchObject({ releaseId: '2026-09-16.1', source: SOURCE })
  })

  it.each([
    ['an array', ['nope']],
    ['a string', 'nope'],
    ['null', null],
  ])('ignores reading detail that is %s', (_label, detail) => {
    const outcome = evaluateFreshness({ ...thresholds, at: NOW, detail, now: NOW, source: SOURCE })

    expect(outcome.detail).toEqual({
      source: SOURCE,
      warnAfterSeconds: 600,
      failAfterSeconds: 3600,
      observedAt: new Date(NOW).toISOString(),
      ageSeconds: 0,
    })
  })
})

describe('evaluateFreshness thresholds', () => {
  const thresholds = { warnAfter: 600, failAfter: 3600 }

  it('passes at exactly warnAfter and degrades one millisecond later', () => {
    expect(
      evaluateFreshness({ ...thresholds, at: NOW - 600_000, now: NOW, source: SOURCE }).ok,
    ).toBeUndefined()

    const just = evaluateFreshness({ ...thresholds, at: NOW - 600_001, now: NOW, source: SOURCE })

    expect(just).toMatchObject({ ok: false, severity: 'degraded' })
    expect(just.detail).toMatchObject({ reason: 'stale' })
  })

  it('passes at exactly failAfter and errors one millisecond later', () => {
    expect(
      evaluateFreshness({ ...thresholds, at: NOW - 3_600_000, now: NOW, source: SOURCE }),
    ).toMatchObject({ ok: false, severity: 'degraded' })

    expect(
      evaluateFreshness({ ...thresholds, at: NOW - 3_600_001, now: NOW, source: SOURCE }),
    ).toMatchObject({ ok: false, severity: 'error', detail: { reason: 'stale' } })
  })

  it('never exceeds degraded without failAfter, however old the data is', () => {
    const outcome = evaluateFreshness({
      warnAfter: 600,
      at: NOW - 400 * 24 * 3600 * 1000,
      now: NOW,
      source: SOURCE,
    })

    expect(outcome).toMatchObject({ ok: false, severity: 'degraded' })
    expect(outcome.detail).toMatchObject({ failAfterSeconds: null, ageSeconds: 34_560_000 })
  })

  it('names the ceiling a set of thresholds can reach', () => {
    expect(worstFreshnessSeverity({ warnAfter: 600 })).toBe('degraded')
    expect(worstFreshnessSeverity({ warnAfter: 600, failAfter: 3600 })).toBe('error')
  })
})

describe('evaluateFreshness with no usable timestamp', () => {
  it.each([
    ['undefined', undefined, MISSING],
    ['null', null, MISSING],
    ['an invalid Date', new Date('nope'), INVALID],
    ['an unparseable string', 'last tuesday', INVALID],
    ['NaN', Number.NaN, INVALID],
    ['Infinity', Number.POSITIVE_INFINITY, INVALID],
    ['an object', { at: 1 }, INVALID],
  ])('fails closed for %s', (_label, at, reason) => {
    const outcome = evaluateFreshness({
      warnAfter: 600,
      failAfter: 3600,
      at,
      now: NOW,
      source: SOURCE,
    })

    expect(outcome).toMatchObject({ ok: false, severity: 'error' })
    expect(outcome.detail).toEqual({
      source: SOURCE,
      warnAfterSeconds: 600,
      failAfterSeconds: 3600,
      reason,
    })
  })

  it('fails closed only as far as the thresholds allow', () => {
    expect(evaluateFreshness({ warnAfter: 600, at: null, now: NOW, source: SOURCE })).toMatchObject(
      {
        ok: false,
        severity: 'degraded',
        detail: { reason: MISSING },
      },
    )
  })

  it('describes an unreadable source with the same shape', () => {
    expect(unreadableFreshnessOutcome({ warnAfter: 600, failAfter: 3600 }, SOURCE)).toEqual({
      ok: false,
      severity: 'error',
      detail: {
        source: SOURCE,
        warnAfterSeconds: 600,
        failAfterSeconds: 3600,
        reason: 'unreadable',
      },
    })
  })
})

describe('registerFreshnessCheck validation', () => {
  const valid: FreshnessCheckDefinition = {
    name: 'data-freshness',
    source: SOURCE,
    warnAfter: 600,
    read: () => ({ at: NOW }),
  }

  it.each([
    ['a missing source', { source: undefined }, /source must be a string of 1-128/u],
    ['an empty source', { source: '' }, /source must be a string of 1-128/u],
    ['an oversized source', { source: 'x'.repeat(129) }, /source must be a string of 1-128/u],
    ['no read function', { read: undefined }, /needs a read function/u],
    ['a non-function clock', { now: 5 }, /now must be a function/u],
    ['a zero warnAfter', { warnAfter: 0 }, /warnAfter must be a positive number/u],
    ['a negative warnAfter', { warnAfter: -1 }, /warnAfter must be a positive number/u],
    ['a non-numeric warnAfter', { warnAfter: '600' }, /warnAfter must be a positive number/u],
    ['an infinite warnAfter', { warnAfter: Number.POSITIVE_INFINITY }, /positive number/u],
    [
      'a warnAfter beyond a year',
      { warnAfter: MAX_FRESHNESS_THRESHOLD_SECONDS + 1 },
      /warnAfter must be at most/u,
    ],
    ['a zero failAfter', { failAfter: 0 }, /failAfter must be a positive number/u],
    ['failAfter below warnAfter', { failAfter: 599 }, /must be at least warnAfter/u],
    ['a zero noticeAfter', { noticeAfter: 0 }, /noticeAfter must be a positive number/u],
    ['noticeAfter above warnAfter', { noticeAfter: 601 }, /must be at most warnAfter/u],
  ])('rejects %s', (_label, overrides, message) => {
    expect(() =>
      registerFreshnessCheck({ ...valid, ...overrides } as FreshnessCheckDefinition),
    ).toThrow(message)
    expect(getHealthCheckRegistry().size).toBe(0)
  })

  it('rejects a definition that is not an object', () => {
    expect(() => registerFreshnessCheck(null as unknown as FreshnessCheckDefinition)).toThrow(
      /expects a check definition object/u,
    )
  })

  it('still applies the health-check name rules', () => {
    expect(() => registerFreshnessCheck({ ...valid, name: 'Data Freshness' })).toThrow(
      /must be 1-63 lowercase letters/u,
    )
    expect(() => registerFreshnessCheck({ ...valid, name: 'database' })).toThrow(/is reserved/u)
  })

  it('accepts failAfter equal to warnAfter and registers one freshness check', () => {
    const remove = registerFreshnessCheck({ ...valid, failAfter: 600 })

    const registered = getHealthCheckRegistry().get('data-freshness')
    expect(registered).toMatchObject({ kind: FRESHNESS_CHECK_KIND, required: true })
    remove()
    expect(getHealthCheckRegistry().size).toBe(0)
  })

  it('declares an optional check when no failAfter is given', () => {
    registerFreshnessCheck(valid)

    expect(getHealthCheckRegistry().get('data-freshness')).toMatchObject({ required: false })
  })
})

describe('GET /api/health with a freshness check', () => {
  it('publishes a fresh source with its kind, age and thresholds', async () => {
    const { entry, httpStatus, status, text } = await reportFor({
      failAfter: 6 * 3600,
      read: () => ({ at: ageOf(120), detail: { releaseId: '2026-09-16.1' } }),
    })

    expect(httpStatus).toBe(200)
    expect(status).toBe('ok')
    expect(entry).toMatchObject({
      kind: FRESHNESS_CHECK_KIND,
      name: CHECK_NAME,
      required: true,
      result: 'pass',
    })
    expect(entry.detail).toEqual({
      releaseId: '2026-09-16.1',
      source: SOURCE,
      warnAfterSeconds: 2700,
      failAfterSeconds: 21_600,
      observedAt: ageOf(120),
      ageSeconds: 120,
    })
    expect(text.slice(0, MONITOR_WINDOW_CHARS)).toContain(STATUS_OK)
  })

  it('degrades the report without taking the app down past warnAfter', async () => {
    const { entry, httpStatus, status, text } = await reportFor({
      failAfter: 6 * 3600,
      read: () => ({ at: ageOf(3000) }),
    })

    expect(httpStatus).toBe(200)
    expect(status).toBe('degraded')
    expect(entry).toMatchObject({ result: 'fail', required: false, kind: FRESHNESS_CHECK_KIND })
    expect(entry.detail).toMatchObject({ reason: 'stale', ageSeconds: 3000 })
    expect(text).not.toContain(STATUS_OK)
  })

  describe('the noticeAfter band (narduk-libs#414)', () => {
    const threeBands = { noticeAfter: 90 * 60, warnAfter: 360 * 60, failAfter: 24 * 3600 }

    it('publishes an aging feed as a failing notice and leaves the report ok', async () => {
      const { entry, httpStatus, status, text } = await reportFor({
        ...threeBands,
        read: () => ({ at: ageOf(2 * 3600) }),
      })

      expect(httpStatus).toBe(200)
      expect(status).toBe('ok')
      expect(entry).toMatchObject({ result: 'fail', required: false, notice: true })
      expect(entry.detail).toMatchObject({
        reason: 'stale',
        ageSeconds: 7200,
        noticeAfterSeconds: 5400,
        warnAfterSeconds: 21_600,
      })
      expect(text.slice(0, MONITOR_WINDOW_CHARS)).toContain(STATUS_OK)
      expect(logger.error).not.toHaveBeenCalled()
    })

    it('passes below noticeAfter, and still degrades past warnAfter', async () => {
      const fresh = await reportFor({ ...threeBands, read: () => ({ at: ageOf(60 * 60) }) })
      expect(fresh.entry).toMatchObject({ result: 'pass' })
      expect(fresh.entry.notice).toBeUndefined()
      getHealthCheckRegistry().clear()

      const stale = await reportFor({ ...threeBands, read: () => ({ at: ageOf(7 * 3600) }) })
      expect(stale.status).toBe('degraded')
      expect(stale.entry).toMatchObject({ result: 'fail', required: false })
      expect(stale.entry.notice).toBeUndefined()
    })

    it('fails closed past the notice band when the timestamp is missing', async () => {
      const { entry, status } = await reportFor({ ...threeBands, read: () => ({ at: undefined }) })

      expect(status).toBe('error')
      expect(entry).toMatchObject({ result: 'fail', required: true })
      expect(entry.notice).toBeUndefined()
    })
  })

  it('turns the report red only once failAfter is crossed', async () => {
    const { entry, httpStatus, status } = await reportFor({
      failAfter: 6 * 3600,
      read: () => ({ at: ageOf(7 * 3600) }),
    })

    expect(httpStatus).toBe(503)
    expect(status).toBe('error')
    expect(entry).toMatchObject({ result: 'fail', required: true })
    expect(entry.detail).toMatchObject({ reason: 'stale', ageSeconds: 25_200 })
  })

  it('never turns the report red when no failAfter was configured', async () => {
    const { entry, httpStatus, status } = await reportFor({
      read: () => ({ at: ageOf(30 * 24 * 3600) }),
    })

    expect(httpStatus).toBe(200)
    expect(status).toBe('degraded')
    expect(entry).toMatchObject({ result: 'fail', required: false })
  })

  it('fails closed and logs the cause when the read throws', async () => {
    const { entry, httpStatus, status } = await reportFor({
      failAfter: 6 * 3600,
      read: () => {
        throw new Error('R2 bucket unreachable at https://example.invalid/secret')
      },
    })

    expect(httpStatus).toBe(503)
    expect(status).toBe('error')
    expect(entry).toMatchObject({ result: 'fail', required: true })
    expect(entry.detail).toEqual({
      source: SOURCE,
      warnAfterSeconds: 2700,
      failAfterSeconds: 21_600,
      reason: 'unreadable',
    })
    expect(JSON.stringify(entry)).not.toContain('example.invalid')
    expect(logger.error).toHaveBeenCalledWith(
      'Freshness check could not read its source',
      expect.objectContaining({ check: CHECK_NAME, source: SOURCE }),
    )
  })

  it('fails closed when the source publishes no timestamp', async () => {
    const { entry, status } = await reportFor({ read: () => ({ at: undefined }) })

    expect(status).toBe('degraded')
    expect(entry).toMatchObject({ result: 'fail', required: false })
    expect(entry.detail).toMatchObject({ reason: MISSING })
  })

  it('fails closed when the read resolves to nothing at all', async () => {
    const { entry, status } = await reportFor({
      failAfter: 6 * 3600,
      read: () => undefined as never,
    })

    expect(status).toBe('error')
    expect(entry.detail).toMatchObject({ reason: MISSING })
  })

  it('keeps the declared severity when the read times out', async () => {
    const { entry, httpStatus } = await reportFor({
      failAfter: 6 * 3600,
      timeoutMs: 10,
      read: ({ signal }: HealthCheckContext) =>
        new Promise<never>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason))
        }),
    })

    expect(httpStatus).toBe(503)
    expect(entry).toMatchObject({
      kind: FRESHNESS_CHECK_KIND,
      required: true,
      result: 'fail',
      error: 'Check timed out after 10 ms.',
    })
    expect(entry.detail).toBeUndefined()
  })

  it('reports one entry per source when several feeds are watched', async () => {
    state.config = { ...NO_DATABASE }
    registerFreshnessCheck({
      name: CHECK_NAME,
      source: SOURCE,
      warnAfter: 2700,
      now: () => NOW,
      read: () => ({ at: ageOf(60) }),
    })
    registerFreshnessCheck({
      name: 'buoycams-freshness',
      source: 'ndbc-buoycam-imagery',
      warnAfter: 3600,
      now: () => NOW,
      read: () => ({ at: ageOf(9000) }),
    })

    const { body, httpStatus } = await requestHealth()

    expect(httpStatus).toBe(200)
    expect(body.data.status).toBe('degraded')
    expect(
      body.data.checks
        .filter((check) => check.kind === FRESHNESS_CHECK_KIND)
        .map((check) => [check.name, check.result, check.detail?.source]),
    ).toEqual([
      [CHECK_NAME, 'pass', SOURCE],
      ['buoycams-freshness', 'fail', 'ndbc-buoycam-imagery'],
    ])
  })
})

describe('report compatibility with checks that are not freshness checks', () => {
  it('leaves an ordinary registered check byte-identical', async () => {
    state.config = { ...NO_DATABASE }
    registerHealthCheck({ name: 'publication', required: true, run: () => ({ ok: false }) })

    const { body, httpStatus } = await requestHealth()
    const entry = body.data.checks[2]

    expect(httpStatus).toBe(503)
    expect(Object.keys(entry ?? {})).toEqual(['name', 'required', 'result', 'durationMs'])
    expect(entry).toMatchObject({ name: 'publication', required: true, result: 'fail' })
  })

  it('carries no kind on the built-in probes', async () => {
    state.config = { ...NO_DATABASE }

    const { body } = await requestHealth()

    expect(body.data.checks.map((check) => check.kind)).toEqual([undefined, undefined])
  })

  it('refuses a kind that is not a short slug', () => {
    expect(() =>
      registerHealthCheck({
        kind: 'Not A Kind',
        name: 'publication',
        required: true,
        run: () => ({}),
      }),
    ).toThrow(/kind "Not A Kind" must be 1-32 lowercase letters/u)
  })

  it('never lets an optional check escalate itself into an error', () => {
    expect(resolveFailureRequired(false, 'error')).toBe(false)
    expect(resolveFailureRequired(true, 'degraded')).toBe(false)
    expect(resolveFailureRequired(true, 'error')).toBe(true)
    expect(resolveFailureRequired(true, undefined)).toBe(true)
    expect(resolveFailureRequired(true, 'nonsense')).toBe(true)
    expect(resolveFailureRequired(true, 'notice')).toBe(false)
  })

  it('publishes a notice failure from any check without moving the status (narduk-libs#414)', async () => {
    state.config = { ...NO_DATABASE }
    registerHealthCheck({
      name: 'upstream-lag',
      required: true,
      run: () => ({ ok: false, severity: 'notice', detail: { lagMinutes: 95 } }),
    })
    registerHealthCheck({ name: 'publication', required: false, run: () => ({}) })

    const { body, httpStatus, text } = await requestHealth()
    const entry = body.data.checks.find((check) => check.name === 'upstream-lag')

    expect(httpStatus).toBe(200)
    expect(body.data.status).toBe('ok')
    expect(text.slice(0, MONITOR_WINDOW_CHARS)).toContain(STATUS_OK)
    expect(entry).toMatchObject({
      result: 'fail',
      required: false,
      notice: true,
      detail: { lagMinutes: 95 },
    })
  })

  it('still counts a notice check that throws, at its declared severity', async () => {
    state.config = { ...NO_DATABASE }
    registerHealthCheck({
      name: 'upstream-lag',
      required: true,
      run: () => {
        throw new Error('unreachable')
      },
    })

    const { body, httpStatus } = await requestHealth()

    expect(httpStatus).toBe(503)
    expect(body.data.checks.find((check) => check.name === 'upstream-lag')?.notice).toBeUndefined()
  })
})
