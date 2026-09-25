/*
 * Server-render proof for NeFeatureGrid (components backlog item 21,
 * narduk-libs#268). Pattern: packages/design/narduk-charts/src/ssr.test.ts.
 *
 * Feature copy is landing-page content a crawler reads, so every tile's title
 * and description has to be in the server's HTML. Runs in vitest's `node`
 * environment with no `document`, against the REAL `UPageGrid` and
 * `UPageFeature` (see NeHero.ssr.test.ts).
 */
import { renderToString } from '@vue/server-renderer'
import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'

import NeFeatureGrid from '../src/runtime/components/NeFeatureGrid.vue'

import type { NeFeatureGridProps } from '../src/index'

it('runs in an environment with no DOM, which is the whole point of this file', () => {
  expect(typeof document).toBe('undefined')
  expect(typeof window).toBe('undefined')
})

async function render(
  props: NeFeatureGridProps,
  slots: Record<string, () => unknown> = {},
): Promise<string> {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:pathMatch(.*)*', component: { render: () => null } }],
  })
  await router.push('/')
  await router.isReady()
  const app = createSSRApp({ render: () => h(NeFeatureGrid, props, slots) })
  app.use(router)
  return renderToString(app)
}

describe('NeFeatureGrid server-rendered without a DOM', () => {
  it('carries every tile as a list item into the first paint', async () => {
    const html = await render({
      features: [
        { description: 'Every breaker is load-tested.', icon: 'i-lucide-zap', title: 'Tested' },
        { description: 'Orders before 3pm ship today.', title: 'Same day' },
      ],
    })

    expect(html).toContain('data-ne-feature-grid')
    expect(html).toMatch(/^<ul\b/)
    expect(html.match(/<li\b/g)).toHaveLength(2)
    expect(html).toContain('Tested')
    expect(html).toContain('Every breaker is load-tested.')
    expect(html).toContain('Same day')
    expect(html).toContain('text-[var(--ne-accent)]')
  })

  it('carries a linked tile as a real anchor', async () => {
    const html = await render({ features: [{ title: 'Support', to: '/contact' }] })

    expect(html).toContain('href="/contact"')
    expect(html).toContain('aria-label="Support"')
  })

  it('carries default-slot content in a div grid', async () => {
    const html = await render(
      { features: [] },
      { default: () => h('article', { 'data-testid': 'quote' }, 'Fast and friendly.') },
    )

    expect(html).toMatch(/^<div\b/)
    expect(html).toContain('Fast and friendly.')
  })

  it('renders no empty list when there are no features', async () => {
    const html = await render({ features: [] })

    expect(html).not.toContain('<ul')
    expect(html).not.toContain('data-ne-feature-grid')
  })
})
