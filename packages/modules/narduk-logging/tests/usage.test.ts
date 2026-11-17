import { DatabaseSync } from 'node:sqlite'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createUsageReporter,
  createUsageSender,
  installUsageFlush,
  listUsage,
  parseUsageBatch,
  pruneUsage,
  recordUsage,
  USAGE_COUNTS_DDL,
  USAGE_LIMITS,
  usageDay,
  usageScreenName,
  usageTotals,
} from '../src/usage.js'
import type { D1Like, D1StatementLike, UsageBatch, UsageFlushTarget } from '../src/usage.js'

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

describe('usageScreenName', () => {
  it('reduces Nuxt parameter markers to the parameter', () => {
    expect(usageScreenName('/orders/:id()')).toBe('/orders/:id')
    expect(usageScreenName('/docs/:slug(.*)*')).toBe('/docs/:slug')
    expect(usageScreenName('/a/:x()/b/:y()')).toBe('/a/:x/b/:y')
  })

  it('collapses ids a raw path still carries and drops the query and hash', () => {
    expect(usageScreenName('/orders/ord-1a2b3c4d5e?tab=history#top')).toBe('/orders/:id')
    expect(usageScreenName('/t/abcdefghijklmnopqrstuvwxyz')).toBe('/t/:id')
  })

  it('keeps the root, drops a trailing slash and refuses what is not a path', () => {
    expect(usageScreenName('/')).toBe('/')
    expect(usageScreenName('/settings/')).toBe('/settings')
    expect(usageScreenName('settings')).toBeNull()
    expect(usageScreenName('/has space')).toBeNull()
  })

  it('caps the name', () => {
    expect(usageScreenName(`/${'a'.repeat(500)}`)!.length).toBeLessThanOrEqual(USAGE_LIMITS.nameMax)
  })
})

describe('usageDay', () => {
  it('is the calendar day in the time zone asked for', () => {
    const at = new Date('2026-11-17T03:30:00Z')
    expect(usageDay(at)).toBe('2026-11-17')
    expect(usageDay(at, 'America/Chicago')).toBe('2026-11-16')
  })
})

describe('parseUsageBatch', () => {
  it('refuses what is not a batch', () => {
    expect(parseUsageBatch(null)).toBeNull()
    expect(parseUsageBatch({ items: [] })).toBeNull()
    expect(parseUsageBatch({ schemaVersion: 2, items: [{}] })).toBeNull()
    expect(parseUsageBatch({ schemaVersion: 1, items: [] })).toBeNull()
    const tooMany = Array.from({ length: USAGE_LIMITS.itemsPerBatch + 1 }, (_, i) => ({
      kind: 'event',
      name: `e${i}`,
      count: 1,
    }))
    expect(parseUsageBatch({ schemaVersion: 1, items: tooMany })).toBeNull()
  })

  it('merges, normalizes, clamps and drops bad items', () => {
    const parsed = parseUsageBatch(
      {
        schemaVersion: 1,
        items: [
          { kind: 'screen', name: '/orders/:id()', count: 2 },
          { kind: 'screen', name: '/orders/ord-1a2b3c4d5e', count: 3 },
          { kind: 'event', name: 'order_saved', count: 500 },
          { kind: 'event', name: 'Has Spaces', count: 1 },
          { kind: 'event', name: 'x', count: 0 },
          { kind: 'event', name: 'y', count: 1.5 },
          { kind: 'page', name: '/', count: 1 },
          { kind: 'screen', name: 'no-slash', count: 1 },
          { kind: 'screen', name: '/x', count: '3' },
          { kind: 'screen', name: '/x', count: { valueOf: () => 1 } },
          'junk',
        ],
      },
      { allowEvent: () => true },
    )
    expect(parsed).toEqual({
      items: [
        { kind: 'screen', name: '/orders/:id', count: 5 },
        { kind: 'event', name: 'order_saved', count: USAGE_LIMITS.countPerItem },
      ],
      dropped: 8,
    })
  })

  it('drops every event when the app gives no list of event names', () => {
    expect(
      parseUsageBatch({
        schemaVersion: 1,
        items: [
          { kind: 'event', name: 'jo_smith', count: 1 },
          { kind: 'screen', name: '/orders', count: 1 },
        ],
      }),
    ).toEqual({ items: [{ kind: 'screen', name: '/orders', count: 1 }], dropped: 1 })
  })

  it('narrows screens to the app list when asked', () => {
    expect(
      parseUsageBatch(
        {
          schemaVersion: 1,
          items: [
            { kind: 'screen', name: '/orders/:id()', count: 1 },
            { kind: 'screen', name: '/people/jo-smith', count: 1 },
          ],
        },
        { allowScreen: (name) => name === '/orders/:id' },
      ),
    ).toEqual({ items: [{ kind: 'screen', name: '/orders/:id', count: 1 }], dropped: 1 })
  })

  it('narrows events to the app list when asked', () => {
    const parsed = parseUsageBatch(
      {
        schemaVersion: 1,
        items: [
          { kind: 'event', name: 'known', count: 1 },
          { kind: 'event', name: 'unknown', count: 1 },
        ],
      },
      { allowEvent: (name) => name === 'known' },
    )
    expect(parsed).toEqual({ items: [{ kind: 'event', name: 'known', count: 1 }], dropped: 1 })
  })
})

describe('storage', () => {
  let db: D1Like
  beforeEach(() => {
    const raw = new DatabaseSync(':memory:')
    raw.exec(USAGE_COUNTS_DDL)
    db = sqliteD1(raw)
  })

  it('adds to the day row for the same role and platform, apart from others', async () => {
    const items = [{ kind: 'screen' as const, name: '/orders', count: 2 }]
    await recordUsage(db, { day: '2026-11-17', role: 'agent', platform: 'web', items })
    await recordUsage(db, { day: '2026-11-17', role: 'agent', platform: 'web', items })
    await recordUsage(db, { day: '2026-11-17', role: 'admin', platform: 'web', items })
    await recordUsage(db, { day: '2026-11-16', role: 'agent', platform: 'ios', items })
    const rows = await listUsage(db, { since: '2026-11-01' })
    expect(rows).toEqual([
      {
        day: '2026-11-17',
        kind: 'screen',
        name: '/orders',
        role: 'agent',
        platform: 'web',
        count: 4,
      },
      {
        day: '2026-11-17',
        kind: 'screen',
        name: '/orders',
        role: 'admin',
        platform: 'web',
        count: 2,
      },
      {
        day: '2026-11-16',
        kind: 'screen',
        name: '/orders',
        role: 'agent',
        platform: 'ios',
        count: 2,
      },
    ])
    expect(usageTotals(rows, 'role')).toEqual([
      { key: 'agent', count: 6 },
      { key: 'admin', count: 2 },
    ])
    expect(await listUsage(db, { since: '2026-11-17', kind: 'event' })).toEqual([])
    expect(await listUsage(db, { since: '2026-11-01', until: '2026-11-16' })).toHaveLength(1)
  })

  it('refuses a role, platform or day that is not a label', async () => {
    const items = [{ kind: 'event' as const, name: 'x', count: 1 }]
    await expect(
      recordUsage(db, { day: '2026-11-17', role: 'Ann Smith', platform: 'web', items }),
    ).rejects.toThrow(TypeError)
    await expect(
      recordUsage(db, { day: '2026-11-17', role: 'agent', platform: 'iOS 18', items }),
    ).rejects.toThrow(TypeError)
    await expect(
      recordUsage(db, { day: '17 Nov', role: 'agent', platform: 'web', items }),
    ).rejects.toThrow(TypeError)
  })

  it('prunes days before the cut-off', async () => {
    const items = [{ kind: 'event' as const, name: 'x', count: 1 }]
    await recordUsage(db, { day: '2026-08-01', role: 'agent', platform: 'web', items })
    await recordUsage(db, { day: '2026-11-17', role: 'agent', platform: 'web', items })
    await pruneUsage(db, '2026-11-01')
    expect((await listUsage(db, { since: '2000-01-01' })).map((r) => r.day)).toEqual(['2026-11-17'])
  })

  it('has no column for a person', () => {
    expect(USAGE_COUNTS_DDL).not.toMatch(/user|session|ip|email|account/i)
  })
})

describe('createUsageReporter', () => {
  it('batches counts and ignores a repeat of the screen just counted', () => {
    const sent: UsageBatch[] = []
    const reporter = createUsageReporter({ send: (batch) => sent.push(batch) })
    reporter.screen('/orders')
    reporter.screen('/orders?tab=2')
    reporter.screen('/orders/:id()')
    reporter.screen('/orders')
    reporter.event('order_saved')
    reporter.event('order_saved')
    reporter.event('Not An Event')
    expect(reporter.flush()).toEqual({
      schemaVersion: 1,
      items: [
        { kind: 'screen', name: '/orders', count: 2 },
        { kind: 'screen', name: '/orders/:id', count: 1 },
        { kind: 'event', name: 'order_saved', count: 2 },
      ],
    })
    expect(sent).toHaveLength(1)
    expect(reporter.flush()).toBeNull()
    expect(sent).toHaveLength(1)
  })

  it('flushes by itself at maxPending and survives a throwing send', () => {
    const send = vi.fn(() => {
      throw new Error('offline')
    })
    const reporter = createUsageReporter({ send, maxPending: 2 })
    reporter.event('a')
    expect(send).not.toHaveBeenCalled()
    reporter.event('b')
    expect(send).toHaveBeenCalledTimes(1)
  })
})

describe('createUsageSender', () => {
  it('posts same-origin with keepalive and the app headers', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }))
    const send = createUsageSender({
      endpoint: '/api/usage',
      fetch: fetchMock as unknown as typeof fetch,
      headers: { 'x-requested-with': 'XMLHttpRequest' },
    })
    send({ schemaVersion: 1, items: [{ kind: 'event', name: 'a', count: 1 }] })
    expect(fetchMock).toHaveBeenCalledWith('/api/usage', {
      method: 'POST',
      credentials: 'same-origin',
      redirect: 'error',
      keepalive: true,
      headers: { 'content-type': 'application/json', 'x-requested-with': 'XMLHttpRequest' },
      body: '{"schemaVersion":1,"items":[{"kind":"event","name":"a","count":1}]}',
    })
  })

  it('refuses an endpoint on another origin', () => {
    expect(() => createUsageSender({ endpoint: 'https://example.com/u' })).toThrow(TypeError)
    expect(() => createUsageSender({ endpoint: '//example.com/u' })).toThrow(TypeError)
    expect(() => createUsageSender({ endpoint: '/\\example.com/u' })).toThrow(TypeError)
    expect(() => createUsageSender({ endpoint: 'api/usage' })).toThrow(TypeError)
    expect(() => createUsageSender({ endpoint: '/\t\\example.com/u' })).toThrow(TypeError)
    expect(() => createUsageSender({ endpoint: '/\n/example.com/u' })).toThrow(TypeError)
    expect(() => createUsageSender({ endpoint: '/api/usage' })).not.toThrow()
  })
})

describe('installUsageFlush', () => {
  it('flushes when the page hides and stops after dispose', () => {
    const listeners = new Map<string, () => void>()
    const doc = {
      visibilityState: 'visible',
      addEventListener: (type: string, fn: () => void) => listeners.set(`doc:${type}`, fn),
      removeEventListener: (type: string) => listeners.delete(`doc:${type}`),
    }
    const target: UsageFlushTarget = {
      addEventListener: (type, fn) => listeners.set(type, fn),
      removeEventListener: (type) => listeners.delete(type),
      document: doc,
    }
    const flush = vi.fn(() => null)
    const dispose = installUsageFlush({ screen() {}, event() {}, flush }, target)
    listeners.get('doc:visibilitychange')!()
    expect(flush).not.toHaveBeenCalled()
    doc.visibilityState = 'hidden'
    listeners.get('doc:visibilitychange')!()
    listeners.get('pagehide')!()
    expect(flush).toHaveBeenCalledTimes(2)
    dispose()
    expect(listeners.size).toBe(0)
  })
})
