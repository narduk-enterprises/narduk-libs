// @vitest-environment happy-dom
/*
 * NeDataAttribution, mounted (narduk-libs#388): one consistent "Data from
 * <source>, updated <time>" credit, formatted through `./format` with a
 * caller-supplied zone and clock, and external links that cannot open a
 * tab-nabbing or `javascript:` hole.
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import NeDataAttribution from '../src/runtime/components/NeDataAttribution.vue'

import type { NeDataAttributionProps } from '../src/index'

function render(props: NeDataAttributionProps) {
  return mount(NeDataAttribution, { props })
}

const NOW = '2026-03-08T12:00:00Z'

describe('NeDataAttribution: the credit', () => {
  it('renders "Data from <source>, updated <relative>" when the caller passes now', () => {
    const wrapper = render({
      now: NOW,
      sources: { name: 'NOAA NDBC' },
      timeZone: 'America/Chicago',
      updatedAt: '2026-03-08T09:00:00Z',
    })
    const root = wrapper.get('[data-ne-data-attribution]')
    expect(root.text()).toBe('Data from NOAA NDBC, updated 3 hours ago')
    const time = wrapper.get('time')
    expect(time.attributes('datetime')).toBe('2026-03-08T09:00:00.000Z')
    // The absolute reading rides along as a tooltip, in the caller's zone.
    expect(time.attributes('title')).toBe('Mar 8, 2026, 4:00 AM')
  })

  it('formats an absolute time in the caller zone when no now is given', () => {
    const wrapper = render({
      sources: [{ name: 'USGS' }],
      timeZone: 'America/Chicago',
      updatedAt: '2026-03-08T08:30:00Z',
    })
    expect(wrapper.text()).toBe('Data from USGS, updated Mar 8, 2026, 3:30 AM')
    expect(wrapper.get('time').attributes('title')).toBeUndefined()
  })

  it('treats a bare calendar date as a date, not midnight UTC', () => {
    const wrapper = render({
      sources: [{ name: 'USGS' }],
      timeZone: 'America/Chicago',
      updatedAt: '2026-03-08',
    })
    expect(wrapper.text()).toBe('Data from USGS, updated Mar 8, 2026')
    expect(wrapper.get('time').attributes('datetime')).toBe('2026-03-08')
  })

  it('omits the updated clause for a missing or unparseable time rather than printing a dash', () => {
    for (const updatedAt of [undefined, null, 'not a date']) {
      const wrapper = render({ sources: [{ name: 'USGS' }], timeZone: 'UTC', updatedAt })
      expect(wrapper.text()).toBe('Data from USGS')
      expect(wrapper.find('time').exists()).toBe(false)
    }
  })

  it('joins several sources and shares one updated clause', () => {
    const wrapper = render({
      now: NOW,
      sources: [{ name: 'NOAA NDBC' }, { name: 'USGS' }, { name: 'NWS' }],
      timeZone: 'UTC',
      updatedAt: '2026-03-08T11:00:00Z',
    })
    expect(wrapper.text()).toBe('Data from NOAA NDBC, USGS and NWS, updated 1 hour ago')
    expect(wrapper.findAll('[data-ne-attribution-source]')).toHaveLength(3)
  })

  it('gives each source its own license and publish time when they differ', () => {
    const wrapper = render({
      now: NOW,
      sources: [
        { license: 'CC0', name: 'NOAA NDBC', updatedAt: '2026-03-08T11:00:00Z' },
        { name: 'USGS', updatedAt: '2026-03-08T10:00:00Z' },
      ],
      timeZone: 'UTC',
    })
    expect(wrapper.text()).toBe(
      'Data from NOAA NDBC (CC0, updated 1 hour ago) and USGS (updated 2 hours ago)',
    )
    expect(wrapper.findAll('time')).toHaveLength(2)
  })

  it('takes its lead-in from the label prop', () => {
    const wrapper = render({ label: 'Source:', sources: [{ name: 'USGS' }], timeZone: 'UTC' })
    expect(wrapper.text()).toBe('Source: USGS')
  })
})

describe('NeDataAttribution: links are safe', () => {
  it('links an http(s) source with rel="noopener noreferrer" and no target by default', () => {
    const wrapper = render({
      sources: [{ href: 'https://www.ndbc.noaa.gov/', name: 'NOAA NDBC' }],
      timeZone: 'UTC',
    })
    const link = wrapper.get('a')
    expect(link.attributes('href')).toBe('https://www.ndbc.noaa.gov/')
    expect(link.attributes('rel')).toBe('noopener noreferrer')
    expect(link.attributes('target')).toBeUndefined()
    expect(link.text()).toBe('NOAA NDBC')
  })

  it('opens a new tab only when the caller opts in', () => {
    const wrapper = render({
      newTab: true,
      sources: [{ href: 'https://waterdata.usgs.gov/', name: 'USGS' }],
      timeZone: 'UTC',
    })
    expect(wrapper.get('a').attributes('target')).toBe('_blank')
    expect(wrapper.get('a').attributes('rel')).toBe('noopener noreferrer')
  })

  it('links a license that carries its own href', () => {
    const wrapper = render({
      sources: [
        {
          license: { href: 'https://creativecommons.org/licenses/by/4.0/', name: 'CC BY 4.0' },
          name: 'OpenStreetMap',
        },
      ],
      timeZone: 'UTC',
    })
    expect(wrapper.text()).toBe('Data from OpenStreetMap (CC BY 4.0)')
    const license = wrapper.get('[data-ne-attribution-license] a')
    expect(license.attributes('href')).toBe('https://creativecommons.org/licenses/by/4.0/')
    expect(license.attributes('rel')).toBe('noopener noreferrer')
  })

  it('renders a non-http href as plain text, never as a link', () => {
    const wrapper = render({
      sources: [
        { href: 'javascript:alert(1)', name: 'Script' },
        { href: 'data:text/html,hi', name: 'Data URI' },
        { href: '/relative/path', name: 'Relative' },
      ],
      timeZone: 'UTC',
    })
    expect(wrapper.find('a').exists()).toBe(false)
    expect(wrapper.text()).toBe('Data from Script, Data URI and Relative')
  })
})
