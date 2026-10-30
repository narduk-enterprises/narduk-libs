// @vitest-environment happy-dom
/*
 * NeBottomTabBar, mounted: one lit tab per path (exact, then longest prefix,
 * then fallback), honest aria-current, the router's path by default, and
 * `--ne-bottom-bar-h` held while mounted and put back when it leaves.
 */
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { h, nextTick } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'

import NeBottomTabBar from '../src/runtime/components/NeBottomTabBar.vue'
import NeStickyActionBar from '../src/runtime/components/NeStickyActionBar.vue'
import { resolveBottomTabs } from '../src/runtime/components/ne-bottom-tab-bar-types'

import type { NeBottomTabItem } from '../src/runtime/components/ne-bottom-tab-bar-types'

const items: NeBottomTabItem[] = [
  { label: 'Map', to: '/', icon: 'i-lucide-map', testid: 'tab-map' },
  { label: 'Stations', to: '/stations', icon: 'i-lucide-menu' },
  { label: 'Library', to: '/library', match: ['/playlists', '/library/albums'] },
  { label: 'More', to: '/more', exact: true },
]

const PRIMARY_NAV = 'nav[aria-label="Primary"]'

function makeRouter() {
  const page = { render: () => h('p', 'page') }
  return createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:rest(.*)*', component: page }],
  })
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  document.documentElement.style.removeProperty('--ne-bottom-bar-h')
  document.documentElement.style.removeProperty('--ne-bottom-nav-h')
})

describe('resolveBottomTabs', () => {
  it('lights the exact tab with aria-current page', () => {
    expect(resolveBottomTabs(items, '/stations')).toEqual(['none', 'page', 'none', 'none'])
    expect(resolveBottomTabs(items, '/')).toEqual(['page', 'none', 'none', 'none'])
  })

  it('lights the longest matching prefix as a section, never `/` for every path', () => {
    expect(resolveBottomTabs(items, '/stations/42')).toEqual(['none', 'section', 'none', 'none'])
    expect(resolveBottomTabs(items, '/playlists/7')).toEqual(['none', 'none', 'section', 'none'])
    expect(resolveBottomTabs(items, '/library/albums/9')).toEqual([
      'none',
      'none',
      'section',
      'none',
    ])
  })

  it('keeps an exact tab off its sub-paths and ignores query, hash and a trailing slash', () => {
    expect(resolveBottomTabs(items, '/more/settings')).toEqual(['none', 'none', 'none', 'none'])
    expect(resolveBottomTabs(items, '/stations/?q=1#top')).toEqual(['none', 'page', 'none', 'none'])
  })

  it('falls back to the named tab when nothing matches', () => {
    expect(resolveBottomTabs(items, '/settings', '/more')).toEqual([
      'none',
      'none',
      'none',
      'fallback',
    ])
    expect(resolveBottomTabs(items, '/settings')).toEqual(['none', 'none', 'none', 'none'])
  })

  it('compares fallback and item paths the same way, ignoring a query on `to`', () => {
    expect(resolveBottomTabs(items, '/settings', '/more/')[3]).toBe('fallback')
    expect(resolveBottomTabs([{ label: 'Map', to: '/map?layer=wind' }], '/map')).toEqual(['page'])
    expect(resolveBottomTabs(items, '//')).toEqual(['page', 'none', 'none', 'none'])
  })

  it('does not treat a shared spelling as a prefix', () => {
    expect(resolveBottomTabs(items, '/stationsx')).toEqual(['none', 'none', 'none', 'none'])
  })
})

describe('NeBottomTabBar', () => {
  it('follows the router and marks only the current tab', async () => {
    const router = makeRouter()
    await router.push('/stations/42')
    const wrapper = mount(NeBottomTabBar, { global: { plugins: [router] }, props: { items } })
    const links = wrapper.findAll('a')
    expect(links.map((link) => link.text())).toEqual(['Map', 'Stations', 'Library', 'More'])
    expect(links.map((link) => link.attributes('aria-current'))).toEqual([
      undefined,
      'true',
      undefined,
      undefined,
    ])
    await router.push('/')
    await nextTick()
    expect(wrapper.findAll('a')[0]?.attributes('aria-current')).toBe('page')
    expect(wrapper.get('[data-testid="tab-map"]').attributes('href')).toBe('/')
    wrapper.unmount()
  })

  it('takes an explicit path and a fallback that is lit but not current', () => {
    const router = makeRouter()
    const wrapper = mount(NeBottomTabBar, {
      global: { plugins: [router] },
      props: { items, path: '/settings', fallback: '/more', label: 'Sections' },
    })
    const more = wrapper.findAll('a')[3]
    expect(more?.attributes('data-state')).toBe('fallback')
    expect(more?.attributes('aria-current')).toBeUndefined()
    expect(wrapper.find('nav[aria-label="Sections"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('renders the item slot inside the link with the tab state', () => {
    const router = makeRouter()
    const wrapper = mount(NeBottomTabBar, {
      global: { plugins: [router] },
      props: { items, path: '/' },
      slots: {
        item: ({ item, state }: { item: NeBottomTabItem; state: string }) =>
          `${item.label}:${state}`,
      },
    })
    expect(wrapper.findAll('a').map((link) => link.text())).toEqual([
      'Map:page',
      'Stations:none',
      'Library:none',
      'More:none',
    ])
    wrapper.unmount()
  })

  it('publishes --ne-bottom-bar-h while mounted and restores it on unmount', () => {
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(64)
    document.documentElement.style.setProperty('--ne-bottom-bar-h', '0px')
    const router = makeRouter()
    const wrapper = mount(NeBottomTabBar, { global: { plugins: [router] }, props: { items } })
    expect(document.documentElement.style.getPropertyValue('--ne-bottom-bar-h')).toBe('64px')
    expect(wrapper.find(PRIMARY_NAV).exists()).toBe(true)
    wrapper.unmount()
    expect(document.documentElement.style.getPropertyValue('--ne-bottom-bar-h')).toBe('0px')
  })

  it('adds its height to a sticky action bar and lifts that bar above itself', () => {
    const heights = new Map<string, number>([
      ['ne-bottom-tab-bar__bar', 56],
      ['ne-sticky-action-bar__bar', 64],
    ])
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      return heights.get(this.className) ?? 0
    })
    const style = document.documentElement.style
    const router = makeRouter()
    const tabs = mount(NeBottomTabBar, { global: { plugins: [router] }, props: { items } })
    const sticky = mount(NeStickyActionBar, { slots: { default: () => h('button', 'Buy') } })
    expect(style.getPropertyValue('--ne-bottom-bar-h')).toBe('120px')
    expect(style.getPropertyValue('--ne-bottom-nav-h')).toBe('56px')
    sticky.unmount()
    expect(style.getPropertyValue('--ne-bottom-bar-h')).toBe('56px')
    tabs.unmount()
    expect(style.getPropertyValue('--ne-bottom-bar-h')).toBe('')
    expect(style.getPropertyValue('--ne-bottom-nav-h')).toBe('')
  })
})
