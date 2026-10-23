// @vitest-environment happy-dom
/*
 * useTimeAgo(): relative while live, a date after a week, and ONE shared
 * ticker however many instances are alive. Fake timers drive the clock; every
 * instance is mounted in a component because the subscription ends with the
 * component's scope.
 */
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, ref } from 'vue'

import {
  NE_TIME_AGO_TICK_MS,
  timeAgoSubscriberCount,
  useTimeAgo,
} from '../src/runtime/composables/use-time-ago'

import type { NeTimeAgo, NeTimeAgoOptions } from '../src/runtime/composables/use-time-ago'
import type { NeDateInput } from '../src/format'
import type { MaybeRefOrGetter } from 'vue'

const ZONE = 'America/Chicago'
const NOW = Date.parse('2026-03-08T20:30:00Z')

const mounted: Array<{ unmount: () => void }> = []

function harness(value: MaybeRefOrGetter<NeDateInput>, options: Partial<NeTimeAgoOptions> = {}) {
  let ago!: NeTimeAgo
  const wrapper = mount(
    defineComponent({
      setup() {
        ago = useTimeAgo(value, { timeZone: ZONE, ...options })
        return () => h('span', ago.text.value)
      },
    }),
  )
  // Idempotent, so the afterEach sweep can unmount what a failed test left.
  const unmount = wrapper.unmount.bind(wrapper)
  let done = false
  wrapper.unmount = () => {
    if (done) return
    done = true
    unmount()
  }
  mounted.push(wrapper)
  return { ago, wrapper }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})

afterEach(() => {
  // A failed assertion must not leave a subscriber behind: the ticker is shared
  // module state, and one leak would poison every later test.
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
  vi.useRealTimers()
})

describe('useTimeAgo text', () => {
  it('is relative inside a week', () => {
    const { ago, wrapper } = harness(NOW - 3 * 60_000)
    expect(ago.text.value).toBe('3 minutes ago')
    expect(ago.relative.value).toBe(true)
    wrapper.unmount()
  })

  it('is a date once the value is more than a week from now', () => {
    const { ago, wrapper } = harness('2026-02-20T20:30:00Z')
    expect(ago.text.value).toBe('Feb 20, 2026')
    expect(ago.relative.value).toBe(false)
    wrapper.unmount()
  })

  it('honours absoluteAfter in both directions', () => {
    const always = harness(NOW - 30 * 86_400_000, { absoluteAfter: Infinity })
    expect(always.ago.relative.value).toBe(true)
    const never = harness(NOW - 60_000, { absoluteAfter: 0 })
    expect(never.ago.relative.value).toBe(false)
    expect(never.ago.text.value).toBe('Mar 8, 2026')
    always.wrapper.unmount()
    never.wrapper.unmount()
  })

  it('reads a future value the same way', () => {
    const { ago, wrapper } = harness(NOW + 2 * 3_600_000)
    expect(ago.text.value).toBe('in 2 hours')
    wrapper.unmount()
  })

  it('gives an ISO instant and a full absolute title with the zone name', () => {
    const { ago, wrapper } = harness('2026-03-08T20:12:00Z')
    expect(ago.iso.value).toBe('2026-03-08T20:12:00.000Z')
    expect(ago.absolute.value).toBe('Mar 8, 2026, 3:12 PM CDT')
    wrapper.unmount()
  })

  it('renders the empty text, and no ISO, for a missing or unparseable value', () => {
    for (const bad of [null, undefined, 'not a date', 1e20]) {
      const { ago, wrapper } = harness(bad)
      expect(ago.text.value).toBe('—')
      expect(ago.iso.value).toBeUndefined()
      expect(ago.relative.value).toBe(false)
      wrapper.unmount()
    }
    const custom = harness(null, { empty: 'never' })
    expect(custom.ago.text.value).toBe('never')
    custom.wrapper.unmount()
  })

  it('follows a changing value', async () => {
    const value = ref<NeDateInput>(NOW - 60_000)
    const { ago, wrapper } = harness(value)
    expect(ago.text.value).toBe('1 minute ago')
    value.value = NOW - 5 * 60_000
    expect(ago.text.value).toBe('5 minutes ago')
    wrapper.unmount()
  })

  it('measures against a fixed `now` and never joins the ticker', () => {
    const { ago, wrapper } = harness('2026-03-08T20:00:00Z', { now: '2026-03-08T22:00:00Z' })
    expect(ago.text.value).toBe('2 hours ago')
    expect(timeAgoSubscriberCount()).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
    wrapper.unmount()
  })
})

describe('useTimeAgo shared ticker', () => {
  it('runs one interval for every instance and stops with the last one', () => {
    expect(vi.getTimerCount()).toBe(0)
    const wrappers = [1, 2, 3, 4, 5].map(() => harness(NOW - 60_000).wrapper)
    expect(timeAgoSubscriberCount()).toBe(5)
    expect(vi.getTimerCount()).toBe(1)

    for (const wrapper of wrappers.slice(0, 4)) wrapper.unmount()
    expect(timeAgoSubscriberCount()).toBe(1)
    expect(vi.getTimerCount()).toBe(1)

    wrappers[4]!.unmount()
    expect(timeAgoSubscriberCount()).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('moves every instance forward on each 30-second tick', async () => {
    const first = harness(NOW - 40_000)
    const second = harness(NOW - 40_000)
    expect(first.ago.text.value).toBe('40 seconds ago')

    vi.advanceTimersByTime(NE_TIME_AGO_TICK_MS)
    expect(first.ago.text.value).toBe('1 minute ago')
    expect(second.ago.text.value).toBe('1 minute ago')

    first.wrapper.unmount()
    second.wrapper.unmount()
  })

  it('catches up when a hidden tab becomes visible', () => {
    const { ago, wrapper } = harness(NOW - 60_000)
    expect(ago.text.value).toBe('1 minute ago')

    // Background timers are throttled: the clock moved, the tick did not run.
    vi.setSystemTime(NOW + 10 * 60_000)
    expect(ago.text.value).toBe('1 minute ago')
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    document.dispatchEvent(new Event('visibilitychange'))
    expect(ago.text.value).toBe('11 minutes ago')
    wrapper.unmount()
  })

  it('brings a stale clock up to date for the first instance after a quiet spell', () => {
    const early = harness(NOW)
    early.wrapper.unmount()
    vi.setSystemTime(NOW + 3_600_000)
    const late = harness(NOW)
    expect(late.ago.text.value).toBe('1 hour ago')
    late.wrapper.unmount()
  })

  it('does not rewrite a running clock when a second instance joins it', () => {
    const first = harness(NOW - 44_000)
    expect(first.ago.text.value).toBe('44 seconds ago')
    // Two seconds on, well inside one tick: the clock has not moved.
    vi.setSystemTime(NOW + 2_000)
    const second = harness(NOW - 44_000)
    expect(first.ago.text.value).toBe('44 seconds ago')
    vi.advanceTimersByTime(NE_TIME_AGO_TICK_MS)
    expect(first.ago.text.value).toBe('1 minute ago')
    first.wrapper.unmount()
    second.wrapper.unmount()
  })
})
