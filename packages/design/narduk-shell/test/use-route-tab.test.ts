// @vitest-environment happy-dom
/*
 * useRouteTab(): the selected tab lives in `?tab=`, written with
 * `router.replace`, with the URL kept clean and every other key and the hash
 * left alone. A real memory router drives it.
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'

import { useRouteTab } from '../src/runtime/composables/use-route-tab'

import type { NeRouteTab, NeRouteTabOptions } from '../src/runtime/composables/use-route-tab'

async function harness(path: string, options: NeRouteTabOptions) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:pathMatch(.*)*', component: { render: () => h('div') } }],
  })
  await router.push(path)
  await router.isReady()
  const replace = vi.spyOn(router, 'replace')
  const push = vi.spyOn(router, 'push')

  let result!: NeRouteTab
  const wrapper = mount(
    defineComponent({
      setup() {
        result = useRouteTab(options)
        return () => h('div', result.tab.value)
      },
    }),
    { global: { plugins: [router] } },
  )
  return { ...result, push, replace, router, wrapper }
}

const TABS = ['overview', 'trades', 'rules'] as const

describe('useRouteTab', () => {
  it('reads the tab from the query', async () => {
    const { tab, wrapper } = await harness('/g/42?tab=trades', { tabs: TABS })
    expect(tab.value).toBe('trades')
    wrapper.unmount()
  })

  it('falls back to the first tab, or to defaultTab, when the URL names none', async () => {
    const first = await harness('/g/42', { tabs: TABS })
    expect(first.tab.value).toBe('overview')
    const named = await harness('/g/42', { tabs: TABS, defaultTab: 'rules' })
    expect(named.tab.value).toBe('rules')
    first.wrapper.unmount()
    named.wrapper.unmount()
  })

  it('falls back for an unknown, empty or repeated value', async () => {
    for (const [path, expected] of [
      ['/g?tab=nope', 'overview'],
      ['/g?tab=', 'overview'],
      ['/g?tab=rules&tab=trades', 'rules'],
    ] as const) {
      const { tab, wrapper } = await harness(path, { tabs: TABS })
      expect(tab.value).toBe(expected)
      wrapper.unmount()
    }
  })

  it('writes with replace, never push, and keeps other keys and the hash', async () => {
    const { push, replace, router, setTab, wrapper } = await harness(
      '/g/42?range=1y&tab=overview#row-9',
      { tabs: TABS },
    )
    await setTab('trades')

    expect(replace).toHaveBeenCalledTimes(1)
    expect(push).not.toHaveBeenCalled()
    expect(router.currentRoute.value.query).toEqual({ range: '1y', tab: 'trades' })
    expect(router.currentRoute.value.hash).toBe('#row-9')
    wrapper.unmount()
  })

  it('leaves the URL clean for the default tab, unless keepDefault', async () => {
    const clean = await harness('/g/42?range=1y&tab=trades', { tabs: TABS })
    await clean.setTab('overview')
    expect(clean.router.currentRoute.value.query).toEqual({ range: '1y' })

    const kept = await harness('/g/42?tab=trades', { tabs: TABS, keepDefault: true })
    await kept.setTab('overview')
    expect(kept.router.currentRoute.value.query).toEqual({ tab: 'overview' })
    clean.wrapper.unmount()
    kept.wrapper.unmount()
  })

  it('uses a different query key', async () => {
    const { router, setTab, tab, wrapper } = await harness('/g?view=rules', {
      tabs: TABS,
      param: 'view',
    })
    expect(tab.value).toBe('rules')
    await setTab('trades')
    expect(router.currentRoute.value.query).toEqual({ view: 'trades' })
    wrapper.unmount()
  })

  it('ignores a name that is not a tab, and a re-selection of the current one', async () => {
    const { replace, setTab, tab, wrapper } = await harness('/g?tab=trades', { tabs: TABS })
    await setTab('nope')
    await setTab('trades')
    expect(replace).not.toHaveBeenCalled()
    expect(tab.value).toBe('trades')
    wrapper.unmount()
  })

  it('shows the chosen tab at once, before the navigation resolves', async () => {
    const { replace, tab, wrapper } = await harness('/g', { tabs: TABS })
    let release!: () => void
    replace.mockImplementationOnce(
      () => new Promise((resolve) => (release = () => resolve(undefined))) as never,
    )

    tab.value = 'rules'
    expect(tab.value).toBe('rules')
    release()
    wrapper.unmount()
  })

  it('follows a tab set that changes', async () => {
    const tabs = ref<string[]>(['overview', 'trades'])
    const { tab, wrapper } = await harness('/g?tab=rules', { tabs })
    expect(tab.value).toBe('overview')
    tabs.value = ['overview', 'trades', 'rules']
    expect(tab.value).toBe('rules')
    wrapper.unmount()
  })
})
