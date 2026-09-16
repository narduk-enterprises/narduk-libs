/// <reference types="@cloudflare/workers-types" />
import { createServer } from 'node:http'

import { createApp, defineEventHandler, toNodeListener } from 'h3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import healthHandler from '../runtime/server/api/health.get'
import {
  getHealthCheckRegistry,
  type HealthCheckContext,
  type HealthCheckDefinition,
  MAX_HEALTH_CHECK_DETAIL_BYTES,
  sanitizeHealthCheckDetail,
} from '../runtime/server/health/checks'
import { buildHealthReport, DATABASE_PROBE_TIMEOUT_MS } from '../runtime/server/health/report'
import { registerHealthCheck } from '../runtime/server/utils/health-checks'

import type { H3Event } from 'h3'

const { state, logger, probeDatabaseConnection } = vi.hoisted(() => {
  const logger = {
    error: vi.fn(),
    child: () => logger,
  }
  return {
    state: {
      config: {} as Record<string, unknown>,
      env: undefined as Record<string, unknown> | undefined,
    },
    logger,
    probeDatabaseConnection: vi.fn(),
  }
})

vi.mock('nitropack/runtime', () => ({ useRuntimeConfig: () => state.config }))
vi.mock('../runtime/server/utils/logger', () => ({ useLogger: () => logger }))
vi.mock('../runtime/server/utils/database', () => ({ probeDatabaseConnection }))

/** Monitors such as watchdog-uptime match substrings in this much of the body. */
const MONITOR_WINDOW_CHARS = 4096
/** The substring uptime monitors treat as healthy. */
const STATUS_OK = '"status":"ok"'
const AUTH_TABLES_CHECK = 'auth-tables'

interface HealthCheckBody {
  detail?: Record<string, unknown>
  detailOmitted?: string
  durationMs?: number
  error?: string
  name: string
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
  const app = createApp()
    .use(
      defineEventHandler((event) => {
        if (state.env) {
          event.context.cloudflare = { env: state.env }
        }
      }),
    )
    .use(healthHandler)
  const server = createServer(toNodeListener(app))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Expected TCP listener')
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/health`)
    const text = await response.text()
    return {
      httpStatus: response.status,
      cacheControl: response.headers.get('cache-control'),
      text,
      body: JSON.parse(text) as HealthBody,
    }
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
  }
}

function fakeD1(
  options: {
    error?: Error
    tables?: string[]
    waitFor?: Promise<unknown>
  } = {},
) {
  const queries: string[] = []
  const db = {
    prepare(sql: string) {
      queries.push(sql)
      return {
        async all() {
          await options.waitFor
          if (options.error) throw options.error
          if (sql.includes('sqlite_master')) {
            return { results: (options.tables ?? []).map((name) => ({ name })) }
          }
          return { results: [{ 1: 1 }] }
        },
      }
    },
  }
  return { db: db as unknown as D1Database, queries }
}

const NO_DATABASE = { databaseBackend: 'none', databaseBackendSource: 'option' }
const DECLARED_D1 = { databaseBackend: 'd1', databaseBackendSource: 'option' }
const ALL_AUTH_TABLES = ['api_keys', 'sessions', 'users']
const SKIPPED_BUILT_INS: HealthCheckBody[] = [
  { name: 'database', required: false, result: 'skipped', reason: 'not-configured' },
  { name: AUTH_TABLES_CHECK, required: false, result: 'skipped', reason: 'auth-not-enabled' },
]

function neverSettles({ signal }: HealthCheckContext) {
  return new Promise<undefined>((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason))
  })
}

beforeEach(() => {
  state.config = {}
  state.env = undefined
  logger.error.mockReset()
  probeDatabaseConnection.mockReset()
})

afterEach(() => {
  getHealthCheckRegistry().clear()
  vi.useRealTimers()
})

describe('GET /api/health without a database', () => {
  it('reports ok with the database not applicable and nothing probed', async () => {
    state.config = { ...NO_DATABASE }
    const d1 = fakeD1()
    state.env = { DB: d1.db }

    const { httpStatus, cacheControl, body } = await requestHealth()

    expect(httpStatus).toBe(200)
    expect(cacheControl).toBe('no-store')
    expect(body.success).toBe(true)
    expect(Object.keys(body.data)).toEqual([
      'status',
      'timestamp',
      'database',
      'missingAuthTables',
      'checks',
    ])
    expect(body.data).toMatchObject({
      status: 'ok',
      database: 'not_applicable',
      missingAuthTables: [],
      checks: SKIPPED_BUILT_INS,
    })
    expect(Number.isNaN(Date.parse(body.data.timestamp))).toBe(false)
    expect(d1.queries).toEqual([])
    expect(probeDatabaseConnection).not.toHaveBeenCalled()
  })
})

describe('GET /api/health with D1', () => {
  it.each(['option', 'env', 'runtimeConfig'])(
    'fails a D1 database declared by %s when the binding is missing (Q2: error)',
    async (databaseBackendSource) => {
      state.config = { databaseBackend: 'd1', databaseBackendSource }

      const { httpStatus, body } = await requestHealth()

      expect(httpStatus).toBe(503)
      expect(body.data).toMatchObject({ status: 'error', database: 'not_available' })
      expect(body.data.checks[0]).toEqual({
        name: 'database',
        required: true,
        result: 'fail',
        error: 'D1 binding DB is not configured.',
      })
      expect(logger.error).toHaveBeenCalled()
    },
  )

  it.each([['default'], [undefined]])(
    'keeps an undeclared D1 default without a binding degraded (source %s)',
    async (databaseBackendSource) => {
      state.config = { databaseBackend: 'd1', databaseBackendSource }

      const { httpStatus, body } = await requestHealth()

      expect(httpStatus).toBe(200)
      expect(body.data).toMatchObject({ status: 'degraded', database: 'not_available' })
      expect(body.data.checks).toEqual([
        {
          name: 'database',
          required: false,
          result: 'fail',
          error:
            "D1 binding DB is not configured. Declare databaseBackend 'none' if this app has no database.",
        },
        SKIPPED_BUILT_INS[1],
      ])
    },
  )

  it('probes D1 with SELECT 1 when narduk-auth is not installed', async () => {
    state.config = { ...DECLARED_D1 }
    const d1 = fakeD1()
    state.env = { DB: d1.db }

    const { httpStatus, body } = await requestHealth()

    expect(httpStatus).toBe(200)
    expect(d1.queries).toEqual(['SELECT 1'])
    expect(body.data).toMatchObject({ status: 'ok', database: 'ok', missingAuthTables: [] })
    expect(body.data.checks).toEqual([
      { name: 'database', required: true, result: 'pass', durationMs: expect.any(Number) },
      SKIPPED_BUILT_INS[1],
    ])
  })

  it.each([
    ['the narduk-auth health flag', { nardukHealth: { authTables: true } }],
    ['an authBackend from an older narduk-auth', { authBackend: 'local' }],
  ])('verifies the auth tables when narduk-auth is detected by %s', async (_label, auth) => {
    state.config = { ...DECLARED_D1, ...auth }
    const d1 = fakeD1({ tables: ALL_AUTH_TABLES })
    state.env = { DB: d1.db }

    const { httpStatus, body } = await requestHealth()

    expect(httpStatus).toBe(200)
    expect(d1.queries).toHaveLength(1)
    expect(d1.queries[0]).toContain('FROM sqlite_master')
    expect(body.data).toMatchObject({ status: 'ok', database: 'ok', missingAuthTables: [] })
    expect(body.data.checks[1]).toEqual({
      name: AUTH_TABLES_CHECK,
      required: false,
      result: 'pass',
    })
  })

  it('reports missing auth tables as degraded, not as a failed database', async () => {
    state.config = { ...DECLARED_D1, nardukHealth: { authTables: true } }
    state.env = { DB: fakeD1({ tables: ['api_keys', 'users'] }).db }

    const { httpStatus, body } = await requestHealth()

    expect(httpStatus).toBe(200)
    expect(body.data).toMatchObject({
      status: 'degraded',
      database: 'schema_error',
      missingAuthTables: ['sessions'],
    })
    expect(body.data.checks).toEqual([
      { name: 'database', required: true, result: 'pass', durationMs: expect.any(Number) },
      {
        name: AUTH_TABLES_CHECK,
        required: false,
        result: 'fail',
        error: 'Required auth tables are missing.',
      },
    ])
  })

  it.each([
    ['declared', DECLARED_D1],
    ['undeclared', { databaseBackend: 'd1', databaseBackendSource: 'default' }],
  ])('answers 503 with fixed text when a %s D1 binding throws', async (_label, config) => {
    state.config = { ...config, nardukHealth: { authTables: true } }
    state.env = { DB: fakeD1({ error: new Error('D1_ERROR: internal detail 7f3a') }).db }

    const { httpStatus, text, body } = await requestHealth()

    expect(httpStatus).toBe(503)
    expect(body.data).toMatchObject({ status: 'error', database: 'error' })
    expect(body.data.checks).toEqual([
      {
        name: 'database',
        required: true,
        result: 'fail',
        durationMs: expect.any(Number),
        error: 'Database probe failed.',
      },
      {
        name: AUTH_TABLES_CHECK,
        required: false,
        result: 'skipped',
        reason: 'database-unavailable',
      },
    ])
    expect(text).not.toContain('internal detail')
    expect(logger.error).toHaveBeenCalledWith('Health check DB probe failed')
  })
})

describe('GET /api/health with Postgres', () => {
  it('passes when the connection probe succeeds and skips the D1-only table probe', async () => {
    state.config = {
      databaseBackend: 'postgres',
      databaseBackendSource: 'env',
      authBackend: 'local',
    }
    probeDatabaseConnection.mockResolvedValue(undefined)

    const { httpStatus, body } = await requestHealth()

    expect(httpStatus).toBe(200)
    expect(probeDatabaseConnection).toHaveBeenCalledTimes(1)
    expect(body.data).toMatchObject({ status: 'ok', database: 'ok' })
    expect(body.data.checks).toEqual([
      { name: 'database', required: true, result: 'pass', durationMs: expect.any(Number) },
      {
        name: AUTH_TABLES_CHECK,
        required: false,
        result: 'skipped',
        reason: 'unsupported-backend',
      },
    ])
  })

  it('answers 503 when the connection probe fails', async () => {
    state.config = { databaseBackend: 'postgres', databaseBackendSource: 'env' }
    probeDatabaseConnection.mockRejectedValue(new Error('password authentication failed'))

    const { httpStatus, text, body } = await requestHealth()

    expect(httpStatus).toBe(503)
    expect(body.data).toMatchObject({ status: 'error', database: 'error' })
    expect(body.data.checks[0]).toMatchObject({ result: 'fail', error: 'Database probe failed.' })
    expect(text).not.toContain('password')
  })
})

describe('registered health checks', () => {
  it('reports a passing check with its detail after the built-in probes', async () => {
    state.config = { ...NO_DATABASE }
    registerHealthCheck({
      name: 'publication',
      required: true,
      run: () => ({ detail: { releaseId: 'r-42', freshness: { ageSeconds: 30 } } }),
    })

    const { httpStatus, body } = await requestHealth()

    expect(httpStatus).toBe(200)
    expect(body.data.status).toBe('ok')
    expect(body.data.checks).toEqual([
      ...SKIPPED_BUILT_INS,
      {
        name: 'publication',
        required: true,
        result: 'pass',
        durationMs: expect.any(Number),
        detail: { releaseId: 'r-42', freshness: { ageSeconds: 30 } },
      },
    ])
  })

  it('passes a check whose run resolves to nothing', async () => {
    state.config = { ...NO_DATABASE }
    registerHealthCheck({ name: 'quiet', required: true, run: async () => {} })

    const { httpStatus, body } = await requestHealth()

    expect(httpStatus).toBe(200)
    expect(body.data.checks[2]).toEqual({
      name: 'quiet',
      required: true,
      result: 'pass',
      durationMs: expect.any(Number),
    })
  })

  it.each([
    { required: true, httpStatus: 503, status: 'error' },
    { required: false, httpStatus: 200, status: 'degraded' },
  ])(
    'answers $httpStatus with status $status when a check with required=$required fails (Q1: 503 on failure)',
    async ({ required, httpStatus, status }) => {
      state.config = { ...NO_DATABASE }
      registerHealthCheck({ name: 'passing', required: true, run: () => {} })
      registerHealthCheck({ name: 'failing', required, run: () => ({ ok: false }) })

      const response = await requestHealth()

      expect(response.httpStatus).toBe(httpStatus)
      expect(response.body.data.status).toBe(status)
      expect(response.cacheControl).toBe('no-store')
    },
  )

  it.each<[string, HealthCheckDefinition['run'], number | undefined, Partial<HealthCheckBody>]>([
    [
      'throws',
      () => {
        throw new Error('upstream token=abc123 rejected')
      },
      undefined,
      { error: 'Check failed.' },
    ],
    [
      'rejects',
      async () => Promise.reject(new Error('upstream token=abc123 rejected')),
      undefined,
      { error: 'Check failed.' },
    ],
    [
      'returns ok: false',
      () => ({ ok: false, detail: { releaseId: 'r-1' } }),
      undefined,
      { detail: { releaseId: 'r-1' } },
    ],
    ['times out', neverSettles, 25, { error: 'Check timed out after 25 ms.' }],
  ])('fails a check that %s with public text only', async (_label, run, timeoutMs, expected) => {
    state.config = { ...NO_DATABASE }
    registerHealthCheck({ name: 'upstream', required: true, run, timeoutMs })

    const { httpStatus, text, body } = await requestHealth()

    expect(httpStatus).toBe(503)
    expect(body.data.checks[2]).toEqual({
      name: 'upstream',
      required: true,
      result: 'fail',
      durationMs: expect.any(Number),
      ...expected,
    })
    expect(text).not.toContain('abc123')
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Health check'),
      expect.objectContaining({ check: 'upstream' }),
    )
  })

  it('aborts the signal of a check that times out', async () => {
    state.config = { ...NO_DATABASE }
    let observed: AbortSignal | undefined
    registerHealthCheck({
      name: 'slow',
      required: false,
      timeoutMs: 10,
      run: (context) => {
        observed = context.signal
        return neverSettles(context)
      },
    })

    const { body } = await requestHealth()

    expect(body.data.status).toBe('degraded')
    expect(observed?.aborted).toBe(true)
  })

  it('runs registered checks and the database probe concurrently', async () => {
    state.config = { ...DECLARED_D1 }
    let firstStarted!: () => void
    const firstRunning = new Promise<void>((resolve) => {
      firstStarted = resolve
    })
    let secondStarted!: () => void
    const secondRunning = new Promise<void>((resolve) => {
      secondStarted = resolve
    })
    // Each party waits for another to start, so any sequential order times out.
    state.env = { DB: fakeD1({ waitFor: secondRunning }).db }
    registerHealthCheck({
      name: 'first',
      required: true,
      timeoutMs: 2000,
      async run() {
        firstStarted()
        await secondRunning
      },
    })
    registerHealthCheck({
      name: 'second',
      required: true,
      timeoutMs: 2000,
      async run() {
        secondStarted()
        await firstRunning
      },
    })

    const { httpStatus, body } = await requestHealth()

    expect(httpStatus).toBe(200)
    expect(body.data.checks.map((check) => [check.name, check.result])).toEqual([
      ['database', 'pass'],
      [AUTH_TABLES_CHECK, 'skipped'],
      ['first', 'pass'],
      ['second', 'pass'],
    ])
  })

  it('keeps registration order, replaces a name, and unregisters only its own check', async () => {
    state.config = { ...NO_DATABASE }
    registerHealthCheck({ name: 'zeta', required: false, run: () => ({ detail: { v: 1 } }) })
    const unregisterOldAlpha = registerHealthCheck({
      name: 'alpha',
      required: false,
      run: () => {},
    })
    registerHealthCheck({ name: 'alpha', required: true, run: () => ({ detail: { v: 2 } }) })
    unregisterOldAlpha()

    let { body } = await requestHealth()
    expect(body.data.checks.slice(2).map((check) => [check.name, check.required])).toEqual([
      ['zeta', false],
      ['alpha', true],
    ])

    const unregisterBeta = registerHealthCheck({ name: 'beta', required: true, run: () => {} })
    unregisterBeta()
    ;({ body } = await requestHealth())
    expect(body.data.checks.map((check) => check.name)).toEqual([
      'database',
      AUTH_TABLES_CHECK,
      'zeta',
      'alpha',
    ])
  })
})

describe('monitor safety', () => {
  it.each<[string, () => void]>([
    [
      'a failing check whose detail claims status ok',
      () => {
        state.config = { ...NO_DATABASE }
        registerHealthCheck({
          name: 'publication',
          required: true,
          run: () => ({ ok: false, detail: { status: 'ok' } }),
        })
      },
    ],
    [
      'a failing check whose nested detail claims status and database ok',
      () => {
        state.config = { ...NO_DATABASE }
        registerHealthCheck({
          name: 'publication',
          required: true,
          run: () => {
            throw new Error('{"status":"ok","database":"ok"}')
          },
        })
        registerHealthCheck({
          name: 'mirror',
          required: false,
          run: () => ({ detail: { upstream: { database: 'ok', status: 'ok' } } }),
        })
      },
    ],
    ['a declared D1 app without its binding', () => (state.config = { ...DECLARED_D1 })],
    [
      'a Postgres app whose probe fails',
      () => {
        state.config = { databaseBackend: 'postgres', databaseBackendSource: 'env' }
        probeDatabaseConnection.mockRejectedValue(new Error(STATUS_OK))
      },
    ],
  ])('never serves "status":"ok" for %s', async (_label, arrange) => {
    arrange()

    const { httpStatus, text, body } = await requestHealth()

    expect(httpStatus).toBe(503)
    expect(body.data.status).toBe('error')
    expect(text).not.toContain(STATUS_OK)
    expect(text).not.toContain('"database":"ok"')
    expect(text.indexOf('"status":"error"')).toBeGreaterThanOrEqual(0)
    expect(text.indexOf('"status":"error"')).toBeLessThan(MONITOR_WINDOW_CHARS)
  })

  it('omits check details that carry reserved keys', async () => {
    state.config = { ...NO_DATABASE }
    registerHealthCheck({
      name: 'mirror',
      required: false,
      run: () => ({ detail: { upstream: { database: 'ok' } } }),
    })

    const { body } = await requestHealth()

    expect(body.data.checks[2]).toEqual({
      name: 'mirror',
      required: false,
      result: 'pass',
      durationMs: expect.any(Number),
      detailOmitted: 'reserved-key',
    })
  })

  it.each([
    {
      outcome: 'passing',
      ok: true,
      httpStatus: 200,
      key: STATUS_OK,
      database: '"database":"not_applicable"',
    },
    {
      outcome: 'failing',
      ok: false,
      httpStatus: 503,
      key: '"status":"error"',
      database: '"database":"not_applicable"',
    },
  ])(
    'serves status and database within the first 4096 characters of a large $outcome body',
    async ({ ok, httpStatus, key, database }) => {
      state.config = { ...NO_DATABASE }
      for (let index = 0; index < 20; index += 1) {
        registerHealthCheck({
          name: `check-${index}`,
          required: true,
          run: () => ({ ok, detail: { note: 'x'.repeat(900) } }),
        })
      }

      const response = await requestHealth()

      expect(response.httpStatus).toBe(httpStatus)
      expect(response.text.length).toBeGreaterThan(MONITOR_WINDOW_CHARS * 4)
      const head = response.text.slice(0, MONITOR_WINDOW_CHARS)
      expect(head).toContain(key)
      expect(head).toContain(database)
      expect(response.text.split(key)).toHaveLength(2)
    },
  )
})

describe('health check timeouts', () => {
  const event = (env: Record<string, unknown>) =>
    ({ context: { cloudflare: { env } } }) as unknown as H3Event

  it('fails a database probe that exceeds its timeout', async () => {
    vi.useFakeTimers()
    const hanging = fakeD1({ waitFor: new Promise(() => {}) })

    const pending = buildHealthReport(event({ DB: hanging.db }), DECLARED_D1, logger)
    await vi.advanceTimersByTimeAsync(DATABASE_PROBE_TIMEOUT_MS)
    const report = await pending

    expect(report.status).toBe('error')
    expect(report.database).toBe('error')
    expect(report.checks[0]).toMatchObject({
      name: 'database',
      required: true,
      result: 'fail',
      error: 'Database probe timed out after 5000 ms.',
    })
    expect(logger.error).toHaveBeenCalledWith('Health check DB probe timed out')
  })

  it('gives a registered check 3000 ms by default', async () => {
    vi.useFakeTimers()
    registerHealthCheck({ name: 'slow', required: true, run: neverSettles })

    const pending = buildHealthReport(event({}), NO_DATABASE, logger)
    await vi.advanceTimersByTimeAsync(2999)
    const stillRunning = Symbol('still running')
    expect(await Promise.race([pending, Promise.resolve(stillRunning)])).toBe(stillRunning)
    await vi.advanceTimersByTimeAsync(1)
    const report = await pending

    expect(report.checks[2]).toMatchObject({
      name: 'slow',
      result: 'fail',
      error: 'Check timed out after 3000 ms.',
    })
  })
})

describe('registerHealthCheck validation', () => {
  const run = () => {}

  it.each<[string, unknown, string]>([
    ['a missing definition', undefined, 'expects a check definition object'],
    ['an uppercase name', { name: 'Publication', required: true, run }, 'must be 1-63 lowercase'],
    ['an empty name', { name: '', required: true, run }, 'must be 1-63 lowercase'],
    ['a name with quotes', { name: 'a"b', required: true, run }, 'must be 1-63 lowercase'],
    [
      'a 64-character name',
      { name: 'a'.repeat(64), required: true, run },
      'must be 1-63 lowercase',
    ],
    ['the database probe name', { name: 'database', required: true, run }, 'reserved'],
    ['the auth-tables probe name', { name: AUTH_TABLES_CHECK, required: false, run }, 'reserved'],
    [
      'no required flag',
      { name: 'publication', run },
      'must set required: true or required: false',
    ],
    ['no run function', { name: 'publication', required: true }, 'needs a run function'],
    ['a zero timeout', { name: 'publication', required: true, run, timeoutMs: 0 }, 'timeoutMs'],
    [
      'a fractional timeout',
      { name: 'publication', required: true, run, timeoutMs: 1.5 },
      'timeoutMs',
    ],
    [
      'a timeout above 30000 ms',
      { name: 'publication', required: true, run, timeoutMs: 30_001 },
      'timeoutMs',
    ],
  ])('rejects %s', (_label, definition, message) => {
    expect(() => registerHealthCheck(definition as HealthCheckDefinition)).toThrow(TypeError)
    expect(() => registerHealthCheck(definition as HealthCheckDefinition)).toThrow(message)
    expect(getHealthCheckRegistry().size).toBe(0)
  })
})

describe('sanitizeHealthCheckDetail', () => {
  const circular: Record<string, unknown> = {}
  circular.self = circular

  it.each<[string, unknown, ReturnType<typeof sanitizeHealthCheckDetail>]>([
    ['no detail', undefined, {}],
    ['a JSON object', { releaseId: 'r-1', count: 2 }, { detail: { releaseId: 'r-1', count: 2 } }],
    ['a Date value', { at: new Date(0) }, { detail: { at: '1970-01-01T00:00:00.000Z' } }],
    ['null', null, { detailOmitted: 'not-an-object' }],
    ['an array', ['r-1'], { detailOmitted: 'not-an-object' }],
    ['a string', 'r-1', { detailOmitted: 'not-an-object' }],
    ['a circular object', circular, { detailOmitted: 'not-serializable' }],
    ['a BigInt value', { size: 1n }, { detailOmitted: 'not-serializable' }],
    ['a top-level status key', { status: 'fresh' }, { detailOmitted: 'reserved-key' }],
    ['a nested database key', { a: [{ database: 1 }] }, { detailOmitted: 'reserved-key' }],
    ['a key that embeds a quote', { 'x"status': 1 }, { detailOmitted: 'reserved-key' }],
    ['a value that only mentions status', { note: STATUS_OK }, { detail: { note: STATUS_OK } }],
    [
      'detail over the size limit',
      { note: 'x'.repeat(MAX_HEALTH_CHECK_DETAIL_BYTES) },
      { detailOmitted: 'too-large' },
    ],
  ])('handles %s', (_label, detail, expected) => {
    expect(sanitizeHealthCheckDetail(detail)).toEqual(expected)
  })

  it('never lets an allowed value put the reserved substring into the body', () => {
    const { detail } = sanitizeHealthCheckDetail({ note: STATUS_OK })
    expect(JSON.stringify(detail)).not.toContain(STATUS_OK)
  })
})
