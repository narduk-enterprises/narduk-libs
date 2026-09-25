// @vitest-environment happy-dom
/*
 * NeHero, mounted (components backlog item 21, narduk-libs#268).
 *
 * Mounts the REAL `UPageHero` rather than a stub: `vitest.config.ts` loads
 * `@nuxt/ui/vite`, which resolves the `#build/ui/*` and `#imports` virtuals
 * its source imports, and the thing this suite has to pin down is exactly the
 * pass-through — that each prop and slot reaches Nuxt UI's own markup, and
 * that the suite's token classes merge with a caller's instead of replacing
 * them. A memory router is installed because `links` with `to` resolve
 * through vue-router, as they do in an app.
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'

import NeHero from '../src/runtime/components/NeHero.vue'

import type { NeHeroProps } from '../src/index'

const router = createRouter({
  history: createMemoryHistory(),
  routes: [{ path: '/:pathMatch(.*)*', component: { render: () => null } }],
})

function render(props: NeHeroProps = {}, slots: Record<string, string> = {}) {
  return mount(NeHero, { global: { plugins: [router] }, props, slots })
}

describe('NeHero: the top of a landing page, over UPageHero', () => {
  it('renders the headline, the title as the one h1, and the description', () => {
    const wrapper = render({
      description: 'Tested and shipped the same day.',
      headline: 'Equipment',
      title: 'Circuit breakers',
    })

    expect(wrapper.find('[data-ne-hero]').exists()).toBe(true)
    expect(wrapper.get('[data-slot="headline"]').text()).toBe('Equipment')
    const headings = wrapper.findAll('h1')
    expect(headings).toHaveLength(1)
    expect(headings[0]?.text()).toBe('Circuit breakers')
    expect(wrapper.get('[data-slot="description"]').text()).toBe('Tested and shipped the same day.')
  })

  it('renders each link as a UButton anchor, in order', () => {
    const wrapper = render({
      links: [
        { label: 'Browse the catalog', to: '/products' },
        { label: 'Request a quote', to: '/contact', variant: 'outline' },
      ],
      title: 'Circuit breakers',
    })

    const anchors = wrapper.get('[data-slot="links"]').findAll('a')
    expect(anchors.map((anchor) => anchor.attributes('href'))).toEqual(['/products', '/contact'])
    expect(anchors.map((anchor) => anchor.text())).toEqual([
      'Browse the catalog',
      'Request a quote',
    ])
  })

  it('omits the headline, description and links blocks when nothing fills them', () => {
    const wrapper = render({ title: 'Circuit breakers' })

    expect(wrapper.find('[data-slot="headline"]').exists()).toBe(false)
    expect(wrapper.find('[data-slot="description"]').exists()).toBe(false)
    expect(wrapper.find('[data-slot="footer"]').exists()).toBe(false)
    // An unfilled slot is not forwarded, so Nuxt UI's own `!!slots.body`
    // check stays false and no empty wrapper is rendered.
    expect(wrapper.find('[data-slot="body"]').exists()).toBe(false)
  })

  it('passes orientation and reverse through to UPageHero', () => {
    const wrapper = render({ orientation: 'horizontal', reverse: true, title: 'Circuit breakers' })

    expect(wrapper.get('[data-ne-hero]').attributes('data-orientation')).toBe('horizontal')
    expect(wrapper.get('[data-slot="wrapper"]').classes()).toContain('order-last')
  })

  it('forwards every named slot and the default slot', () => {
    const wrapper = render(
      { title: 'Circuit breakers' },
      {
        body: '<p data-testid="body">Stocked in Texas.</p>',
        bottom: '<div data-testid="bottom" />',
        default: '<img data-testid="media" alt="A breaker panel" src="/panel.jpg" />',
        headline: '<span data-testid="headline">New stock</span>',
        title: 'Breakers, <em data-testid="title-em">today</em>',
        top: '<div data-testid="top" />',
      },
    )

    expect(wrapper.find('[data-testid="top"]').exists()).toBe(true)
    expect(wrapper.find('[data-slot="headline"] [data-testid="headline"]').exists()).toBe(true)
    expect(wrapper.find('h1 [data-testid="title-em"]').exists()).toBe(true)
    expect(wrapper.find('[data-slot="body"] [data-testid="body"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="media"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="bottom"]').exists()).toBe(true)
  })

  it('paints the headline in --ne-accent instead of the primary alias', () => {
    const wrapper = render({ headline: 'Equipment', title: 'Circuit breakers' })

    const headline = wrapper.get('[data-slot="headline"]').classes()
    expect(headline).toContain('text-[var(--ne-accent)]')
    expect(headline).not.toContain('text-primary')
    expect(wrapper.get('h1').classes()).toContain('tracking-[var(--ne-tracking-tight)]')
    expect(wrapper.get('h1').classes()).not.toContain('tracking-tight')
  })

  it("merges a caller's ui after the suite's, so the caller wins a conflict", () => {
    const wrapper = render({
      description: 'Tested and shipped the same day.',
      headline: 'Equipment',
      title: 'Circuit breakers',
      ui: { description: 'max-w-2xl', headline: 'text-highlighted' },
    })

    const headline = wrapper.get('[data-slot="headline"]').classes()
    expect(headline).toContain('text-highlighted')
    expect(headline).not.toContain('text-[var(--ne-accent)]')
    // A slot the suite does not theme is the caller's alone, and a slot the
    // caller does not name keeps the suite's class.
    expect(wrapper.get('[data-slot="description"]').classes()).toContain('max-w-2xl')
    expect(wrapper.get('h1').classes()).toContain('tracking-[var(--ne-tracking-tight)]')
  })

  it("lets a caller's replacer function replace the suite's class too", () => {
    const wrapper = render({
      headline: 'Equipment',
      title: 'Circuit breakers',
      ui: { headline: () => 'text-highlighted' },
    })

    expect(wrapper.get('[data-slot="headline"]').classes()).toEqual(['text-highlighted'])
  })

  it('falls a class attribute through to the root', () => {
    const wrapper = mount(NeHero, {
      attrs: { class: 'bg-[var(--ne-ground)]' },
      global: { plugins: [router] },
      props: { title: 'Circuit breakers' },
    })

    expect(wrapper.get('[data-ne-hero]').classes()).toContain('bg-[var(--ne-ground)]')
  })
})
