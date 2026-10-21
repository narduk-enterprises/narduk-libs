// @vitest-environment happy-dom
/*
 * NeTabs, mounted: the tablist contract (roles, selection, roving tabindex,
 * arrow/Home/End keys that skip disabled tabs), the active tab scrolled into
 * view inside the strip, and the route-backed mode (`?tab=`, replace, clean
 * default).
 */
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { h, nextTick } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'

import NeTabs from '../src/runtime/components/NeTabs.vue'

import type { NeTabItem } from '../src/runtime/components/ne-tabs-types'

const items: NeTabItem[] = [
  { value: 'overview', label: 'Overview' },
  { value: 'trades', label: 'Trades', badge: 3 },
  { value: 'rules', label: 'Rules', disabled: true },
  { value: 'chat', label: 'Chat' },
]

afterEach(() => {
  vi.restoreAllMocks()
})

const tabs = (wrapper: ReturnType<typeof mount>) => wrapper.findAll('[role="tab"]')
const label = (tab: { get: (selector: string) => { text: () => string } }) =>
  tab.get('.ne-tabs__label').text()
const selected = (wrapper: ReturnType<typeof mount>) =>
  tabs(wrapper).filter((tab) => tab.attributes('aria-selected') === 'true')

describe('NeTabs structure', () => {
  it('is a named tablist of tabs with one selected, the first enabled by default', () => {
    const wrapper = mount(NeTabs, { props: { items, label: 'Game sections' } })
    const list = wrapper.get('[role="tablist"]')
    expect(list.attributes('aria-label')).toBe('Game sections')
    expect(tabs(wrapper)).toHaveLength(4)
    expect(selected(wrapper).map(label)).toEqual(['Overview'])
    expect(wrapper.get('.ne-tabs__badge').text()).toBe('3')
    wrapper.unmount()
  })

  it('has a roving tabindex: only the selected tab is in the Tab order', () => {
    const wrapper = mount(NeTabs, { props: { items, defaultValue: 'trades' } })
    expect(tabs(wrapper).map((tab) => tab.attributes('tabindex'))).toEqual(['-1', '0', '-1', '-1'])
    wrapper.unmount()
  })

  it('marks a disabled tab disabled and refuses to select it', async () => {
    const wrapper = mount(NeTabs, { props: { items } })
    const rules = tabs(wrapper)[2]!
    expect(rules.attributes('aria-disabled')).toBe('true')
    expect(rules.attributes('disabled')).toBeDefined()
    await rules.trigger('click')
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    wrapper.unmount()
  })

  it('renders a tabpanel wired to the selected tab only when it has a default slot', () => {
    const bare = mount(NeTabs, { props: { items } })
    expect(bare.find('[role="tabpanel"]').exists()).toBe(false)
    expect(tabs(bare)[0]!.attributes('aria-controls')).toBeUndefined()

    const wrapper = mount(NeTabs, {
      props: { items, defaultValue: 'trades' },
      slots: { default: ({ value }: { value: string }) => h('p', `panel ${value}`) },
    })
    const panel = wrapper.get('[role="tabpanel"]')
    const active = tabs(wrapper)[1]!
    expect(panel.text()).toBe('panel trades')
    expect(panel.attributes('aria-labelledby')).toBe(active.attributes('id'))
    expect(active.attributes('aria-controls')).toBe(panel.attributes('id'))
    expect(tabs(wrapper)[0]!.attributes('aria-controls')).toBeUndefined()
    bare.unmount()
    wrapper.unmount()
  })

  it('falls back to the first enabled tab when the model names a disabled or unknown one', () => {
    for (const modelValue of ['rules', 'nope']) {
      const wrapper = mount(NeTabs, { props: { items, modelValue } })
      expect(selected(wrapper).map(label)).toEqual(['Overview'])
      wrapper.unmount()
    }
  })
})

describe('NeTabs selection (v-model)', () => {
  it('selects on click and emits update:modelValue once', async () => {
    const wrapper = mount(NeTabs, { props: { items } })
    await tabs(wrapper)[3]!.trigger('click')
    expect(wrapper.emitted('update:modelValue')).toEqual([['chat']])
    expect(selected(wrapper).map(label)).toEqual(['Chat'])
    await tabs(wrapper)[3]!.trigger('click')
    expect(wrapper.emitted('update:modelValue')).toHaveLength(1)
    wrapper.unmount()
  })

  it('follows a controlled modelValue', async () => {
    const wrapper = mount(NeTabs, { props: { items, modelValue: 'overview' } })
    await wrapper.setProps({ modelValue: 'chat' })
    expect(selected(wrapper).map(label)).toEqual(['Chat'])
    wrapper.unmount()
  })
})

describe('NeTabs keyboard', () => {
  async function press(wrapper: ReturnType<typeof mount>, index: number, key: string) {
    await tabs(wrapper)[index]!.trigger('keydown', { key })
  }

  it('moves and selects with the arrows, skipping a disabled tab and wrapping', async () => {
    const wrapper = mount(NeTabs, { props: { items }, attachTo: document.body })
    await press(wrapper, 0, 'ArrowRight')
    expect(selected(wrapper).map(label)).toEqual(['Trades'])
    expect(document.activeElement).toBe(tabs(wrapper)[1]!.element)

    await press(wrapper, 1, 'ArrowRight') // skips Rules
    expect(selected(wrapper).map(label)).toEqual(['Chat'])

    await press(wrapper, 3, 'ArrowRight') // wraps
    expect(selected(wrapper).map(label)).toEqual(['Overview'])

    await press(wrapper, 0, 'ArrowLeft') // wraps back
    expect(selected(wrapper).map(label)).toEqual(['Chat'])
    wrapper.unmount()
  })

  it('jumps to the ends with Home and End, ignoring disabled ones', async () => {
    const wrapper = mount(NeTabs, {
      props: { items, defaultValue: 'trades' },
      attachTo: document.body,
    })
    await press(wrapper, 1, 'End')
    expect(selected(wrapper).map(label)).toEqual(['Chat'])
    await press(wrapper, 3, 'Home')
    expect(selected(wrapper).map(label)).toEqual(['Overview'])
    wrapper.unmount()
  })

  it('leaves other keys alone', async () => {
    const wrapper = mount(NeTabs, { props: { items } })
    await press(wrapper, 0, 'a')
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    wrapper.unmount()
  })
})

describe('NeTabs scrolling the active tab into view', () => {
  function overflowing() {
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(900)
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(300)
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(100)
    vi.spyOn(HTMLElement.prototype, 'offsetLeft', 'get').mockReturnValue(600)
    const scrollTo = vi.fn()
    HTMLElement.prototype.scrollTo = scrollTo as never
    return scrollTo
  }

  it('centres the selected tab in the strip on mount, without animating', () => {
    const scrollTo = overflowing()
    const wrapper = mount(NeTabs, { props: { items, defaultValue: 'chat' } })
    expect(scrollTo).toHaveBeenCalledWith({ left: 500, behavior: 'auto' })
    wrapper.unmount()
  })

  it('glides to a newly selected tab, and jumps under reduced motion', async () => {
    const scrollTo = overflowing()
    const wrapper = mount(NeTabs, { props: { items } })
    scrollTo.mockClear()
    await tabs(wrapper)[3]!.trigger('click')
    await nextTick()
    await nextTick()
    expect(scrollTo).toHaveBeenLastCalledWith({ left: 500, behavior: 'smooth' })
    wrapper.unmount()

    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('reduce'),
      addEventListener() {},
      removeEventListener() {},
    }))
    const reduced = mount(NeTabs, { props: { items } })
    await nextTick()
    scrollTo.mockClear()
    await tabs(reduced)[3]!.trigger('click')
    await nextTick()
    await nextTick()
    expect(scrollTo).toHaveBeenLastCalledWith({ left: 500, behavior: 'auto' })
    reduced.unmount()
    vi.unstubAllGlobals()
  })

  it('does not scroll a strip that fits', () => {
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(300)
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(300)
    const scrollTo = vi.fn()
    HTMLElement.prototype.scrollTo = scrollTo as never
    const wrapper = mount(NeTabs, { props: { items, defaultValue: 'chat' } })
    expect(scrollTo).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})

describe('NeTabs route-param', () => {
  async function routed(path: string, props: Record<string, unknown> = {}) {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/:pathMatch(.*)*', component: { render: () => h('div') } }],
    })
    await router.push(path)
    await router.isReady()
    const push = vi.spyOn(router, 'push')
    const wrapper = mount(NeTabs, {
      props: { items, routeParam: 'tab', ...props },
      global: { plugins: [router] },
    })
    return { push, router, wrapper }
  }

  it('selects from the URL, and falls back for an unknown or disabled tab', async () => {
    const named = await routed('/g/42?tab=chat')
    expect(selected(named.wrapper).map(label)).toEqual(['Chat'])
    const unknown = await routed('/g/42?tab=nope')
    expect(selected(unknown.wrapper).map(label)).toEqual(['Overview'])
    const disabled = await routed('/g/42?tab=rules')
    expect(selected(disabled.wrapper).map(label)).toEqual(['Overview'])
    for (const { wrapper } of [named, unknown, disabled]) wrapper.unmount()
  })

  it('writes ?tab= with replace, keeps other keys, and leaves the default clean', async () => {
    const { push, router, wrapper } = await routed('/g/42?range=1y')

    await tabs(wrapper)[1]!.trigger('click')
    await vi.waitFor(() =>
      expect(router.currentRoute.value.query).toEqual({ range: '1y', tab: 'trades' }),
    )
    expect(push).not.toHaveBeenCalled()
    expect(selected(wrapper).map(label)).toEqual(['Trades'])

    await tabs(wrapper)[0]!.trigger('click')
    await vi.waitFor(() => expect(router.currentRoute.value.query).toEqual({ range: '1y' }))
    wrapper.unmount()
  })

  it('follows the URL when it changes elsewhere (Back, a link)', async () => {
    const { router, wrapper } = await routed('/g/42?tab=trades')
    await router.replace({ query: { tab: 'chat' } })
    await nextTick()
    expect(selected(wrapper).map(label)).toEqual(['Chat'])
    wrapper.unmount()
  })

  it('moves with the arrow keys too', async () => {
    const { router, wrapper } = await routed('/g/42?tab=trades')
    await tabs(wrapper)[1]!.trigger('keydown', { key: 'ArrowRight' })
    await vi.waitFor(() => expect(router.currentRoute.value.query).toEqual({ tab: 'chat' }))
    wrapper.unmount()
  })
})
