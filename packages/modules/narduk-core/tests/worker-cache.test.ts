/// <reference types="@cloudflare/workers-types" />
/**
 * `withWorkerCache` (narduk-libs#1716, extending #1268): one test group per
 * acceptance item of #1268, plus version-key invalidation.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  getWorkerCacheStore,
  resetWorkerCacheStore,
  WorkerCacheStore,
} from '../runtime/internal/worker-cache-store'
import { withWorkerCache, type WorkerCacheOptions } from '../runtime/server/utils/workerCache'

import { logged, resetLogged } from './stubs/recording-logger'

import type { H3Event } from 'h3'

vi.mock('nitropack/runtime', () => ({
  useRuntimeConfig: () => ({}),
}))
vi.mock('../runtime/server/utils/logger', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useLogger: (await import('./stubs/recording-logger')).useRecordingLogger,
}))

const T0 = new Date('2026-10-09T12:00:00.000Z')

/** A Map-backed `caches.default`: a hit builds a fresh Response, as the real one does. */
function createFakeCaches() {
  const store = new Map<string, { body: string; headers: Array<[string, string]> }>()
  const calls = { match: 0, put: 0 }
  const fail = { match: false, put: false }
  const cache = {
    async match(request: Request) {
      calls.match += 1
      if (fail.match) throw new Error('match unavailable')
      const hit = store.get(request.url)
      return hit ? new Response(hit.body, { headers: hit.headers }) : undefined
    },
    async put(request: Request, response: Response) {
      calls.put += 1
      if (fail.put) throw new Error('put unavailable')
      store.set(request.url, {
        body: await response.text(),
        headers: [...response.headers.entries()],
      })
    },
  }
  return {
    cache,
    calls,
    fail,
    store,
    named: new Map<string, typeof cache>(),
  }
}

type FakeCaches = ReturnType<typeof createFakeCaches>

function createEvent(options: { waitUntil?: boolean } = {}) {
  const pending: Array<Promise<unknown>> = []
  const event = {
    context: {},
    method: 'GET',
    path: '/test',
    ...(options.waitUntil === false
      ? {}
      : {
          waitUntil(task: Promise<unknown>) {
            pending.push(task)
          },
        }),
  } as unknown as H3Event
  return { event, flush: async () => void (await Promise.all(pending.splice(0))), pending }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, reject, resolve }
}

const base: Omit<WorkerCacheOptions, 'returnMeta'> = {
  freshSeconds: 60,
  key: 'stations',
  maxStaleSeconds: 600,
  scope: 'public',
}

let fake: FakeCaches

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(T0)
  resetWorkerCacheStore()
  resetLogged()
  fake = createFakeCaches()
  vi.stubGlobal('caches', {
    default: fake.cache,
    open: async (name: string) => {
      if (!fake.named.has(name)) fake.named.set(name, createFakeCaches().cache)
      return fake.named.get(name)
    },
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('warm upstream-call counts', () => {
  it('builds once and serves later calls from isolate memory', async () => {
    const { event } = createEvent()
    const build = vi.fn(async () => ({ rows: [1, 2, 3] }))

    const first = await withWorkerCache(event, { ...base, returnMeta: true }, build)
    const second = await withWorkerCache(event, { ...base, returnMeta: true }, build)

    expect(build).toHaveBeenCalledTimes(1)
    expect(first._meta.source).toBe('build')
    expect(second._meta).toMatchObject({ source: 'memory', stale: false, key: 'stations' })
    expect(second.data).toEqual({ rows: [1, 2, 3] })
  })

  it('hands every caller its own copy of the value', async () => {
    const { event } = createEvent()
    const build = vi.fn(async () => ({ rows: [1] }))

    const a = await withWorkerCache(event, base, build)
    a.rows.push(99)
    const b = await withWorkerCache(event, base, build)
    b.rows.push(100)
    const c = await withWorkerCache(event, base, build)

    expect(c).toEqual({ rows: [1] })
  })

  it('does not share a pending build between concurrent requests', async () => {
    const { event } = createEvent()
    const gate = deferred<{ n: number }>()
    const build = vi.fn(() => gate.promise)

    const a = withWorkerCache(event, base, build)
    const b = withWorkerCache(event, base, build)
    await vi.advanceTimersByTimeAsync(0)
    expect(build).toHaveBeenCalledTimes(2)
    gate.resolve({ n: 1 })
    await expect(Promise.all([a, b])).resolves.toEqual([{ n: 1 }, { n: 1 }])
  })

  it('treats freshSeconds of zero as no caching', async () => {
    const { event } = createEvent()
    const build = vi.fn(async () => 1)
    await withWorkerCache(event, { ...base, freshSeconds: 0 }, build)
    await withWorkerCache(event, { ...base, freshSeconds: 0 }, build)
    expect(build).toHaveBeenCalledTimes(2)
    expect(fake.calls.put).toBe(0)
  })

  it('rejects a missing key or scope', async () => {
    const { event } = createEvent()
    await expect(withWorkerCache(event, { ...base, key: '' }, async () => 1)).rejects.toThrow(/key/)
    await expect(
      withWorkerCache(event, { ...base, scope: 'shared' as never }, async () => 1),
    ).rejects.toThrow(/scope/)
  })
})

describe('cold-isolate Cache API reuse', () => {
  it('serves a public value from Workers Cache after the isolate is recycled', async () => {
    const warm = createEvent()
    const build = vi.fn(async () => ({ rows: [7] }))
    await withWorkerCache(warm.event, base, build)
    await warm.flush()
    expect(fake.calls.put).toBe(1)

    resetWorkerCacheStore()
    const cold = createEvent()
    const result = await withWorkerCache(cold.event, { ...base, returnMeta: true }, build)

    expect(build).toHaveBeenCalledTimes(1)
    expect(result._meta.source).toBe('edge')
    expect(result.data).toEqual({ rows: [7] })

    const third = await withWorkerCache(cold.event, { ...base, returnMeta: true }, build)
    expect(third._meta.source).toBe('memory')
  })

  it('writes under a synthetic URL that carries the version, not the key text', async () => {
    const { event, flush } = createEvent()
    await withWorkerCache(event, { ...base, version: 12 }, async () => 'x')
    await flush()
    const [url] = [...fake.store.keys()]
    expect(url).toContain('worker-cache.invalid')
    expect(new URL(url!).searchParams.get('v')).toBe('12')
  })

  it('never writes or reads a private value through Workers Cache', async () => {
    const warm = createEvent()
    const build = vi.fn(async () => ({ user: 'u1' }))
    await withWorkerCache(warm.event, { ...base, scope: 'private' }, build)
    await warm.flush()
    resetWorkerCacheStore()
    await withWorkerCache(warm.event, { ...base, scope: 'private' }, build)

    expect(fake.calls).toEqual({ match: 0, put: 0 })
    expect(build).toHaveBeenCalledTimes(2)
  })

  it('does not mix public and private values stored under one key', async () => {
    const { event } = createEvent()
    await withWorkerCache(event, base, async () => 'public')
    const priv = await withWorkerCache(event, { ...base, scope: 'private' }, async () => 'private')
    expect(priv).toBe('private')
  })

  it('ignores a Workers Cache entry that belongs to another key or format', async () => {
    const warm = createEvent()
    await withWorkerCache(warm.event, base, async () => 'good')
    await warm.flush()
    for (const entry of fake.store.values()) {
      entry.headers = entry.headers.map(([k, v]) =>
        k === 'x-worker-cache-id' ? [k, encodeURIComponent('public|other|')] : [k, v],
      )
    }
    resetWorkerCacheStore()
    const build = vi.fn(async () => 'rebuilt')
    await expect(withWorkerCache(warm.event, base, build)).resolves.toBe('rebuilt')
  })

  it('uses a named cache when asked', async () => {
    const { event, flush } = createEvent()
    await withWorkerCache(event, { ...base, cacheName: 'soss' }, async () => 1)
    await flush()
    expect(fake.calls.put).toBe(0)
    expect(fake.named.has('soss')).toBe(true)
  })
})

describe('version keys', () => {
  it('serves while the version holds and rebuilds as soon as it moves', async () => {
    const { event } = createEvent()
    let version = 1
    let data = 'v1'
    const build = vi.fn(async () => data)
    const options = { ...base, returnMeta: true as const, version: () => version }

    expect((await withWorkerCache(event, options, build)).data).toBe('v1')
    data = 'v2'
    expect((await withWorkerCache(event, options, build)).data).toBe('v1')
    version = 2
    const after = await withWorkerCache(event, options, build)
    expect(after.data).toBe('v2')
    expect(after._meta).toMatchObject({ source: 'build', version: '2' })
    expect(build).toHaveBeenCalledTimes(2)
  })

  it('a write is visible through Workers Cache in a cold isolate with no purge', async () => {
    const first = createEvent()
    let version = 1
    let data = 'before'
    const options = { ...base, version: () => version }
    await withWorkerCache(first.event, options, async () => data)
    await first.flush()

    version = 2
    data = 'after'
    resetWorkerCacheStore()
    const cold = createEvent()
    await expect(withWorkerCache(cold.event, options, async () => data)).resolves.toBe('after')
  })

  it('builds uncached when the version cannot be read', async () => {
    const { event } = createEvent()
    const build = vi.fn(async () => 'live')
    const options = {
      ...base,
      returnMeta: true as const,
      version: async () => {
        throw new Error('d1 down')
      },
    }
    const a = await withWorkerCache(event, options, build)
    await withWorkerCache(event, options, build)
    expect(a._meta.source).toBe('bypass')
    expect(build).toHaveBeenCalledTimes(2)
    expect(fake.calls.put).toBe(0)
    expect(logged.some((l) => l.level === 'warn' && /version read failed/.test(l.message))).toBe(
      true,
    )
  })
})

describe('explicit fresh, background-refresh and maximum durations', () => {
  async function warmUp(version = 'a') {
    const ctx = createEvent()
    const build = vi.fn(async () => `built-${build.mock.calls.length}`)
    await withWorkerCache(ctx.event, { ...base, version }, build)
    await ctx.flush()
    return { build, ctx }
  }

  it('serves stale at once and refreshes under the request waitUntil', async () => {
    const { build } = await warmUp()
    vi.advanceTimersByTime(61_000)
    const ctx = createEvent()
    const result = await withWorkerCache(
      ctx.event,
      { ...base, version: 'a', returnMeta: true },
      build,
    )

    expect(result.data).toBe('built-1')
    expect(result._meta).toMatchObject({ source: 'memory', stale: true })
    expect(ctx.pending).toHaveLength(1)

    await ctx.flush()
    expect(build).toHaveBeenCalledTimes(2)
    const next = await withWorkerCache(
      ctx.event,
      { ...base, version: 'a', returnMeta: true },
      build,
    )
    expect(next).toMatchObject({ data: 'built-2', _meta: { source: 'memory', stale: false } })
  })

  it('lets only one request per isolate claim a refresh', async () => {
    const { build } = await warmUp()
    vi.advanceTimersByTime(61_000)
    const a = createEvent()
    const b = createEvent()
    await withWorkerCache(a.event, { ...base, version: 'a' }, build)
    await withWorkerCache(b.event, { ...base, version: 'a' }, build)
    expect(a.pending).toHaveLength(1)
    expect(b.pending).toHaveLength(0)
    await a.flush()
    expect(build).toHaveBeenCalledTimes(2)
  })

  it('keeps a failed refresh visibly stale and backs off before retrying', async () => {
    const { build } = await warmUp()
    build.mockRejectedValue(new Error('upstream down'))
    vi.advanceTimersByTime(61_000)

    const a = createEvent()
    await withWorkerCache(a.event, { ...base, version: 'a' }, build)
    await a.flush()
    expect(build).toHaveBeenCalledTimes(2)

    const b = createEvent()
    const during = await withWorkerCache(
      b.event,
      { ...base, version: 'a', returnMeta: true },
      build,
    )
    expect(during).toMatchObject({ data: 'built-1', _meta: { stale: true } })
    expect(b.pending).toHaveLength(0)
    expect(build).toHaveBeenCalledTimes(2)

    vi.advanceTimersByTime(16_000)
    const c = createEvent()
    await withWorkerCache(c.event, { ...base, version: 'a' }, build)
    await c.flush()
    expect(build).toHaveBeenCalledTimes(3)
    expect(logged.some((l) => /refresh failed/.test(l.message))).toBe(true)
  })

  it('refreshes inline, and survives a failure, when no waitUntil exists', async () => {
    const { build } = await warmUp()
    vi.advanceTimersByTime(61_000)
    const bare = createEvent({ waitUntil: false })
    const fresh = await withWorkerCache(
      bare.event,
      { ...base, version: 'a', returnMeta: true },
      build,
    )
    expect(fresh).toMatchObject({ data: 'built-2', _meta: { stale: false } })

    vi.advanceTimersByTime(61_000)
    build.mockRejectedValue(new Error('upstream down'))
    const kept = await withWorkerCache(
      bare.event,
      { ...base, version: 'a', returnMeta: true },
      build,
    )
    expect(kept).toMatchObject({ data: 'built-2', _meta: { stale: true } })
  })

  it('adopts a fresher Workers Cache copy instead of rebuilding when it refreshes', async () => {
    const { build } = await warmUp()
    vi.advanceTimersByTime(61_000)
    // Another isolate rebuilt meanwhile and wrote its value to Workers Cache.
    for (const entry of fake.store.values()) {
      entry.body = JSON.stringify('from-other-isolate')
      entry.headers = entry.headers.map(([k, v]) =>
        k === 'x-worker-cache-built-at' ? [k, String(Date.now() - 1_000)] : [k, v],
      )
    }

    const ctx = createEvent()
    const stale = await withWorkerCache(ctx.event, { ...base, version: 'a' }, build)
    await ctx.flush()
    expect(stale).toBe('built-1')

    const next = await withWorkerCache(
      ctx.event,
      { ...base, version: 'a', returnMeta: true },
      build,
    )
    expect(next).toMatchObject({ data: 'from-other-isolate', _meta: { stale: false } })
    expect(build).toHaveBeenCalledTimes(1)
  })

  it('expires past freshSeconds + maxStaleSeconds: builds in line, never serves it', async () => {
    const { build } = await warmUp()
    vi.advanceTimersByTime((60 + 600) * 1000 + 1)
    const ctx = createEvent()
    const result = await withWorkerCache(
      ctx.event,
      { ...base, version: 'a', returnMeta: true },
      build,
    )
    expect(result.data).toBe('built-2')
    expect(result._meta).toMatchObject({ source: 'build', stale: false })
    expect(ctx.pending.length).toBeLessThanOrEqual(1)
  })

  it('does not fall back to an expired value when the rebuild fails', async () => {
    const { build } = await warmUp()
    vi.advanceTimersByTime((60 + 600) * 1000 + 1)
    build.mockRejectedValue(new Error('upstream down'))
    const ctx = createEvent()
    await expect(withWorkerCache(ctx.event, { ...base, version: 'a' }, build)).rejects.toThrow(
      'upstream down',
    )
  })

  it('does not serve stale when maxStaleSeconds is unset', async () => {
    const ctx = createEvent()
    const build = vi.fn(async () => build.mock.calls.length)
    const options = { ...base, maxStaleSeconds: undefined }
    await withWorkerCache(ctx.event, options, build)
    vi.advanceTimersByTime(61_000)
    await expect(withWorkerCache(ctx.event, options, build)).resolves.toBe(2)
  })
})

describe('initial failure', () => {
  it('propagates a build error and caches nothing', async () => {
    const { event, flush } = createEvent()
    const build = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue('ok')

    await expect(withWorkerCache(event, base, build)).rejects.toThrow('boom')
    await flush()
    expect(fake.calls.put).toBe(0)
    expect(getWorkerCacheStore().size).toBe(0)
    await expect(withWorkerCache(event, base, build)).resolves.toBe('ok')
  })
})

describe('refresh races', () => {
  it('lets a later-started build win when an earlier refresh finishes last', async () => {
    const seed = createEvent()
    await withWorkerCache(seed.event, base, async () => 'seed')
    await seed.flush()
    vi.advanceTimersByTime(61_000)

    const slow = deferred<string>()
    const fast = deferred<string>()
    const build = vi
      .fn<() => Promise<string>>()
      .mockReturnValueOnce(slow.promise)
      .mockReturnValueOnce(fast.promise)

    const a = createEvent()
    await withWorkerCache(a.event, base, build) // claims the refresh, starts the slow build
    await vi.advanceTimersByTimeAsync(0)
    expect(build).toHaveBeenCalledTimes(1)

    // The first request is cancelled; its lease runs out, so another request refreshes.
    vi.advanceTimersByTime(31_000)
    const b = createEvent()
    await withWorkerCache(b.event, base, build) // starts the fast build, later than the slow one
    await vi.advanceTimersByTimeAsync(0)
    expect(build).toHaveBeenCalledTimes(2)

    fast.resolve('newer')
    await b.flush()
    const putsAfterNewer = fake.calls.put
    slow.resolve('older')
    await a.flush()

    const read = await withWorkerCache(createEvent().event, { ...base, returnMeta: true }, build)
    expect(read.data).toBe('newer')
    expect(fake.calls.put).toBe(putsAfterNewer)
  })

  it('orders builds that start in the same instant by start order', () => {
    const store = new WorkerCacheStore()
    const first = store.nextSeq()
    const second = store.nextSeq()
    expect(store.put('k', { builtAt: 5, json: '"b"', seq: second }).result).toBe('stored')
    expect(store.put('k', { builtAt: 5, json: '"a"', seq: first }).result).toBe('superseded')
    expect(store.get('k')?.json).toBe('"b"')
  })
})

describe('Cache API errors', () => {
  it('falls through to build when the cache cannot be read', async () => {
    fake.fail.match = true
    const { event } = createEvent()
    const build = vi.fn(async () => 'live')
    await expect(withWorkerCache(event, base, build)).resolves.toBe('live')
    expect(logged.some((l) => l.level === 'warn' && /Cache API read failed/.test(l.message))).toBe(
      true,
    )
  })

  it('still returns and keeps the value when the cache cannot be written', async () => {
    fake.fail.put = true
    const { event, flush } = createEvent()
    const build = vi.fn(async () => 'live')
    await expect(withWorkerCache(event, base, build)).resolves.toBe('live')
    await flush()
    await expect(withWorkerCache(event, base, build)).resolves.toBe('live')
    expect(build).toHaveBeenCalledTimes(1)
    expect(logged.some((l) => /Cache API write failed/.test(l.message))).toBe(true)
  })

  it('works where there is no Cache API at all', async () => {
    vi.stubGlobal('caches', undefined)
    const { event } = createEvent()
    const build = vi.fn(async () => 'live')
    await withWorkerCache(event, base, build)
    await withWorkerCache(event, base, build)
    expect(build).toHaveBeenCalledTimes(1)
  })
})

describe('completed serializable values only', () => {
  it.each([
    ['a promise', () => ({ later: Promise.resolve(1) })],
    ['a function', () => ({ fn: () => 1 })],
    ['a Map', () => new Map([[1, 2]])],
    ['a Response', () => new Response('x')],
    ['undefined', () => {}],
  ])('returns %s uncached and says so', async (_label, make) => {
    const { event, flush } = createEvent()
    const build = vi.fn(async () => make())
    await withWorkerCache(event, base, build)
    await withWorkerCache(event, base, build)
    await flush()
    expect(build).toHaveBeenCalledTimes(2)
    expect(getWorkerCacheStore().size).toBe(0)
    expect(fake.calls.put).toBe(0)
    expect(logged.some((l) => /not serializable/.test(l.message))).toBe(true)
  })
})

describe('byte and entry budgets', () => {
  it('evicts least recently used entries past the entry budget', async () => {
    resetWorkerCacheStore({ maxEntries: 2 })
    const { event } = createEvent()
    const build = vi.fn(async () => 'v')
    const run = (key: string) => withWorkerCache(event, { ...base, key, scope: 'private' }, build)

    await run('a')
    await run('b')
    await run('a') // a is now more recent than b
    await run('c') // evicts b
    expect(getWorkerCacheStore().size).toBe(2)
    build.mockClear()
    await run('a')
    expect(build).not.toHaveBeenCalled()
    await run('b')
    expect(build).toHaveBeenCalledTimes(1)
  })

  it('evicts to stay inside the byte budget', async () => {
    resetWorkerCacheStore({ maxBytes: 1_000 })
    const { event } = createEvent()
    const payload = 'x'.repeat(150) // ~ 400 bytes per entry with the key and overhead
    const build = vi.fn(async () => payload)
    for (const key of ['a', 'b', 'c', 'd']) {
      await withWorkerCache(event, { ...base, key, scope: 'private' }, build)
    }
    const store = getWorkerCacheStore()
    expect(store.bytes).toBeLessThanOrEqual(1_000)
    expect(store.size).toBeLessThan(4)
    build.mockClear()
    await withWorkerCache(event, { ...base, key: 'd', scope: 'private' }, build)
    expect(build).not.toHaveBeenCalled()
    await withWorkerCache(event, { ...base, key: 'a', scope: 'private' }, build)
    expect(build).toHaveBeenCalledTimes(1)
  })

  it('does not keep a value that alone exceeds the byte budget in memory', async () => {
    resetWorkerCacheStore({ maxBytes: 200 })
    const { event, flush } = createEvent()
    const build = vi.fn(async () => 'y'.repeat(500))
    await withWorkerCache(event, base, build)
    await flush()
    expect(getWorkerCacheStore().size).toBe(0)
    expect(getWorkerCacheStore().bytes).toBe(0)
    // Workers Cache has no such budget, so a cold read still reuses it.
    expect(fake.calls.put).toBe(1)
    const again = await withWorkerCache(event, { ...base, returnMeta: true }, build)
    expect(again._meta.source).toBe('edge')
    expect(build).toHaveBeenCalledTimes(1)
  })
})
