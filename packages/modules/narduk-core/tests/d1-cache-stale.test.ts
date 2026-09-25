/// <reference types="@cloudflare/workers-types" />
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { withD1Cache } from '../runtime/server/utils/d1Cache'

import type { H3Event } from 'h3'

vi.mock('nitropack/runtime', () => ({
  useRuntimeConfig: () => ({}),
}))

const NOW = new Date('2026-09-25T12:00:00.000Z')
const NOW_SEC = NOW.getTime() / 1000

function createD1(row: { expires_at: number; value: string } | null) {
  const writes: Array<{ expiresAt: number; key: string; value: string }> = []
  const db = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async first() {
              return sql.startsWith('SELECT') ? row : null
            },
            async run() {
              const [key, value, expiresAt] = args as [string, string, number]
              writes.push({ expiresAt, key, value })
              return { meta: { changes: 1 } }
            },
          }
        },
      }
    },
  } as unknown as D1Database
  return { db, writes }
}

function createEvent(db: D1Database, host: Record<string, unknown> = {}): H3Event {
  const { context, ...rest } = host as { context?: Record<string, unknown> }
  return {
    ...rest,
    context: { ...context, cloudflare: { ...(context?.cloudflare ?? {}), env: { DB: db } } },
    method: 'GET',
    path: '/test',
  } as unknown as H3Event
}

describe('withD1Cache (narduk-libs#925)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('hands the stale-window refresh to event.waitUntil and writes the fresh value', async () => {
    const { db, writes } = createD1({ expires_at: NOW_SEC - 10, value: '"old"' })
    const kept: Array<Promise<unknown>> = []
    const event = createEvent(db, { waitUntil: (task: Promise<unknown>) => kept.push(task) })

    const served = await withD1Cache(event, 'k', 300, async () => 'fresh', false, {
      staleWindowSeconds: 600,
    })

    expect(served).toBe('old')
    expect(kept).toHaveLength(1)
    await kept[0]
    expect(writes).toEqual([{ expiresAt: NOW_SEC + 300, key: 'k', value: '"fresh"' }])
  })

  it('falls back to the Cloudflare ExecutionContext, called as a method', async () => {
    const { db } = createD1({ expires_at: NOW_SEC - 10, value: '"old"' })
    const kept: Array<Promise<unknown>> = []
    const ctx = {
      waitUntil(this: unknown, task: Promise<unknown>) {
        // A detached `ExecutionContext.waitUntil` throws on Workers.
        if (this !== ctx) throw new TypeError('Illegal invocation')
        kept.push(task)
      },
    }
    const event = createEvent(db, { context: { cloudflare: { context: ctx } } })

    await withD1Cache(event, 'k', 300, async () => 'fresh', false, { staleWindowSeconds: 600 })

    expect(kept).toHaveLength(1)
  })

  it('keeps the refresh alive through the SSR parent of a Nitro internal fetch (#991)', async () => {
    const { db } = createD1({ expires_at: NOW_SEC - 10, value: '"old"' })
    const kept: Array<Promise<unknown>> = []
    const parent = { waitUntil: (task: Promise<unknown>) => kept.push(task) }
    const event = createEvent(db, { context: { nuxt: { ssrContext: { event: parent } } } })

    await withD1Cache(event, 'k', 300, async () => 'fresh', false, { staleWindowSeconds: 600 })

    expect(kept).toHaveLength(1)
  })

  it('reports when the served value was cached, not the request time', async () => {
    const writtenAtSec = NOW_SEC - 310
    const { db } = createD1({ expires_at: writtenAtSec + 300, value: '"old"' })
    const event = createEvent(db, { waitUntil: () => {} })

    const stale = await withD1Cache(event, 'k', 300, async () => 'fresh', false, {
      returnMeta: true,
      staleWindowSeconds: 600,
    })

    expect(stale._meta).toEqual({
      cachedAt: new Date(writtenAtSec * 1000).toISOString(),
      stale: true,
    })
  })

  it('reports the write time on a fresh hit and now on a miss', async () => {
    const hitDb = createD1({ expires_at: NOW_SEC + 200, value: '"cached"' })
    const hit = await withD1Cache(createEvent(hitDb.db), 'k', 300, async () => 'x', false, {
      returnMeta: true,
    })
    expect(hit).toEqual({
      data: 'cached',
      _meta: { cachedAt: new Date((NOW_SEC - 100) * 1000).toISOString(), stale: false },
    })

    const missDb = createD1(null)
    const miss = await withD1Cache(createEvent(missDb.db), 'k', 300, async () => 'x', false, {
      returnMeta: true,
    })
    expect(miss._meta).toEqual({ cachedAt: NOW.toISOString(), stale: false })
  })
})
