import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createEdgeCache,
  hasEdgeCache,
  holdEdgeCacheWrites,
  pendingEdgeCacheWrites,
} from '../runtime/server/edge-cache'
import edgeCacheStorage from '../runtime/server/edge-cache-storage'

import type { H3Event } from 'h3'

// The Worker's shared cache tier, ported from stonx's tests: an isolate's memory is its own, so
// entries go through the Cache API, which every isolate in a data centre reads. Two caches (or
// drivers) stand in for two isolates over one fake `caches.default` that honours max-age.

function fakeCacheApi() {
  const entries = new Map<string, { body: string; until: number }>()
  return {
    entries,
    async match(request: Request) {
      const hit = entries.get(request.url)
      if (!hit || Date.now() >= hit.until) return
      return new Response(hit.body)
    },
    async put(request: Request, response: Response) {
      const maxAge = Number(/max-age=(\d+)/.exec(response.headers.get('cache-control') ?? '')?.[1])
      entries.set(request.url, { body: await response.text(), until: Date.now() + maxAge * 1000 })
    },
    async delete(request: Request) {
      return entries.delete(request.url)
    },
  }
}

let api: ReturnType<typeof fakeCacheApi>
const options = { origin: () => 'https://stonx.app/', path: '__stonx-edge-cache' }

beforeEach(() => {
  api = fakeCacheApi()
  vi.stubGlobal('caches', { default: api })
})

afterEach(async () => {
  await pendingEdgeCacheWrites()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('createEdgeCache', () => {
  it('a second isolate reads what the first cached, until the TTL', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-20T15:00:00Z') })
    createEdgeCache(options).putInBackground('movers:gainers', { n: 1 }, 60)
    await pendingEdgeCacheWrites()
    expect((await createEdgeCache(options).get('movers:gainers'))?.value).toEqual({ n: 1 })
    expect([...api.entries.keys()]).toEqual([
      'https://stonx.app/__stonx-edge-cache/movers%3Againers',
    ])

    vi.advanceTimersByTime(60_001)
    expect(await createEdgeCache(options).get('movers:gainers')).toBeNull()
  })

  it('delete removes the shared entry', async () => {
    const cache = createEdgeCache(options)
    await cache.put('candles:NVDA', 1, 60)
    await cache.delete('candles:NVDA')
    expect(await createEdgeCache(options).get('candles:NVDA')).toBeNull()
  })

  it('a background write returns at once, and the plugin holds the Worker for it', async () => {
    const waitUntil = vi.fn()
    const hooks: Array<(event: { waitUntil?: (p: Promise<unknown>) => void }) => unknown> = []
    holdEdgeCacheWrites({ hooks: { hook: (_name, fn) => hooks.push(fn) } })

    createEdgeCache(options).putInBackground('movers:slow', 1, 60)
    expect(api.entries.size).toBe(0)
    hooks[0]!({ waitUntil })
    expect(waitUntil).toHaveBeenCalledTimes(1)
    await waitUntil.mock.calls[0]![0]
    expect(api.entries.size).toBe(1)
    expect(pendingEdgeCacheWrites()).toBeNull()
  })

  it("with an event, the write goes to that request's waitUntil and is not left pending", async () => {
    const waitUntil = vi.fn()
    const event = { waitUntil, context: {} } as unknown as H3Event
    createEdgeCache(options).putInBackground('movers:own', 1, 60, event)
    expect(pendingEdgeCacheWrites()).toBeNull()
    expect(waitUntil).toHaveBeenCalledTimes(1)
    await waitUntil.mock.calls[0]![0]
    expect(api.entries.size).toBe(1)
  })

  it('a zero TTL stores nothing', async () => {
    await createEdgeCache(options).put('k', 1, 0)
    expect(api.entries.size).toBe(0)
  })

  it('with no Cache API (Node dev and tests) every call is a no-op', async () => {
    vi.stubGlobal('caches', undefined)
    const cache = createEdgeCache(options)
    expect(hasEdgeCache()).toBe(false)
    cache.putInBackground('k', 1, 60)
    expect(pendingEdgeCacheWrites()).toBeNull()
    expect(await cache.get('k')).toBeNull()
    await expect(cache.delete('k')).resolves.toBeUndefined()
  })
})

describe('edgeCacheStorage (Nitro cache driver)', () => {
  // A Nitro cachedEventHandler entry for a 10 s swr route.
  const entry = (now: number) =>
    JSON.stringify({ value: { p: 1 }, mtime: now, expires: now + 10_000 })
  const driverOptions = { base: 'https://stonx.app', path: '/__stonx-nitro-cache/' }

  it('shares entries between isolates and keeps a swr entry for two maxAges', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-20T15:00:00Z') })
    const value = entry(Date.now())
    await edgeCacheStorage(driverOptions).setItem('nitro:handlers:q:NVDA', value)
    expect([...api.entries.keys()]).toEqual([
      'https://stonx.app/__stonx-nitro-cache/nitro%3Ahandlers%3Aq%3ANVDA',
    ])

    const other = edgeCacheStorage(driverOptions)
    expect(await other.getItem('nitro:handlers:q:NVDA')).toBe(value)
    expect(await other.hasItem('nitro:handlers:q:NVDA')).toBe(true)

    vi.advanceTimersByTime(20_001)
    expect(await edgeCacheStorage(driverOptions).getItem('nitro:handlers:q:NVDA')).toBeNull()
  })

  it('keeps the isolate copy when the Cache API stores nothing (workers.dev)', async () => {
    vi.stubGlobal('caches', undefined)
    const driver = edgeCacheStorage(driverOptions)
    const value = entry(Date.now())
    await driver.setItem('k', value)
    expect(await driver.getItem('k')).toBe(value)
    await driver.removeItem('k')
    expect(await driver.getItem('k')).toBeNull()
  })

  it('bounds the isolate copy, oldest out first', async () => {
    vi.stubGlobal('caches', undefined)
    const driver = edgeCacheStorage({ ...driverOptions, localMax: 2 })
    await driver.setItem('a', '1', { ttl: 60 })
    await driver.setItem('b', '2', { ttl: 60 })
    await driver.setItem('c', '3', { ttl: 60 })
    expect(await driver.getItem('a')).toBeNull()
    expect(await driver.getItem('c')).toBe('3')
  })
})
