/*
 * Server-render proof for NeHero (components backlog item 21,
 * narduk-libs#268). Pattern: packages/design/narduk-charts/src/ssr.test.ts.
 *
 * A landing page's hero is the first thing a crawler and a slow phone see, so
 * the headline, the one `<h1>` and the call to action have to be in the
 * server's HTML, not painted in after hydration. This file runs in vitest's
 * `node` environment with no `document`, and renders the REAL `UPageHero`
 * (`vitest.config.ts` loads `@nuxt/ui/vite`, which supplies the `#build/ui/*`
 * and `#imports` virtuals its source imports), so it proves the composition
 * against Nuxt UI's own markup rather than a stand-in.
 */
import { renderToString } from '@vue/server-renderer'
import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'

import NeHero from '../src/runtime/components/NeHero.vue'

import type { NeHeroProps } from '../src/index'

it('runs in an environment with no DOM, which is the whole point of this file', () => {
  expect(typeof document).toBe('undefined')
  expect(typeof window).toBe('undefined')
})

async function render(
  props: NeHeroProps,
  slots: Record<string, () => unknown> = {},
): Promise<string> {
  // A `to` link resolves through vue-router, the way it does in an app.
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:pathMatch(.*)*', component: { render: () => null } }],
  })
  await router.push('/')
  await router.isReady()
  const app = createSSRApp({ render: () => h(NeHero, props, slots) })
  app.use(router)
  return renderToString(app)
}

describe('NeHero server-rendered without a DOM', () => {
  it('carries the headline, one h1 and the description into the first paint', async () => {
    const html = await render({
      description: 'Hand-picked breakers, tested and shipped the same day.',
      headline: 'Equipment',
      title: 'Circuit breakers that ship today',
    })

    expect(html).toContain('data-ne-hero')
    expect(html).toContain('Equipment')
    expect(html.match(/<h1\b/g)).toHaveLength(1)
    expect(html).toMatch(/<h1[^>]*>[\s\S]*Circuit breakers that ship today[\s\S]*<\/h1>/)
    expect(html).toContain('Hand-picked breakers, tested and shipped the same day.')
  })

  it('renders links as real anchors with their hrefs', async () => {
    const html = await render({
      links: [
        { label: 'Browse the catalog', to: '/products' },
        { color: 'neutral', label: 'Request a quote', to: '/contact', variant: 'outline' },
      ],
      title: 'Circuit breakers',
    })

    expect(html).toContain('href="/products"')
    expect(html).toContain('Browse the catalog')
    expect(html).toContain('href="/contact"')
    expect(html).toContain('Request a quote')
  })

  it('paints the headline in --ne-accent, not the primary alias', async () => {
    const html = await render({ headline: 'Equipment', title: 'Circuit breakers' })

    expect(html).toContain('text-[var(--ne-accent)]')
    expect(html).not.toMatch(/data-slot="headline"[^>]*text-primary/)
  })

  it('carries default-slot media into the server HTML', async () => {
    const html = await render(
      { orientation: 'horizontal', title: 'Circuit breakers' },
      { default: () => h('img', { alt: 'A breaker panel', src: '/panel.jpg' }) },
    )

    expect(html).toContain('data-orientation="horizontal"')
    expect(html).toContain('alt="A breaker panel"')
  })

  it('does not touch a DOM global merely by rendering twice', async () => {
    await expect(render({ title: 'One' })).resolves.toContain('One')
    await expect(render({ title: 'Two' })).resolves.toContain('Two')
    expect(typeof document).toBe('undefined')
    expect(typeof window).toBe('undefined')
  })
})
