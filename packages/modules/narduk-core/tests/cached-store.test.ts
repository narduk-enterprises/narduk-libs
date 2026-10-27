/// <reference lib="dom" />
// @vitest-environment happy-dom
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, effectScope, ref } from 'vue'

import { createDefineCachedStore, useResourceIdentityStore } from '../runtime/app/cached-store-core'
import { useIntervalRefresh } from '../runtime/app/composables/useIntervalRefresh'

const nuxtApp = { isHydrating: false }
const defineCachedStore = createDefineCachedStore(() => nuxtApp)

/**
 * `defineCachedStore` end to end: Pinia state through an SSR payload round trip, the identity
 * epoch, the actor tag, and the shared visibility-aware poll.
 */
let visibility: DocumentVisibilityState = 'visible'
function setVisibility(next: DocumentVisibilityState) {
  visibility = next
  document.dispatchEvent(new Event('visibilitychange'))
}

const actor = ref<string | null>('user-1')
let pinia = createPinia()
const load = vi.fn(async () => ['a', 'b'])

const useListStore = defineCachedStore(
  'list',
  ({ resources, poll }) => ({
    items: computed(() => resources.read<string[]>('items') ?? null),
    ensure: () => resources.ensure('items', load, { staleMs: 30_000 }),
    poll: () => poll('items', load, { everyMs: 10_000 }),
    reset: () => resources.reset(),
  }),
  { actor: () => actor.value },
)

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-10-27T15:00:00Z') })
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => visibility,
  })
  visibility = 'visible'
  actor.value = 'user-1'
  nuxtApp.isHydrating = false
  load.mockClear()
  pinia = createPinia()
  setActivePinia(pinia)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('defineCachedStore', () => {
  it('serializes entries into the payload; the hydrated client does not read again', async () => {
    // Server render: one read, state goes out in the payload.
    await useListStore().ensure()
    expect(load).toHaveBeenCalledTimes(1)
    const payload = JSON.parse(JSON.stringify(createPiniaState()))
    expect(payload.list.resourceEntries.items.data).toEqual(['a', 'b'])

    // Client: a fresh Pinia with the payload's state, hydrating.
    pinia = createPinia()
    pinia.state.value = payload
    setActivePinia(pinia)
    nuxtApp.isHydrating = true
    const store = useListStore()
    expect(store.items).toEqual(['a', 'b'])
    await store.ensure()
    expect(load).toHaveBeenCalledTimes(1)

    // After hydration the entry ages like any other.
    nuxtApp.isHydrating = false
    vi.advanceTimersByTime(30_001)
    await store.ensure()
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('an entry belongs to its actor and epoch', async () => {
    const store = useListStore()
    await store.ensure()
    actor.value = 'user-2'
    expect(store.items).toBeNull()
    actor.value = 'user-1'
    expect(store.items).toEqual(['a', 'b'])
    useResourceIdentityStore().retire()
    expect(store.items).toBeNull()
  })

  it('a read out when the identity retires rejects and never commits', async () => {
    let finish!: (value: string[]) => void
    load.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)))
    const store = useListStore()
    const out = store.ensure()
    useResourceIdentityStore().retire()
    finish(['stale'])
    await expect(out).rejects.toMatchObject({ name: 'AbortError' })
    expect(store.items).toBeNull()
  })

  it('keeps the per-request bookkeeping out of the payload', () => {
    useListStore()
    expect(Object.keys(createPiniaState().list).sort()).toEqual([
      'resourceEntries',
      'resourceErrors',
    ])
  })
})

describe('poll', () => {
  it('one timer per key however many scopes poll it, stopped with the last', async () => {
    const store = useListStore()
    const first = effectScope()
    const second = effectScope()
    first.run(() => store.poll())
    second.run(() => store.poll())

    await vi.advanceTimersByTimeAsync(10_000)
    expect(load).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(load).toHaveBeenCalledTimes(2)

    first.stop()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(load).toHaveBeenCalledTimes(3)

    second.stop()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(load).toHaveBeenCalledTimes(3)
  })

  it('a tick skips a key another caller read moments ago', async () => {
    const store = useListStore()
    const scope = effectScope()
    scope.run(() => store.poll())
    await vi.advanceTimersByTimeAsync(9_000)
    await store.ensure()
    expect(load).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(load).toHaveBeenCalledTimes(1)
    scope.stop()
  })

  it('reads nothing while hidden and catches up once on return', async () => {
    const store = useListStore()
    const scope = effectScope()
    scope.run(() => store.poll())
    setVisibility('hidden')
    await vi.advanceTimersByTimeAsync(60_000)
    expect(load).toHaveBeenCalledTimes(0)

    setVisibility('visible')
    await vi.advanceTimersByTimeAsync(0)
    expect(load).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(9_999)
    expect(load).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(load).toHaveBeenCalledTimes(2)
    scope.stop()
  })

  it('outside an effect scope does nothing', async () => {
    useListStore().poll()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(load).toHaveBeenCalledTimes(0)
  })
})

describe('useIntervalRefresh pauseWhenHidden', () => {
  it('a short absence does not catch up; the timer re-arms from the return', async () => {
    const callback = vi.fn()
    const scope = effectScope()
    scope.run(() => useIntervalRefresh(callback, 10_000, { pauseWhenHidden: true }))
    await vi.advanceTimersByTimeAsync(4_000)
    setVisibility('hidden')
    await vi.advanceTimersByTimeAsync(3_000)
    setVisibility('visible')
    expect(callback).toHaveBeenCalledTimes(0)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(callback).toHaveBeenCalledTimes(1)
    scope.stop()
  })

  it('without the option, a hidden page keeps ticking (unchanged default)', async () => {
    const callback = vi.fn()
    const scope = effectScope()
    scope.run(() => useIntervalRefresh(callback, 10_000))
    setVisibility('hidden')
    await vi.advanceTimersByTimeAsync(30_000)
    expect(callback).toHaveBeenCalledTimes(3)
    scope.stop()
  })

  it('short trips away still catch up once a full interval has passed since the last read', async () => {
    const callback = vi.fn()
    const scope = effectScope()
    scope.run(() => useIntervalRefresh(callback, 10_000, { pauseWhenHidden: true }))
    for (let trip = 0; trip < 3; trip++) {
      await vi.advanceTimersByTimeAsync(4_000)
      setVisibility('hidden')
      await vi.advanceTimersByTimeAsync(1_000)
      setVisibility('visible')
    }
    // 15 s since setup, never a full visible interval: the third return caught up.
    expect(callback).toHaveBeenCalledTimes(1)
    scope.stop()
  })

  it('an immediate read skipped while hidden at mount runs on first show', async () => {
    const callback = vi.fn()
    setVisibility('hidden')
    const scope = effectScope()
    scope.run(() =>
      useIntervalRefresh(callback, 10_000, { pauseWhenHidden: true, immediate: true }),
    )
    expect(callback).toHaveBeenCalledTimes(0)
    await vi.advanceTimersByTimeAsync(2_000)
    setVisibility('visible')
    expect(callback).toHaveBeenCalledTimes(1)
    scope.stop()
  })

  it('stays paused on return while disabled', async () => {
    const callback = vi.fn()
    const scope = effectScope()
    scope.run(() => useIntervalRefresh(callback, 10_000, { pauseWhenHidden: true, enabled: false }))
    setVisibility('hidden')
    await vi.advanceTimersByTimeAsync(30_000)
    setVisibility('visible')
    await vi.advanceTimersByTimeAsync(30_000)
    expect(callback).toHaveBeenCalledTimes(0)
    scope.stop()
  })
})

function createPiniaState(): Record<string, Record<string, unknown>> {
  return pinia.state.value as Record<string, Record<string, unknown>>
}
