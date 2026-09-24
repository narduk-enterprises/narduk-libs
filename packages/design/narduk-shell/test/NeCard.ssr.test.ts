/*
 * Server-render proof for NeCard (narduk-libs#264).
 *
 * Pattern: packages/design/narduk-charts/src/ssr.test.ts. A card is chrome
 * that arrives with the document, so the title, formatted stats and badge
 * name have to be in the first paint. This file runs in vitest's `node`
 * environment and renders through `@vue/server-renderer`.
 */
import { renderToString } from '@vue/server-renderer'
import { describe, expect, it } from 'vitest'
import { createSSRApp, defineComponent, h } from 'vue'

import NeCard from '../src/runtime/components/NeCard.vue'
import { nuxtUiStubs } from './nuxt-ui-stubs'

import type { NeCardProps } from '../src/runtime/components/ne-card-types'

const FakeUBadge = defineComponent({
  name: 'UBadge',
  setup(_props, { attrs, slots }) {
    return () => h('span', { 'data-stub': 'UBadge', ...attrs }, slots.default?.())
  },
})

it('runs in an environment with no DOM, which is the whole point of this file', () => {
  expect(typeof document).toBe('undefined')
  expect(typeof window).toBe('undefined')
})

function render(props: NeCardProps, slots: Record<string, () => unknown> = {}): Promise<string> {
  const app = createSSRApp({ render: () => h(NeCard, props, slots) })
  for (const [name, component] of Object.entries(nuxtUiStubs)) app.component(name, component)
  app.component('UBadge', FakeUBadge)
  return renderToString(app)
}

describe('NeCard server-rendered without a DOM', () => {
  it('carries the title and formatted stats into the first paint', async () => {
    const html = await render({
      stats: [{ label: 'Stage', unit: 'foot', value: 5 }],
      title: 'Des Plaines at Riverside',
    })

    expect(html).toContain('data-ne-card')
    expect(html).toContain('Des Plaines at Riverside')
    expect(html).toContain('Stage')
    expect(html).toContain('5 ft')
  })

  it('carries a missing stat as the empty placeholder, not 0', async () => {
    const html = await render({
      stats: [{ label: 'Stage', value: null }],
      title: 'Gauge',
    })

    expect(html).toContain('—')
    expect(html).not.toMatch(/>0</)
  })

  it('carries the badge tone in the accessible name', async () => {
    const html = await render({
      badge: { label: 'Action', tone: 'warn' },
      title: 'Gauge',
    })

    expect(html).toContain('aria-label="warn: Action"')
    expect(html).toContain('Action')
  })

  it('carries media alt into the first paint so hydration does not invent it', async () => {
    const html = await render({ media: '/gauge.jpg', mediaAlt: 'The gauge', title: 'Gauge' })

    expect(html).toContain('data-ne-card-media')
    expect(html).toContain('src="/gauge.jpg"')
    expect(html).toContain('alt="The gauge"')
  })

  it('does not touch a DOM global merely by rendering twice', async () => {
    await expect(render({ title: 'One' })).resolves.toContain('One')
    await expect(render({ title: 'Two' })).resolves.toContain('Two')
    expect(typeof document).toBe('undefined')
    expect(typeof window).toBe('undefined')
  })
})
