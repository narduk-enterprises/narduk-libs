/*
 * Server-render proof for NeMarketingFooter (components backlog item 21,
 * narduk-libs#268). Pattern: packages/design/narduk-charts/src/ssr.test.ts.
 *
 * The footer's legal and contact links are part of every public page's HTML,
 * so they must not wait for hydration. Runs in vitest's `node` environment
 * with no `document`, against the REAL `UFooter` (see NeHero.ssr.test.ts).
 */
import { renderToString } from '@vue/server-renderer'
import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'

import NeMarketingFooter from '../src/runtime/components/NeMarketingFooter.vue'

import type { NeMarketingFooterProps } from '../src/index'

it('runs in an environment with no DOM, which is the whole point of this file', () => {
  expect(typeof document).toBe('undefined')
  expect(typeof window).toBe('undefined')
})

function render(
  props: NeMarketingFooterProps,
  slots: Record<string, () => unknown> = {},
): Promise<string> {
  return renderToString(createSSRApp({ render: () => h(NeMarketingFooter, props, slots) }))
}

describe('NeMarketingFooter server-rendered without a DOM', () => {
  it('carries one footer landmark and its row content into the first paint', async () => {
    const html = await render(
      {},
      {
        default: () => h('p', '© 2026 Circuit Breaker'),
        left: () => h('a', { href: '/privacy' }, 'Privacy'),
        right: () => h('a', { href: '/contact' }, 'Contact'),
      },
    )

    expect(html).toMatch(/^<footer\b/)
    expect(html.match(/<footer\b/g)).toHaveLength(1)
    expect(html).toContain('data-ne-marketing-footer')
    expect(html).toContain('© 2026 Circuit Breaker')
    expect(html).toContain('href="/privacy"')
    expect(html).toContain('href="/contact"')
    expect(html).toContain('border-[var(--ne-hairline)]')
  })

  it('carries the top row when filled and omits it otherwise', async () => {
    const withTop = await render({}, { top: () => h('nav', { 'aria-label': 'Site' }, 'Catalog') })
    expect(withTop).toContain('data-slot="top"')
    expect(withTop).toContain('aria-label="Site"')

    const withoutTop = await render({}, { default: () => h('p', '©') })
    expect(withoutTop).not.toContain('data-slot="top"')
  })
})
