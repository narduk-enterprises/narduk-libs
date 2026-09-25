// @vitest-environment happy-dom
/*
 * NeMarketingFooter, mounted (components backlog item 21, narduk-libs#268).
 *
 * Mounts the REAL `UFooter` and, in the columns case, the real
 * `UFooterColumns` the README tells a caller to put in `#top` (see
 * NeHero.mount.test.ts for why real beats a stub here).
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { h } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'

import UFooterColumns from '@nuxt/ui/components/FooterColumns.vue'

import NeMarketingFooter from '../src/runtime/components/NeMarketingFooter.vue'

import type { NeMarketingFooterProps } from '../src/index'

const router = createRouter({
  history: createMemoryHistory(),
  routes: [{ path: '/:pathMatch(.*)*', component: { render: () => null } }],
})

function render(
  props: NeMarketingFooterProps = {},
  slots: Record<string, string | (() => unknown)> = {},
) {
  return mount(NeMarketingFooter, { global: { plugins: [router] }, props, slots })
}

describe('NeMarketingFooter: the site footer, over UFooter', () => {
  it('renders one footer landmark with the left, centre and right content', () => {
    const wrapper = render(
      {},
      {
        default: '<p data-testid="centre">© 2026 Circuit Breaker</p>',
        left: '<a data-testid="left" href="/privacy">Privacy</a>',
        right: '<a data-testid="right" href="/contact">Contact</a>',
      },
    )

    const footers = wrapper.findAll('footer')
    expect(footers).toHaveLength(1)
    expect(footers[0]?.attributes('data-ne-marketing-footer')).toBeDefined()
    expect(wrapper.get('[data-slot="left"] [data-testid="left"]').text()).toBe('Privacy')
    expect(wrapper.get('[data-slot="center"] [data-testid="centre"]').text()).toContain('2026')
    expect(wrapper.get('[data-slot="right"] [data-testid="right"]').text()).toBe('Contact')
  })

  it('renders the top and bottom rows only when filled', () => {
    const empty = render({}, { default: '<p>©</p>' })
    expect(empty.find('[data-slot="top"]').exists()).toBe(false)
    expect(empty.find('[data-slot="bottom"]').exists()).toBe(false)

    const filled = render(
      {},
      { bottom: '<p data-testid="bottom">Fine print</p>', top: '<p data-testid="top">Links</p>' },
    )
    expect(filled.find('[data-slot="top"] [data-testid="top"]').exists()).toBe(true)
    expect(filled.find('[data-slot="bottom"] [data-testid="bottom"]').exists()).toBe(true)
  })

  it('hosts UFooterColumns in #top, the way the README shows', () => {
    const wrapper = render(
      {},
      {
        top: () =>
          h(UFooterColumns, {
            columns: [
              { children: [{ label: 'Breakers', to: '/products' }], label: 'Catalog' },
              { children: [{ label: 'About', to: '/about' }], label: 'Company' },
            ],
          }),
      },
    )

    const top = wrapper.get('[data-slot="top"]')
    expect(top.text()).toContain('Catalog')
    expect(top.get('a[href="/products"]').text()).toContain('Breakers')
    expect(top.get('a[href="/about"]').text()).toContain('About')
  })

  it('draws the --ne-hairline rule above the footer', () => {
    const wrapper = render({}, { default: '<p>©</p>' })

    const classes = wrapper.get('footer').classes()
    expect(classes).toContain('border-t')
    expect(classes).toContain('border-[var(--ne-hairline)]')
  })

  it("passes `as` and merges a caller's ui after the suite's", () => {
    const wrapper = render(
      { as: 'div', ui: { container: 'py-2', root: 'border-t-0' } },
      { default: '<p>©</p>' },
    )

    expect(wrapper.find('footer').exists()).toBe(false)
    const root = wrapper.get('[data-ne-marketing-footer]')
    expect(root.element.tagName).toBe('DIV')
    expect(root.classes()).toContain('border-t-0')
    expect(root.classes()).not.toContain('border-t')
    expect(wrapper.get('[data-slot="container"]').classes()).toContain('py-2')
  })
})
