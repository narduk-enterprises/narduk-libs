// @vitest-environment happy-dom
/*
 * NeFeatureGrid, mounted (components backlog item 21, narduk-libs#268).
 *
 * Mounts the REAL `UPageGrid`, `UPageFeature` and `UIcon` (see
 * NeHero.mount.test.ts for why real beats a stub here). A memory router is
 * installed because a feature with `to` renders a `ULink`.
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'

import NeFeatureGrid from '../src/runtime/components/NeFeatureGrid.vue'

import type { NeFeature, NeFeatureGridProps } from '../src/index'

const router = createRouter({
  history: createMemoryHistory(),
  routes: [{ path: '/:pathMatch(.*)*', component: { render: () => null } }],
})

const FEATURES: NeFeature[] = [
  { description: 'Every breaker is load-tested.', icon: 'i-lucide-zap', title: 'Tested' },
  { description: 'Orders before 3pm ship today.', icon: 'i-lucide-truck', title: 'Same day' },
  { description: 'Engineers on the phone.', title: 'Support', to: '/contact' },
]

function render(props: NeFeatureGridProps = {}, slots: Record<string, string> = {}) {
  return mount(NeFeatureGrid, { global: { plugins: [router] }, props, slots })
}

describe('NeFeatureGrid: feature tiles on UPageGrid + UPageFeature', () => {
  it('renders the features as a list, one li per tile, in order', () => {
    const wrapper = render({ features: FEATURES })

    const grid = wrapper.get('[data-ne-feature-grid]')
    expect(grid.element.tagName).toBe('UL')
    const items = grid.findAll(':scope > li')
    expect(items).toHaveLength(3)
    expect(items.map((item) => item.get('[data-slot="title"]').text())).toEqual([
      'Tested',
      'Same day',
      'Support',
    ])
    expect(items[1]?.get('[data-slot="description"]').text()).toBe('Orders before 3pm ship today.')
  })

  it("keeps UPageGrid's responsive grid classes", () => {
    const wrapper = render({ features: FEATURES })

    const classes = wrapper.get('[data-ne-feature-grid]').classes()
    expect(classes).toContain('grid')
    expect(classes).toContain('lg:grid-cols-3')
  })

  it('renders a tile with `to` as a whole-tile link named by its title', () => {
    const wrapper = render({ features: FEATURES })

    const link = wrapper.get('a[href="/contact"]')
    expect(link.attributes('aria-label')).toBe('Support')
  })

  it('paints each leading icon in --ne-accent instead of the primary alias', () => {
    const wrapper = render({ features: FEATURES })

    const icons = wrapper.findAll('[data-slot="leadingIcon"]')
    expect(icons).toHaveLength(2)
    for (const icon of icons) {
      expect(icon.classes()).toContain('text-[var(--ne-accent)]')
      expect(icon.classes()).not.toContain('text-primary')
    }
  })

  it("merges a tile's own ui after the suite's", () => {
    const wrapper = render({
      features: [
        { icon: 'i-lucide-zap', title: 'Tested', ui: { leadingIcon: 'text-highlighted' } },
      ],
    })

    const classes = wrapper.get('[data-slot="leadingIcon"]').classes()
    expect(classes).toContain('text-highlighted')
    expect(classes).not.toContain('text-[var(--ne-accent)]')
  })

  it('passes a feature orientation through', () => {
    const wrapper = render({ features: [{ orientation: 'vertical', title: 'Tested' }] })

    expect(wrapper.get('li').attributes('data-orientation')).toBe('vertical')
  })

  it('renders nothing for an empty list, rather than an empty ul', () => {
    const wrapper = render({ features: [] })

    expect(wrapper.find('[data-ne-feature-grid]').exists()).toBe(false)
    expect(wrapper.find('ul').exists()).toBe(false)
  })

  it('renders the default slot inside a div grid instead of the tiles', () => {
    const wrapper = render(
      { features: FEATURES },
      { default: '<article data-testid="custom">Quote</article>' },
    )

    const grid = wrapper.get('[data-ne-feature-grid]')
    expect(grid.element.tagName).toBe('DIV')
    expect(grid.find('[data-testid="custom"]').exists()).toBe(true)
    expect(grid.find('li').exists()).toBe(false)
  })

  it("passes `as` and the grid's own ui through", () => {
    const wrapper = render({ as: 'section', features: FEATURES, ui: { base: 'gap-4' } })

    const grid = wrapper.get('[data-ne-feature-grid]')
    expect(grid.element.tagName).toBe('SECTION')
    expect(grid.classes()).toContain('gap-4')
    expect(grid.classes()).not.toContain('gap-8')
  })
})
