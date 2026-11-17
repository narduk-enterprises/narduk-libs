import { DatabaseSync } from 'node:sqlite'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  BROWSER_ERRORS_DDL,
  CLIENT_ERROR_LIMITS,
  clientErrorEntry,
  createClientErrorReporter,
  DEFAULT_CLIENT_ERROR_ROW_CAP,
  describeClientError,
  listClientErrors,
  parseClientErrorReport,
  recordClientError,
} from '../src/client-errors.js'
import type { ClientErrorReport, D1Like, D1StatementLike } from '../src/client-errors.js'

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

const report = (over: Partial<ClientErrorReport> = {}): ClientErrorReport => ({
  message: 'Cannot read properties of undefined',
  path: '/orders/ord-1a2b3c4d5e6f',
  release: 'abc1234',
  requestId: null,
  ...over,
})

describe('parseClientErrorReport', () => {
  it('accepts exactly the four fields within their limits', () => {
    expect(parseClientErrorReport(report())).toEqual(report())
    expect(parseClientErrorReport(report({ requestId: 'ray-5' }))?.requestId).toBe('ray-5')
  })

  it('refuses extra fields, missing fields, bad types and oversize values', () => {
    expect(parseClientErrorReport({ ...report(), stack: 'at x' })).toBeNull()
    const { release: _release, ...missing } = report()
    expect(parseClientErrorReport(missing)).toBeNull()
    expect(parseClientErrorReport(report({ message: '' }))).toBeNull()
    expect(
      parseClientErrorReport(report({ message: 'x'.repeat(CLIENT_ERROR_LIMITS.messageMax + 1) })),
    ).toBeNull()
    expect(
      parseClientErrorReport(report({ path: '/'.repeat(CLIENT_ERROR_LIMITS.pathMax + 1) })),
    ).toBeNull()
    expect(
      parseClientErrorReport(report({ release: 'r'.repeat(CLIENT_ERROR_LIMITS.releaseMax + 1) })),
    ).toBeNull()
    expect(parseClientErrorReport(report({ requestId: '<b>' }))).toBeNull()
    expect(parseClientErrorReport({ ...report(), requestId: 7 })).toBeNull()
    expect(parseClientErrorReport([report()])).toBeNull()
    expect(parseClientErrorReport(null)).toBeNull()
  })
})

describe('storage', () => {
  let db: D1Like
  beforeEach(() => {
    const raw = new DatabaseSync(':memory:')
    raw.exec(BROWSER_ERRORS_DDL)
    db = sqliteD1(raw)
  })

  it('collapses the route, scrubs the message and sums repeats into one row', async () => {
    const first = clientErrorEntry(
      report({ message: 'boom for jo@example.com', requestId: 'ray-1' }),
      'yard',
      '2026-11-17T10:00:00.000Z',
    )
    const again = clientErrorEntry(
      report({ message: 'boom for jo@example.com', path: '/orders/ord-9z9z9z9z9z' }),
      'yard',
      '2026-11-17T11:00:00.000Z',
      3,
    )
    expect(again.errorHash).toBe(first.errorHash)
    await recordClientError(db, first)
    await recordClientError(db, again)
    expect(await listClientErrors(db)).toEqual([
      {
        errorHash: first.errorHash,
        service: 'yard',
        route: '/orders/:id',
        message: 'boom for [email]',
        release: 'abc1234',
        requestId: 'ray-1',
        occurrences: 4,
        firstSeenAt: '2026-11-17T10:00:00.000Z',
        lastSeenAt: '2026-11-17T11:00:00.000Z',
      },
    ])
  })

  it('keeps only the newest rows', async () => {
    for (let i = 0; i < 3; i++) {
      await recordClientError(
        db,
        clientErrorEntry(
          report({ message: `distinct ${'abcdefghij'[i]}` }),
          'yard',
          `2026-11-17T1${i}:00:00.000Z`,
        ),
        { rowCap: 2 },
      )
    }
    const rows = await listClientErrors(db)
    expect(rows.map((r) => r.message)).toEqual(['distinct c', 'distinct b'])
    expect(DEFAULT_CLIENT_ERROR_ROW_CAP).toBe(200)
  })
})

describe('createClientErrorReporter', () => {
  const setup = (path = '/orders/ord-1?tab=notes&email=a@b.co#top') => {
    const sent: ClientErrorReport[] = []
    const send = createClientErrorReporter({
      send: (r) => sent.push(r),
      release: 'abc1234',
      path: () => path,
    })
    return { sent, send }
  }

  it('sends the message, the path without query or fragment, the release and no request id', () => {
    const { sent, send } = setup()
    send(new Error('boom'))
    expect(sent).toEqual([
      { message: 'boom', path: '/orders/ord-1', release: 'abc1234', requestId: null },
    ])
  })

  it('drops repeats and stops after the per-page cap', () => {
    const { sent, send } = setup()
    send(new Error('same'))
    send(new Error('same'))
    for (let i = 0; i < 10; i++) send(new Error(`distinct ${i}`))
    expect(sent).toHaveLength(CLIENT_ERROR_LIMITS.perPageLoad)
    expect(sent.filter((r) => r.message === 'same')).toHaveLength(1)
  })

  it('never reports the contents of a thrown object, and stays under the body cap', () => {
    const { sent, send } = setup('/' + 'é'.repeat(300))
    send({ password: 'hunter2' })
    send(new Error('語'.repeat(500)))
    expect(sent[0]!.message).toBe('Non-error value thrown')
    expect(JSON.stringify(sent)).not.toContain('hunter2')
    for (const r of sent)
      expect(new TextEncoder().encode(JSON.stringify(r)).length).toBeLessThanOrEqual(
        CLIENT_ERROR_LIMITS.bodyMaxBytes,
      )
  })

  it('ignores aborted requests and reads a well-formed request id', () => {
    const { sent, send } = setup()
    send(Object.assign(new Error('aborted'), { name: 'AbortError' }))
    expect(sent).toEqual([])
    expect(
      describeClientError(Object.assign(new Error('x'), { data: { requestId: 'ray-1' } }))
        ?.requestId,
    ).toBe('ray-1')
    expect(
      describeClientError(
        Object.assign(new Error('x'), { response: { headers: { get: () => 'ray-2' } } }),
      )?.requestId,
    ).toBe('ray-2')
    expect(
      describeClientError(Object.assign(new Error('x'), { data: { requestId: '<b>' } }))?.requestId,
    ).toBeNull()
  })
})
