// @vitest-environment happy-dom
/*
 * NeCard, mounted (narduk-libs#264): media, title, badge, stat rows, actions.
 * Types are imported from the package root the way a pilot must.
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { defineComponent, h } from 'vue'

import NeCard from '../src/runtime/components/NeCard.vue'
import { nuxtUiStubs } from './nuxt-ui-stubs'

import type { NeCardProps } from '../src/index'

const FakeUBadge = defineComponent({
  name: 'UBadge',
  setup(_props, { attrs, slots }) {
    return () => h('span', { 'data-stub': 'UBadge', ...attrs }, slots.default?.())
  },
})

function render(props: Partial<NeCardProps> = {}, slots: Record<string, string> = {}) {
  return mount(NeCard, {
    props,
    slots,
    global: { components: { ...nuxtUiStubs, UBadge: FakeUBadge } },
  })
}

describe('NeCard: the frame a collection paints once per row', () => {
  it('names the card and keeps the title in the header', () => {
    const wrapper = render({ title: 'Des Plaines at Riverside' })
    expect(wrapper.find('[data-ne-card]').exists()).toBe(true)
    expect(wrapper.get('[data-stub-slot="header"]').text()).toContain('Des Plaines at Riverside')
  })

  it('formats a numeric stat through formatNumber, not toLocaleString', () => {
    const wrapper = render({
      stats: [{ label: 'Stage', value: 1234.5 }],
      title: 'Gauge',
    })
    expect(wrapper.get('[data-ne-card-stats]').text()).toContain('Stage')
    expect(wrapper.get('[data-ne-card-stats]').text()).toContain('1,234.5')
  })

  it('prints a measured stat through formatQuantity when a unit is given', () => {
    const wrapper = render({
      stats: [{ label: 'Stage', unit: 'foot', value: 5 }],
      title: 'Gauge',
    })
    expect(wrapper.get('[data-ne-card-stats]').text()).toContain('5 ft')
  })

  it('renders a missing stat as the formatter empty placeholder, not 0', () => {
    const wrapper = render({
      stats: [{ label: 'Stage', value: null }],
      title: 'Gauge',
    })
    expect(wrapper.get('[data-ne-card-stats]').text()).toContain('—')
    expect(wrapper.get('[data-ne-card-stats]').text()).not.toMatch(/\b0\b/)
  })

  it('passes a string stat through unchanged', () => {
    const wrapper = render({
      stats: [{ label: 'Kind', value: 'Major' }],
      title: 'Gauge',
    })
    expect(wrapper.get('[data-ne-card-stats]').text()).toContain('Major')
  })

  it('paints a badge whose accessible name includes the tone', () => {
    const wrapper = render({
      badge: { label: 'Action', tone: 'warn' },
      title: 'Gauge',
    })
    expect(wrapper.get('[data-stub="UBadge"]').attributes('aria-label')).toBe('warn: Action')
    expect(wrapper.get('[data-stub="UBadge"]').text()).toContain('Action')
  })

  it('treats a string badge as a neutral chip', () => {
    const wrapper = render({ badge: 'Live', title: 'Gauge' })
    expect(wrapper.get('[data-stub="UBadge"]').attributes('aria-label')).toBe('neutral: Live')
  })

  it('renders media with an alt that falls back to the title', () => {
    const wrapper = render({ media: '/gauge.jpg', title: 'Des Plaines' })
    const image = wrapper.get('[data-ne-card-media] img')
    expect(image.attributes('src')).toBe('/gauge.jpg')
    expect(image.attributes('alt')).toBe('Des Plaines')
  })

  it('puts actions in the footer slot', () => {
    const wrapper = render({ title: 'Gauge' }, { actions: '<button>Open</button>' })
    expect(wrapper.get('[data-ne-card-actions]').text()).toBe('Open')
    expect(wrapper.get('[data-stub-slot="footer"]').text()).toBe('Open')
  })
})
