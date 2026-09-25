/*
 * Server-render proof for NeCta (components backlog item 21,
 * narduk-libs#268). Pattern: packages/design/narduk-charts/src/ssr.test.ts.
 *
 * The call to action is the one thing a landing page exists to get clicked,
 * so its heading and its button have to arrive with the document. Runs in
 * vitest's `node` environment with no `document`, against the REAL `UPageCTA`
 * (see NeHero.ssr.test.ts).
 */
import { renderToString } from '@vue/server-renderer'
import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'

import NeCta from '../src/runtime/components/NeCta.vue'

import type { NeCtaProps } from '../src/index'

it('runs in an environment with no DOM, which is the whole point of this file', () => {
  expect(typeof document).toBe('undefined')
  expect(typeof window).toBe('undefined')
})

async function render(
  props: NeCtaProps,
  slots: Record<string, () => unknown> = {},
): Promise<string> {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:pathMatch(.*)*', component: { render: () => null } }],
  })
  await router.push('/')
  await router.isReady()
  const app = createSSRApp({ render: () => h(NeCta, props, slots) })
  app.use(router)
  return renderToString(app)
}

describe('NeCta server-rendered without a DOM', () => {
  it('carries the h2, description and button into the first paint', async () => {
    const html = await render({
      description: "Tell us what you need — we'll find it fast.",
      links: [{ label: 'Get a quote', to: '/contact' }],
      title: 'Need a quote?',
    })

    expect(html).toContain('data-ne-cta')
    expect(html).toMatch(/<h2[^>]*>[\s\S]*Need a quote\?[\s\S]*<\/h2>/)
    expect(html).toContain('we&#39;ll find it fast.')
    expect(html).toContain('href="/contact"')
    expect(html).toContain('Get a quote')
  })

  it('carries the suite radius and the chosen variant', async () => {
    const html = await render({ title: 'Need a quote?', variant: 'soft' })

    expect(html).toContain('rounded-[var(--ne-radius-panel)]')
    expect(html).not.toContain('rounded-xl')
    expect(html).toContain('bg-elevated/50')
  })

  it('carries default-slot content', async () => {
    const html = await render(
      { orientation: 'horizontal', title: 'Need a quote?' },
      { default: () => h('img', { alt: 'Our warehouse', src: '/w.jpg' }) },
    )

    expect(html).toContain('alt="Our warehouse"')
  })
})
