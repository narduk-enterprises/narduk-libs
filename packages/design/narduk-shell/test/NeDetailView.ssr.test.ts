/*
 * Server-render proof for NeDetailView (narduk-libs#264).
 *
 * Pattern: packages/design/narduk-charts/src/ssr.test.ts. A trust panel is
 * in the first paint, so the formatted quantity and the unavailable
 * sentence have to be in the server output. This file runs in vitest's
 * `node` environment and renders through `@vue/server-renderer`.
 */
import { renderToString } from '@vue/server-renderer'
import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'

import NeDetailView from '../src/runtime/components/NeDetailView.vue'

import type { NeDetailViewProps } from '../src/runtime/components/ne-detail-view-types'

it('runs in an environment with no DOM, which is the whole point of this file', () => {
  expect(typeof document).toBe('undefined')
  expect(typeof window).toBe('undefined')
})

function render(props: NeDetailViewProps): Promise<string> {
  return renderToString(createSSRApp({ render: () => h(NeDetailView, props) }))
}

describe('NeDetailView server-rendered without a DOM', () => {
  it('carries a formatted quantity into the first paint', async () => {
    const html = await render({
      items: [{ format: 'quantity', label: 'Stage', unit: 'foot', value: 5 }],
    })

    expect(html).toContain('data-ne-detail-view')
    expect(html).toContain('Stage')
    expect(html).toContain('5 ft')
  })

  it('carries the unavailable message into the first paint, not 0', async () => {
    const html = await render({
      items: [{ format: 'quantity', label: 'Stage', unit: 'foot', value: null }],
      unavailableMessage: 'No reading',
    })

    expect(html).toContain('data-ne-detail-unavailable')
    expect(html).toContain('No reading')
    expect(html).not.toMatch(/>0</)
  })

  it('carries a zoned date into the first paint', async () => {
    const html = await render({
      items: [{ format: 'date', label: 'Observed', value: '2026-03-08T08:30:00Z' }],
      timeZone: 'America/Chicago',
    })

    expect(html).toContain('Mar 8, 2026')
  })

  it('does not touch a DOM global merely by rendering twice', async () => {
    await expect(render({ items: [{ label: 'A', value: 1 }] })).resolves.toContain('A')
    await expect(render({ items: [{ label: 'B', value: 2 }] })).resolves.toContain('B')
    expect(typeof document).toBe('undefined')
    expect(typeof window).toBe('undefined')
  })
})
