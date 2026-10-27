/**
 * The store resource layer (runtime/app/resource-cache.ts): in-flight sharing, freshness, the
 * identity epoch and invalidation. Ported unchanged from stonx's 24 tests (its frontend audit
 * 2026-10, findings 1, 2 and 5), with deferred reads resolved out of order.
 */
import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

import {
  createResourceCache,
  isAbortError,
  type ResourceEntry,
  type ResourceError,
} from '../runtime/app/resource-cache'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function setup(opts: { hydrating?: boolean } = {}) {
  const clock = { now: 1_000_000 }
  const identity = { epoch: 0, actor: 'A' as string | null }
  const hydrating = ref(opts.hydrating ?? false)
  const entries = ref<Record<string, ResourceEntry>>({})
  const errors = ref<Record<string, ResourceError>>({})
  const cache = createResourceCache({
    entries,
    errors,
    epoch: () => identity.epoch,
    actor: () => identity.actor,
    now: () => clock.now,
    hydrating: () => hydrating.value,
  })
  // What an identity change does for every store: retire the epoch, then clear.
  const switchTo = (actor: string | null) => {
    identity.epoch++
    cache.reset()
    identity.actor = actor
  }
  return { cache, clock, identity, entries, errors, hydrating, switchTo }
}

const STALE = { staleMs: 30_000 }

describe('resource cache: one read per key', () => {
  it('shares one request between concurrent callers', async () => {
    const { cache } = setup()
    const read = deferred<string>()
    const load = vi.fn(() => read.promise)
    const shell = cache.ensure('dashboard', load, STALE)
    const ticket = cache.ensure('dashboard', load, STALE)
    expect(cache.isPending('dashboard')).toBe(true)
    read.resolve('snapshot')
    await expect(shell).resolves.toBe('snapshot')
    await expect(ticket).resolves.toBe('snapshot')
    expect(load).toHaveBeenCalledTimes(1)
    expect(cache.isPending('dashboard')).toBe(false)
  })

  it('answers from the cache while fresh and reads again once stale', async () => {
    const { cache, clock } = setup()
    const load = vi.fn(async () => `read at ${clock.now}`)
    await cache.ensure('dashboard', load, STALE)
    clock.now += 29_000
    await expect(cache.ensure('dashboard', load, STALE)).resolves.toBe('read at 1000000')
    expect(load).toHaveBeenCalledTimes(1)
    clock.now += 2_000
    await expect(cache.ensure('dashboard', load, STALE)).resolves.toBe('read at 1031000')
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('counts a hydrated entry as fresh whatever the server clock said', async () => {
    const { cache, clock, entries, hydrating } = setup({ hydrating: true })
    entries.value = { dashboard: { data: 'server', fetchedAt: 1, epoch: 0, actor: 'A' } }
    const load = vi.fn(async () => 'client')
    await expect(cache.ensure('dashboard', load, STALE)).resolves.toBe('server')
    hydrating.value = false
    clock.now += 1
    await expect(cache.ensure('dashboard', load, STALE)).resolves.toBe('client')
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('counts an answer stamped ahead of the client clock as expired, not fresh', async () => {
    const { cache, clock, entries } = setup()
    // Hydrated from a server whose clock is 5 s ahead of this client's.
    entries.value = {
      dashboard: { data: 'server', fetchedAt: clock.now + 5_000, epoch: 0, actor: 'A' },
    }
    expect(cache.isFresh('dashboard', STALE.staleMs)).toBe(false)
    const load = vi.fn(async () => 'client')
    await expect(cache.ensure('dashboard', load, STALE)).resolves.toBe('client')
    expect(load).toHaveBeenCalledTimes(1)
  })
})

describe('resource cache: identity owns the lifetime (finding 1)', () => {
  it('drops a read that answers after sign-out instead of committing it', async () => {
    const { cache, switchTo } = setup()
    const a = deferred<string>()
    const pending = cache.ensure('profile', () => a.promise, STALE)
    switchTo(null)
    a.resolve('A profile')
    await expect(pending).rejects.toSatisfy(isAbortError)
    expect(cache.read('profile')).toBeUndefined()
  })

  it('A, sign-out, B: B resolves, then A late: B stays (the profileLateResponse repro)', async () => {
    const { cache, switchTo } = setup()
    const a = deferred<string>()
    const b = deferred<string>()
    const fromA = cache.ensure('profile', () => a.promise, STALE)
    switchTo('B')
    const fromB = cache.ensure('profile', () => b.promise, STALE)
    b.resolve('B profile')
    await fromB
    a.resolve('A profile (admin)')
    await expect(fromA).rejects.toSatisfy(isAbortError)
    expect(cache.read('profile')).toBe('B profile')
  })

  it("never answers B with A's cached dashboard (the dashboardAfterAccountSwitch repro)", async () => {
    const { cache, identity, entries } = setup()
    // A's private game is still in the serialized state, as Pinia would keep it.
    entries.value = {
      dashboard: {
        data: { games: ['A-private-game'] },
        fetchedAt: 1_000_000,
        epoch: 0,
        actor: 'A',
      },
    }
    identity.actor = 'B'
    expect(cache.read('dashboard')).toBeUndefined()
    expect(cache.isFresh('dashboard', STALE.staleMs)).toBe(false)
    const load = vi.fn(async () => ({ games: ['B-game'] }))
    await expect(cache.ensure('dashboard', load, STALE)).resolves.toEqual({ games: ['B-game'] })
    expect(load).toHaveBeenCalledTimes(1)
  })

  it("drops A's late failure: no error is recorded for B", async () => {
    const { cache, switchTo } = setup()
    const a = deferred<string>()
    const fromA = cache.ensure('dashboard', () => a.promise, STALE)
    switchTo('B')
    a.reject(new Error('A failed'))
    await expect(fromA).rejects.toSatisfy(isAbortError)
    expect(cache.error('dashboard')).toBeNull()
  })
})

describe('resource cache: a write invalidates once (finding 2)', () => {
  it('a pre-trade read that lands after the trade never overwrites the post-trade answer', async () => {
    const { cache } = setup()
    await cache.ensure('dashboard', async () => ({ cash: 1000 }), STALE)
    const before = deferred<{ cash: number }>()
    const after = deferred<{ cash: number }>()
    const reads = [before, after]
    const load = vi.fn(() => reads.shift()!.promise)
    // A refresh is out (the shell) when the trade lands.
    const shellRead = cache.refresh('dashboard', load)
    cache.invalidate('dashboard') // the trade
    const ticketRead = cache.ensure('dashboard', load, STALE)
    after.resolve({ cash: 400 })
    await expect(ticketRead).resolves.toEqual({ cash: 400 })
    before.resolve({ cash: 1000 })
    // The shell's caller gets the post-trade answer too: one entry, every view.
    await expect(shellRead).resolves.toEqual({ cash: 400 })
    expect(cache.read('dashboard')).toEqual({ cash: 400 })
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('keeps the last good answer readable while invalidated, and reads again on the next ensure', async () => {
    const { cache } = setup()
    await cache.ensure('orders:g1', async () => 'old', STALE)
    cache.invalidate('orders:')
    expect(cache.read('orders:g1')).toBe('old')
    expect(cache.isFresh('orders:g1', STALE.staleMs)).toBe(false)
    await expect(cache.ensure('orders:g1', async () => 'new', STALE)).resolves.toBe('new')
  })

  it('a read started after the invalidate but before the fresh write cannot commit over it', async () => {
    const { cache } = setup()
    await cache.ensure('dashboard', async () => ({ cash: 1000 }), STALE)
    cache.invalidate('dashboard') // the trade
    const preWrite = deferred<{ cash: number }>()
    // A trade notification asks while the trade's own context read is still out.
    const notification = cache.ensure('dashboard', () => preWrite.promise, STALE)
    cache.update('dashboard', () => ({ cash: 400 }), { fresh: true })
    preWrite.resolve({ cash: 1000 }) // another isolate's cached, pre-trade answer
    await expect(notification).resolves.toEqual({ cash: 400 })
    expect(cache.read('dashboard')).toEqual({ cash: 400 })
    expect(cache.isPending('dashboard')).toBe(false)
  })

  it('a fresh write retires a read started before it: the caller gets the written answer', async () => {
    const { cache } = setup()
    await cache.ensure('dashboard', async () => ({ cash: 1000 }), STALE)
    const before = deferred<{ cash: number }>()
    const shellRead = cache.refresh('dashboard', () => before.promise)
    cache.update('dashboard', () => ({ cash: 400 }), { fresh: true })
    before.resolve({ cash: 1000 })
    await expect(shellRead).resolves.toEqual({ cash: 400 })
    expect(cache.read('dashboard')).toEqual({ cash: 400 })
  })

  it('a realtime patch that retires keeps its age but stops an older read from undoing it', async () => {
    const { cache, clock } = setup()
    await cache.ensure('dashboard', async () => ({ cash: 1000 }), STALE)
    clock.now += 31_000 // stale: the shell asks again
    const before = deferred<{ cash: number }>()
    const load = vi.fn(() => before.promise)
    const shellRead = cache.ensure('dashboard', load, STALE)
    // A fill arrives over realtime while that read is out.
    cache.update('dashboard', () => ({ cash: 400 }), { retire: true })
    before.resolve({ cash: 1000 }) // read before the fill
    await expect(shellRead).resolves.toEqual({ cash: 400 })
    expect(cache.read('dashboard')).toEqual({ cash: 400 })
    // Still stale: the next reader asks the server again.
    const after = vi.fn(async () => ({ cash: 400 }))
    await cache.ensure('dashboard', after, STALE)
    expect(after).toHaveBeenCalledTimes(1)
  })

  it('a write that knows the committed answer marks it fresh', async () => {
    const { cache, clock } = setup()
    await cache.ensure('dashboard', async () => ({ cash: 1000 }), STALE)
    cache.invalidate('dashboard')
    clock.now += 5
    expect(cache.update('dashboard', () => ({ cash: 400 }), { fresh: true })).toBe(true)
    const load = vi.fn(async () => ({ cash: 1000 }))
    await expect(cache.ensure('dashboard', load, STALE)).resolves.toEqual({ cash: 400 })
    expect(load).not.toHaveBeenCalled()
  })
})

describe('resource cache: the latest request wins (finding 5)', () => {
  it('reversed resolution: the newer read stands (the screenerOutOfOrder repro)', async () => {
    const { cache } = setup()
    const a = deferred<string>()
    const b = deferred<string>()
    const first = cache.refresh('screener', () => a.promise)
    const second = cache.refresh('screener', () => b.promise)
    b.resolve('rows for B')
    await second
    a.resolve('rows for A')
    await expect(first).resolves.toBe('rows for B')
    expect(cache.read('screener')).toBe('rows for B')
  })

  it('an old failure after a fresh success records no error (the screenerStaleFailure repro)', async () => {
    const { cache } = setup()
    const c = deferred<string>()
    const d = deferred<string>()
    const first = cache.refresh('screener', () => c.promise)
    const second = cache.refresh('screener', () => d.promise)
    d.resolve('rows for D')
    await second
    c.reject(new Error('old C failed'))
    await expect(first).resolves.toBe('rows for D')
    expect(cache.read('screener')).toBe('rows for D')
    expect(cache.error('screener')).toBeNull()
  })

  it('a loader that throws synchronously is a failed read, not a stuck one', async () => {
    const { cache } = setup()
    const boom = new Error('sync')
    await expect(
      cache.ensure(
        'orders:g1',
        () => {
          throw boom
        },
        STALE,
      ),
    ).rejects.toBe(boom)
    expect(cache.isPending('orders:g1')).toBe(false)
    const load = vi.fn(async () => 'orders')
    await expect(cache.ensure('orders:g1', load, STALE)).resolves.toBe('orders')
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('records the current read failure and keeps the last good data', async () => {
    const { cache } = setup()
    await cache.ensure('ended', async () => 'good', STALE)
    const fail = Object.assign(new Error('boom'), { statusCode: 503 })
    await expect(cache.refresh('ended', () => Promise.reject(fail))).rejects.toBe(fail)
    expect(cache.read('ended')).toBe('good')
    expect(cache.error('ended')).toMatchObject({ message: 'boom', statusCode: 503 })
    await cache.refresh('ended', async () => 'better')
    expect(cache.error('ended')).toBeNull()
  })
})

describe('a failure many readers mount against (retryMs)', () => {
  const RETRY = { staleMs: 30_000, retryMs: 15_000 }

  it('readers inside the pause take the failure instead of asking again; after it, one asks', async () => {
    const { cache, clock } = setup()
    const load = vi.fn(async () => {
      throw Object.assign(new Error('Bad Gateway'), { statusCode: 502 })
    })
    await expect(cache.ensure('status', load, RETRY)).rejects.toThrow('Bad Gateway')
    await expect(cache.ensure('status', load, RETRY)).rejects.toMatchObject({ statusCode: 502 })
    expect(load).toHaveBeenCalledTimes(1)
    clock.now += 15_000
    await expect(cache.ensure('status', load, RETRY)).rejects.toThrow()
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('keeps serving the last answer it holds while paused, and a refresh always asks', async () => {
    const { cache, clock } = setup()
    await cache.ensure('status', async () => 'open', RETRY)
    clock.now += 31_000
    const fail = vi.fn(async () => {
      throw new Error('502')
    })
    await expect(cache.ensure('status', fail, RETRY)).rejects.toThrow()
    await expect(cache.ensure('status', fail, RETRY)).resolves.toBe('open')
    expect(fail).toHaveBeenCalledTimes(1)
    await expect(cache.refresh('status', async () => 'closed')).resolves.toBe('closed')
  })

  it('a failure stamped ahead of the client clock does not pause the next reader', async () => {
    const { cache, clock, errors } = setup()
    errors.value = {
      status: { message: 'Bad Gateway', statusCode: 502, at: clock.now + 60_000, epoch: 0 },
    }
    const load = vi.fn(async () => 'open')
    await expect(cache.ensure('status', load, RETRY)).resolves.toBe('open')
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('without retryMs a failure is asked again by the next reader (the default)', async () => {
    const { cache } = setup()
    const load = vi.fn(async () => {
      throw new Error('502')
    })
    await expect(cache.ensure('k', load, STALE)).rejects.toThrow()
    await expect(cache.ensure('k', load, STALE)).rejects.toThrow()
    expect(load).toHaveBeenCalledTimes(2)
  })
})

describe('a read made outside ensure (capture)', () => {
  it('commits while nothing moved, and drops an answer that lands after an invalidate', async () => {
    const { cache } = setup()
    cache.capture('game:g1')('first')
    expect(cache.read('game:g1')).toBe('first')
    const commit = cache.capture('game:g1')
    cache.invalidate('game:g1') // a join, while the read is out
    expect(commit('before the join')).toBe(false)
    expect(cache.isFresh('game:g1', STALE.staleMs)).toBe(false)
    const load = vi.fn(async () => 'after the join')
    await expect(cache.ensure('game:g1', load, STALE)).resolves.toBe('after the join')
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('drops an answer that lands after an actor change', () => {
    const { cache, switchTo } = setup()
    const commit = cache.capture('game:g1')
    switchTo('B')
    expect(commit('A seat')).toBe(false)
    expect(cache.read('game:g1')).toBeUndefined()
  })
})
