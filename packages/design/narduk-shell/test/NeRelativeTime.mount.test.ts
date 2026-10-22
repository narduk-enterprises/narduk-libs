// @vitest-environment happy-dom
/*
 * NeRelativeTime, mounted: a real <time> with a machine-readable instant and
 * an absolute tooltip, relative while live and a date after a week, ticking on
 * the shared 30-second clock.
 */
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import NeRelativeTime from '../src/runtime/components/NeRelativeTime.vue'
import {
  NE_TIME_AGO_TICK_MS,
  timeAgoSubscriberCount,
} from '../src/runtime/composables/use-time-ago'

const NOW = '2026-03-08T20:30:00Z'
const ZONE = 'America/Chicago'

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(Date.parse(NOW))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('NeRelativeTime', () => {
  it('renders a <time> with the ISO instant, the relative text and an absolute title', () => {
    const wrapper = mount(NeRelativeTime, {
      props: { value: '2026-03-08T20:12:00Z', timeZone: ZONE },
    })
    const time = wrapper.get('time')
    expect(time.attributes('datetime')).toBe('2026-03-08T20:12:00.000Z')
    expect(time.attributes('title')).toBe('Mar 8, 2026, 3:12 PM CDT')
    expect(time.text()).toBe('18 minutes ago')
    expect(time.attributes('data-relative')).toBeDefined()
    wrapper.unmount()
  })

  it('shows a date once the value is over a week old, and stops being relative', () => {
    const wrapper = mount(NeRelativeTime, {
      props: { value: '2026-02-20T20:30:00Z', timeZone: ZONE },
    })
    expect(wrapper.text()).toBe('Feb 20, 2026')
    expect(wrapper.get('time').attributes('data-relative')).toBeUndefined()
    wrapper.unmount()
  })

  it('takes absolute-after, and a fixed `now`', () => {
    const wrapper = mount(NeRelativeTime, {
      props: {
        value: '2026-03-08T20:00:00Z',
        timeZone: ZONE,
        now: '2026-03-08T22:00:00Z',
        absoluteAfter: Infinity,
      },
    })
    expect(wrapper.text()).toBe('2 hours ago')
    expect(timeAgoSubscriberCount()).toBe(0)
    wrapper.unmount()
  })

  it('replaces the tooltip with `title`', () => {
    const wrapper = mount(NeRelativeTime, {
      props: { value: NOW, timeZone: ZONE, title: 'Last trade' },
    })
    expect(wrapper.get('time').attributes('title')).toBe('Last trade')
    wrapper.unmount()
  })

  it('renders the empty text with no datetime or tooltip for a missing value', () => {
    const wrapper = mount(NeRelativeTime, { props: { value: null, timeZone: ZONE } })
    const time = wrapper.get('time')
    expect(time.text()).toBe('—')
    expect(time.attributes('datetime')).toBeUndefined()
    expect(time.attributes('title')).toBeUndefined()
    wrapper.unmount()
  })

  it('moves on the shared tick and follows a changed value', async () => {
    const wrapper = mount(NeRelativeTime, {
      props: { value: Date.parse(NOW) - 40_000, timeZone: ZONE },
    })
    expect(wrapper.text()).toBe('40 seconds ago')

    vi.advanceTimersByTime(NE_TIME_AGO_TICK_MS)
    await nextTick()
    expect(wrapper.text()).toBe('1 minute ago')

    await wrapper.setProps({ value: Date.parse(NOW) - 3 * 3_600_000 })
    expect(wrapper.text()).toBe('3 hours ago')
    wrapper.unmount()
  })

  it('lets the text differ between server and client, and keeps figures tabular', () => {
    const wrapper = mount(NeRelativeTime, { props: { value: NOW, timeZone: ZONE } })
    expect(wrapper.get('time').attributes('data-allow-mismatch')).toBe('text')
    expect(wrapper.classes()).toContain('ne-relative-time')
    wrapper.unmount()
  })

  it('releases the ticker when it unmounts', () => {
    const wrapper = mount(NeRelativeTime, { props: { value: NOW, timeZone: ZONE } })
    expect(timeAgoSubscriberCount()).toBe(1)
    wrapper.unmount()
    expect(timeAgoSubscriberCount()).toBe(0)
  })
})
