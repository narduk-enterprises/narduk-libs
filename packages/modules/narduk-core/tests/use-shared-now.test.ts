/// <reference lib="dom" />
// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, ref, shallowRef } from 'vue'

import { createSharedClock, createSharedClockRegistry } from '../runtime/app/utils/sharedClock'

import type { Ref } from 'vue'

/**
 * `useSharedNow()`: one clock per app, ticking at the fastest cadence any
 * mounted reader asked for, paused while hidden. `useState` is one map and the
 * registry one object, as in a single browser tab.
 */
const SHARED_NOW_STATE_KEY = 'narduk:shared-now'
let registry = createSharedClockRegistry()
const state = new Map<string, Ref<number>>()

/** `useSharedNow()` with its `#imports` half stood in: one payload map, one app registry. */
function useSharedNow(cadenceMs?: number) {
  if (!state.has(SHARED_NOW_STATE_KEY)) state.set(SHARED_NOW_STATE_KEY, ref(Date.now()))
  return createSharedClock(state.get(SHARED_NOW_STATE_KEY)!, registry, cadenceMs)
}

const START = Date.UTC(2026, 9, 6, 12, 0, 0)

function reader(cadenceMs: number | undefined, seen: Array<Readonly<Ref<number>>>) {
  return defineComponent({
    setup() {
      seen.push(useSharedNow(cadenceMs))
      return () => h('i')
    },
  })
}

beforeEach(() => {
  registry = createSharedClockRegistry()
  state.clear()
  vi.useFakeTimers()
  vi.setSystemTime(START)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useSharedNow', () => {
  it('hydrates the server instant, then every reader shares the browser clock', async () => {
    state.set(SHARED_NOW_STATE_KEY, ref(START - 23_000)) // the server's reading, from the payload
    const seen: Array<Readonly<Ref<number>>> = []
    const root = createApp({ render: () => [h(reader(undefined, seen)), h(reader(10_000, seen))] })

    expect(useSharedNowValue()).toBe(START - 23_000)
    root.mount(document.createElement('div'))
    await nextTick()

    expect(seen[0]!.value).toBe(START)
    expect(seen[0]!.value).toBe(seen[1]!.value)
    root.unmount()
  })

  it('ticks at the fastest mounted cadence, and slows when that reader leaves', async () => {
    const seen: Array<Readonly<Ref<number>>> = []
    const showFast = shallowRef(true)
    const root = createApp({
      render: () => [h(reader(30_000, seen)), showFast.value ? h(reader(1_000, seen)) : null],
    })
    root.mount(document.createElement('div'))
    await nextTick()

    vi.advanceTimersByTime(1_000)
    expect(seen[0]!.value).toBe(START + 1_000)

    showFast.value = false
    await nextTick()
    vi.advanceTimersByTime(29_000)
    expect(seen[0]!.value).toBe(START + 1_000) // no 1 s tick any more
    vi.advanceTimersByTime(1_000) // 30 s after the timer was re-armed
    expect(seen[0]!.value).toBe(START + 31_000)
    root.unmount()
  })

  it('holds still while hidden and re-reads on return', async () => {
    const seen: Array<Readonly<Ref<number>>> = []
    const root = createApp({ render: () => h(reader(1_000, seen)) })
    root.mount(document.createElement('div'))
    await nextTick()

    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    vi.advanceTimersByTime(5_000)
    expect(seen[0]!.value).toBe(START)

    visibility.mockReturnValue('visible')
    document.dispatchEvent(new Event('visibilitychange'))
    expect(seen[0]!.value).toBe(START + 5_000)
    visibility.mockRestore()
    root.unmount()
  })

  it('a reader without a cadence never starts a timer, and unmount clears it all', async () => {
    const seen: Array<Readonly<Ref<number>>> = []
    const root = createApp({ render: () => h(reader(undefined, seen)) })
    root.mount(document.createElement('div'))
    await nextTick()
    expect(vi.getTimerCount()).toBe(0)
    root.unmount()

    const ticking = createApp({ render: () => h(reader(1_000, seen)) })
    ticking.mount(document.createElement('div'))
    await nextTick()
    expect(vi.getTimerCount()).toBe(1)
    ticking.unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})

function useSharedNowValue() {
  return (state.get(SHARED_NOW_STATE_KEY) as Ref<number>).value
}
