// @vitest-environment happy-dom
/*
 * NeCta, mounted (components backlog item 21, narduk-libs#268).
 *
 * Mounts the REAL `UPageCTA` (see NeHero.mount.test.ts for why real beats a
 * stub here), with a memory router for `links` that carry `to`.
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'

import NeCta from '../src/runtime/components/NeCta.vue'

import type { NeCtaProps } from '../src/index'

const router = createRouter({
  history: createMemoryHistory(),
  routes: [{ path: '/:pathMatch(.*)*', component: { render: () => null } }],
})

function render(props: NeCtaProps = {}, slots: Record<string, string> = {}) {
  return mount(NeCta, { global: { plugins: [router] }, props, slots })
}

describe('NeCta: the call-to-action panel, over UPageCTA', () => {
  it('renders the title as an h2, the description and the links', () => {
    const wrapper = render({
      description: "Tell us what you need — we'll find it fast.",
      links: [{ label: 'Get a quote', to: '/contact' }],
      title: 'Need a quote?',
    })

    expect(wrapper.find('[data-ne-cta]').exists()).toBe(true)
    expect(wrapper.get('h2').text()).toBe('Need a quote?')
    expect(wrapper.get('[data-slot="description"]').text()).toBe(
      "Tell us what you need — we'll find it fast.",
    )
    const link = wrapper.get('[data-slot="links"] a')
    expect(link.attributes('href')).toBe('/contact')
    expect(link.text()).toBe('Get a quote')
  })

  it("keeps UPageCTA's outline variant by default and passes another through", () => {
    const outline = render({ title: 'Need a quote?' })
    expect(outline.get('[data-ne-cta]').classes()).toContain('ring')

    const solid = render({ title: 'Need a quote?', variant: 'solid' })
    expect(solid.get('[data-ne-cta]').classes()).toContain('bg-inverted')
  })

  it('rounds the panel to --ne-radius-panel instead of rounded-xl', () => {
    const wrapper = render({ title: 'Need a quote?' })

    const classes = wrapper.get('[data-ne-cta]').classes()
    expect(classes).toContain('rounded-[var(--ne-radius-panel)]')
    expect(classes).not.toContain('rounded-xl')
  })

  it("merges a caller's ui after the suite's", () => {
    const wrapper = render({
      title: 'Need a quote?',
      ui: { root: 'rounded-none', title: 'max-w-xl' },
    })

    const root = wrapper.get('[data-ne-cta]').classes()
    expect(root).toContain('rounded-none')
    expect(root).not.toContain('rounded-[var(--ne-radius-panel)]')
    expect(wrapper.get('h2').classes()).toContain('max-w-xl')
  })

  it('passes orientation and reverse through', () => {
    const wrapper = render({ orientation: 'horizontal', reverse: true, title: 'Need a quote?' })

    expect(wrapper.get('[data-ne-cta]').attributes('data-orientation')).toBe('horizontal')
    expect(wrapper.get('[data-slot="wrapper"]').classes()).toContain('order-last')
  })

  it('forwards the named slots and the default slot, and only those filled', () => {
    const wrapper = render(
      { title: 'Need a quote?' },
      {
        body: '<p data-testid="body">Or call us.</p>',
        default: '<img data-testid="media" alt="Our warehouse" src="/w.jpg" />',
        links: '<a data-testid="custom-link" href="/call">Call</a>',
      },
    )

    expect(wrapper.find('[data-slot="body"] [data-testid="body"]').exists()).toBe(true)
    expect(wrapper.find('[data-slot="links"] [data-testid="custom-link"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="media"]').exists()).toBe(true)
    expect(wrapper.find('[data-slot="description"]').exists()).toBe(false)
  })
})
