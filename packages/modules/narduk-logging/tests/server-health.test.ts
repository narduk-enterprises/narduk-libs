import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  beginJobRun,
  collapseRoute,
  createErrorThrottle,
  DEFAULT_SERVER_ERROR_ROW_CAP,
  finishJobRun,
  installServerErrorCapture,
  JOB_RUNS_DDL,
  jobReports,
  jobState,
  listJobRuns,
  listServerErrors,
  recordServerError,
  runWithHeartbeat,
  scrubErrorMessage,
  SERVER_ERRORS_DDL,
  serverErrorCandidate,
  serverErrorHash,
} from '../src/server-health.js'
import type {
  D1Like,
  D1StatementLike,
  ErrorEventLike,
  ServerErrorEntry,
} from '../src/server-health.js'

function sqliteD1(raw: DatabaseSync): D1Like {
  const statement = (sql: string, values: unknown[] = []): D1StatementLike => ({
    bind: (...next) => statement(sql, next),
    run: async () => raw.prepare(sql).run(...(values as never[])),
    all: async <T>() => ({ results: raw.prepare(sql).all(...(values as never[])) as T[] }),
  })
  return {
    prepare: (sql) => statement(sql),
    batch: async (statements) => {
      for (const s of statements) await s.run()
    },
  }
}

let raw: DatabaseSync
let db: D1Like
beforeEach(() => {
  raw = new DatabaseSync(':memory:')
  raw.exec(SERVER_ERRORS_DDL)
  raw.exec(JOB_RUNS_DDL)
  db = sqliteD1(raw)
})
afterEach(() => raw.close())

const NOW = new Date('2026-10-23T12:00:00Z')
const ago = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000).toISOString()
const entry = (hash: string, at = '2026-10-23T12:00:00.000Z', count = 1): ServerErrorEntry => ({
  stackHash: hash,
  service: 'desk',
  status: 500,
  method: 'GET',
  route: '/api/x',
  message: 'Error: boom',
  requestId: 'ray-1',
  count,
  at,
})

describe('staleness rule', () => {
  it('is ok at exactly twice the interval and stale one second past it', () => {
    expect(jobState(ago(30), 15, NOW)).toBe('ok')
    expect(jobState(new Date(NOW.getTime() - 30 * 60_000 - 1000).toISOString(), 15, NOW)).toBe(
      'stale',
    )
  })
  it('keeps never-run apart from stale, and reads an unparseable stamp as stale', () => {
    expect(jobState(null, 15, NOW)).toBe('never_run')
    expect(jobState('not a date', 15, NOW)).toBe('stale')
  })
  it('reports every registered job at its own interval, in registry order', () => {
    const registry = { hourly: { intervalMinutes: 60 }, quarter: { intervalMinutes: 15 } }
    expect(
      jobReports(
        registry,
        new Map([
          ['hourly', ago(100)],
          ['quarter', ago(31)],
        ]),
        NOW,
      ).map((r) => [r.job, r.state]),
    ).toEqual([
      ['hourly', 'ok'],
      ['quarter', 'stale'],
    ])
    expect(jobReports(registry, new Map(), NOW).map((r) => r.state)).toEqual([
      'never_run',
      'never_run',
    ])
  })
})

describe('route, message and hash', () => {
  it('collapses ids and tokens and drops the query', () => {
    expect(collapseRoute('/api/orders/ord-1a2b3c4d5e6f/schedule?token=secret')).toBe(
      '/api/orders/:id/schedule',
    )
    expect(collapseRoute('/t/0123456789abcdef0123456789abcdef')).toBe('/t/:id')
    expect(collapseRoute('/api/health')).toBe('/api/health')
    expect(collapseRoute('/')).toBe('/')
  })
  it('scrubs emails and opaque runs and caps the length', () => {
    expect(scrubErrorMessage('row for a@b.example token 0123456789abcdef0123456789abcdef')).toBe(
      'row for [email] token …',
    )
    expect(scrubErrorMessage('x'.repeat(500)).length).toBeLessThanOrEqual(200)
  })
  it('stays fast on text built to backtrack', () => {
    const started = performance.now()
    scrubErrorMessage(`${'!'.repeat(200_000)}@`)
    scrubErrorMessage(`a@${'!'.repeat(200_000)}`)
    expect(performance.now() - started).toBeLessThan(200)
  })
  const stack = (line: number) =>
    `Error: boom\n    at save (file:///srv/.output/chunks/a.mjs?v=1:${line}:9)\n    at handler (file:///srv/.output/chunks/b.mjs:12:3)`
  const base = { status: 500, name: 'Error', message: 'order 41 failed', stack: stack(10) }
  it('hashes messages that differ only by a number, a column or an origin identically', () => {
    const hash = serverErrorHash(base)
    expect(hash).toMatch(/^[0-9a-f]{16}$/)
    expect(serverErrorHash({ ...base, message: 'order 977 failed' })).toBe(hash)
    expect(serverErrorHash({ ...base, stack: stack(10).replace('file:///srv', 'file:///x') })).toBe(
      hash,
    )
  })
  it('ignores the column and a query string when hashing a frame', () => {
    const frames = (location: string) => ({
      ...base,
      stack: `Error: boom\n    at save (${location})\n    at handler (file:///srv/.output/chunks/b.mjs:12:3)`,
    })
    const hash = serverErrorHash(frames('file:///srv/a.mjs:10:9'))
    expect(serverErrorHash(frames('file:///srv/a.mjs:10:99'))).toBe(hash)
    expect(serverErrorHash(frames('file:///srv/a.mjs?v=1:10:9'))).toBe(hash)
    expect(serverErrorHash(frames('file:///srv/a.mjs:10'))).toBe(hash)
    expect(serverErrorHash(frames('file:///srv/a.mjs:11:9'))).not.toBe(hash)
    expect(serverErrorHash(frames('file:///srv/c.mjs:10:9'))).not.toBe(hash)
  })
  it('hashes a frame with no line or file in linear time', () => {
    const started = performance.now()
    for (const location of ['!'.repeat(200_000), `${'!'.repeat(200_000)}:`, ':'.repeat(200_000)])
      serverErrorHash({ ...base, stack: `Error\n    at f (${location})` })
    expect(performance.now() - started).toBeLessThan(200)
  })
  it('hashes a different status, name, wording or call site differently', () => {
    const hash = serverErrorHash(base)
    for (const change of [
      { status: 503 },
      { name: 'TypeError' },
      { message: 'station 4 failed' },
      { stack: stack(11) },
    ])
      expect(serverErrorHash({ ...base, ...change })).not.toBe(hash)
  })
  it('turns only 5xx into a candidate, reading the cause when there is one', () => {
    const request = { method: 'post', path: '/api/a/ord-1a2b3c4d5e6f?x=1', requestId: 'r1' }
    expect(
      serverErrorCandidate(Object.assign(new Error('no'), { statusCode: 404 }), request, 's'),
    ).toBeNull()
    const candidate = serverErrorCandidate(
      Object.assign(new Error('wrapped'), { statusCode: 500, cause: new TypeError('bad thing') }),
      request,
      's',
    )
    expect(candidate).toMatchObject({
      method: 'POST',
      route: '/api/a/:id',
      message: 'TypeError: bad thing',
      status: 500,
      service: 's',
    })
  })
})

describe('storage bounds', () => {
  it('folds the same hash into one counted row', async () => {
    await recordServerError(db, entry('aaaa'))
    await recordServerError(db, entry('aaaa', '2026-10-23T12:05:00.000Z', 3))
    expect(await listServerErrors(db)).toEqual([
      expect.objectContaining({
        stackHash: 'aaaa',
        occurrences: 4,
        firstSeenAt: '2026-10-23T12:00:00.000Z',
        lastSeenAt: '2026-10-23T12:05:00.000Z',
      }),
    ])
  })
  it('keeps the newest occurrence when an older write lands last', async () => {
    await recordServerError(db, { ...entry('aaaa', '2026-10-23T12:05:00.000Z'), requestId: 'ray-new' })
    await recordServerError(db, { ...entry('aaaa', '2026-10-23T12:00:00.000Z'), requestId: 'ray-old' })
    expect(await listServerErrors(db)).toEqual([
      expect.objectContaining({
        occurrences: 2,
        firstSeenAt: '2026-10-23T12:00:00.000Z',
        lastSeenAt: '2026-10-23T12:05:00.000Z',
        requestId: 'ray-new',
      }),
    ])
  })

  it('keeps only the newest rows when distinct errors keep arriving', async () => {
    const cap = DEFAULT_SERVER_ERROR_ROW_CAP
    for (let i = 0; i < cap + 15; i++)
      await recordServerError(
        db,
        entry(
          `h${String(i).padStart(4, '0')}`,
          new Date(Date.UTC(2026, 9, 23, 12, 0, i)).toISOString(),
        ),
      )
    expect(raw.prepare('SELECT count(*) AS n FROM server_errors').get()).toEqual({ n: cap })
    expect((await listServerErrors(db, 1))[0]!.stackHash).toBe(
      `h${String(cap + 14).padStart(4, '0')}`,
    )
  })
  it('honours a smaller rowCap', async () => {
    for (let i = 0; i < 6; i++)
      await recordServerError(
        db,
        entry(`h${i}`, new Date(Date.UTC(2026, 9, 23, 12, 0, i)).toISOString()),
        {
          rowCap: 3,
        },
      )
    expect(raw.prepare('SELECT count(*) AS n FROM server_errors').get()).toEqual({ n: 3 })
  })
})

describe('throttle', () => {
  it('writes a hash once per window and folds suppressed repeats into the next write', () => {
    let t = 1_000_000
    const admit = createErrorThrottle({ now: () => t })
    expect(admit('a')).toBe(1)
    expect(admit('a')).toBeNull()
    expect(admit('a')).toBeNull()
    t += 60_000
    expect(admit('a')).toBe(3)
  })
  it('caps distinct writes per window and resumes in the next', () => {
    let t = 1_000_000
    const admit = createErrorThrottle({ now: () => t, maxWritesPerWindow: 5 })
    expect(
      Array.from({ length: 12 }, (_, i) => admit(`h${i}`)).filter((c) => c !== null),
    ).toHaveLength(5)
    t += 60_000
    expect(admit('h0')).toBe(1)
    expect(admit('h5')).toBe(2)
  })
})

describe('Nitro error hook', () => {
  type Hook = (error: unknown, context: { event?: ErrorEventLike }) => Promise<void> | void
  const install = (options: Partial<Parameters<typeof installServerErrorCapture>[1]> = {}) => {
    let hook!: Hook
    installServerErrorCapture(
      {
        hooks: {
          hook: (_name, fn) => {
            hook = fn as Hook
          },
        },
      },
      { service: 'desk', resolveDb: () => db, ...options },
    )
    return hook
  }
  const stackFor = (message: string) =>
    `Error: ${message}\n    at save (file:///srv/a.mjs:10:9)\n    at handler (file:///srv/b.mjs:12:3)`
  const failure = (message: string) =>
    Object.assign(new Error('wrapped'), {
      statusCode: 500,
      cause: Object.assign(new Error(message), { stack: stackFor(message) }),
    })
  const event = (path = '/api/x', headers: Record<string, string> = {}): ErrorEventLike => ({
    method: 'GET',
    path,
    node: { req: { headers } },
  })

  it('records a 5xx with a collapsed route and a scrubbed message, and ignores a 4xx', async () => {
    const hook = install()
    const e = event('/api/o/ord-1a2b3c4d5e6f/t?token=abcdefabcdefabcdefabcdef', {
      'cf-ray': 'ray-9',
    })
    await hook(Object.assign(new Error('nope'), { statusCode: 404 }), { event: e })
    expect(await listServerErrors(db)).toEqual([])
    await hook(failure('D1 failed for a@b.example'), { event: e })
    const [row] = await listServerErrors(db)
    expect(row).toMatchObject({
      status: 500,
      route: '/api/o/:id/t',
      requestId: 'ray-9',
      service: 'desk',
      occurrences: 1,
      message: 'Error: D1 failed for [email]',
    })
  })
  it('does nothing without a request or DB, and never throws when the write fails', async () => {
    const write = vi.fn(async () => {
      throw new Error('d1 down')
    })
    const onFailure = vi.fn()
    const hook = install({ write, onFailure })
    await hook(failure('x'), {})
    const noDb = install({ resolveDb: () => {}, write })
    await noDb(failure('x'), { event: event() })
    expect(write).not.toHaveBeenCalled()
    await expect(hook(failure('x'), { event: event() })).resolves.toBeUndefined()
    expect(onFailure).toHaveBeenCalledOnce()
  })
  it('stores one row for a storm of the same error', async () => {
    const hook = install()
    for (let i = 0; i < 50; i++) await hook(failure(`boom ${i}`), { event: event() })
    expect(await listServerErrors(db)).toHaveLength(1)
  })
})

describe('heartbeat', () => {
  const clock = (...at: string[]) => {
    const queue = [...at]
    return () => new Date(queue.shift() ?? at.at(-1)!)
  }

  it('records start, finish and the last success', async () => {
    await runWithHeartbeat(db, 'job', async () => [], {
      now: clock('2026-10-23T12:00:00.000Z', '2026-10-23T12:00:05.000Z'),
    })
    expect(await listJobRuns(db)).toEqual([
      {
        job: 'job',
        startedAt: '2026-10-23T12:00:00.000Z',
        finishedAt: '2026-10-23T12:00:05.000Z',
        ok: true,
        error: null,
        lastOkAt: '2026-10-23T12:00:05.000Z',
      },
    ])
  })
  it('keeps the last success across a failed step list and a throw, and rethrows', async () => {
    await runWithHeartbeat(db, 'job', async () => [], {
      now: clock('2026-10-23T12:00:00.000Z', '2026-10-23T12:00:05.000Z'),
    })
    await runWithHeartbeat(db, 'job', async () => ['news'], {
      now: clock('2026-10-23T12:15:00.000Z', '2026-10-23T12:15:05.000Z'),
    })
    expect(await listJobRuns(db)).toEqual([
      expect.objectContaining({
        ok: false,
        error: 'failed: news',
        lastOkAt: '2026-10-23T12:00:05.000Z',
      }),
    ])
    await expect(
      runWithHeartbeat(
        db,
        'job',
        async () => {
          throw new Error('d1 unavailable')
        },
        {
          now: clock('2026-10-23T12:30:00.000Z', '2026-10-23T12:30:01.000Z'),
        },
      ),
    ).rejects.toThrow('d1 unavailable')
    expect(await listJobRuns(db)).toEqual([
      expect.objectContaining({
        ok: false,
        error: 'd1 unavailable',
        lastOkAt: '2026-10-23T12:00:05.000Z',
      }),
    ])
  })
  it('shows a run that never finished as started with no outcome', async () => {
    await beginJobRun(db, 'job', '2026-10-23T12:00:00.000Z')
    await finishJobRun(db, 'job', '2026-10-23T12:00:01.000Z', { ok: true })
    await beginJobRun(db, 'job', '2026-10-23T12:15:00.000Z')
    expect(await listJobRuns(db)).toEqual([
      expect.objectContaining({
        startedAt: '2026-10-23T12:15:00.000Z',
        finishedAt: null,
        ok: null,
        lastOkAt: '2026-10-23T12:00:01.000Z',
      }),
    ])
  })
  it('lets only the run the row still holds write its outcome', async () => {
    const first = '2026-10-23T12:00:00.000Z'
    const second = '2026-10-23T12:10:00.000Z'
    await beginJobRun(db, 'job', first)
    await beginJobRun(db, 'job', second)
    await finishJobRun(db, 'job', '2026-10-23T12:11:00.000Z', {
      ok: false,
      error: 'old run',
      startedAt: first,
    })
    expect(await listJobRuns(db)).toEqual([
      expect.objectContaining({ startedAt: second, finishedAt: null, ok: null, error: null }),
    ])
    await finishJobRun(db, 'job', '2026-10-23T12:12:00.000Z', { ok: true, startedAt: second })
    expect(await listJobRuns(db)).toEqual([
      expect.objectContaining({
        startedAt: second,
        finishedAt: '2026-10-23T12:12:00.000Z',
        ok: true,
        lastOkAt: '2026-10-23T12:12:00.000Z',
      }),
    ])
  })
  it('still counts a replaced run that succeeded as the last success', async () => {
    const first = '2026-10-23T12:00:00.000Z'
    await beginJobRun(db, 'job', first)
    await beginJobRun(db, 'job', '2026-10-23T12:10:00.000Z')
    await finishJobRun(db, 'job', '2026-10-23T12:11:00.000Z', { ok: true, startedAt: first })
    expect(await listJobRuns(db)).toEqual([
      expect.objectContaining({ finishedAt: null, ok: null, lastOkAt: '2026-10-23T12:11:00.000Z' }),
    ])
  })
  it('keeps overlapping runWithHeartbeat calls from finishing each other', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    const older = runWithHeartbeat(db, 'job', async () => (await gate, []), {
      now: clock('2026-10-23T12:00:00.000Z', '2026-10-23T12:20:00.000Z'),
    })
    await vi.waitFor(async () => expect(await listJobRuns(db)).toHaveLength(1))
    await beginJobRun(db, 'job', '2026-10-23T12:10:00.000Z')
    release()
    await older
    expect(await listJobRuns(db)).toEqual([
      expect.objectContaining({
        startedAt: '2026-10-23T12:10:00.000Z',
        finishedAt: null,
        ok: null,
      }),
    ])
  })
  it('never lets a broken heartbeat table change the job', async () => {
    raw.exec('DROP TABLE job_runs')
    const onWriteError = vi.fn()
    const job = vi.fn(async () => [] as string[])
    await runWithHeartbeat(db, 'job', job, { onWriteError })
    expect(job).toHaveBeenCalledOnce()
    expect(onWriteError).toHaveBeenCalled()
  })
})
