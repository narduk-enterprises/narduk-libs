/*
 * Server-render proof for NePriceCell: the figure, its reserved width and its
 * (empty) tone are in the first paint with no DOM and no timer, so a flashing
 * price hydrates to exactly what the server sent.
 */
import { renderToString } from '@vue/server-renderer'
import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'

import NePriceCell from '../src/runtime/components/NePriceCell.vue'

import type { NePriceCellProps } from '../src/runtime/components/ne-price-cell-types'

it('runs in an environment with no DOM, which is the whole point of this file', () => {
  expect(typeof document).toBe('undefined')
})

function render(props: NePriceCellProps): Promise<string> {
  return renderToString(createSSRApp({ render: () => h(NePriceCell, props) }))
}

describe('NePriceCell server rendering', () => {
  it('renders the formatted figure with its reserved width', async () => {
    const html = await render({
      value: 1234.5,
      kind: 'money',
      currency: 'USD',
      digits: 2,
      chars: 10,
    })
    expect(html).toContain('$1,234.50')
    expect(html).toContain('--ne-price-cell-chars:10')
    expect(html).toContain('class="ne-price-cell"')
  })

  it('renders the sign tone, and none for a flash (a flash starts after hydration)', async () => {
    expect(await render({ value: -2, tint: 'sign' })).toContain('data-tone="down"')
    expect(await render({ value: 2, tint: 'flash' })).not.toContain('data-tone')
  })

  it('renders the unreported mark for a missing figure', async () => {
    const html = await render({ value: null, label: 'Last price' })
    expect(html).toContain('data-state="unreported"')
    expect(html).toContain('aria-label="Last price: not reported"')
  })

  it('renders the same string twice', async () => {
    const props = { value: 12.34, kind: 'money', currency: 'USD', digits: 2 } as const
    expect(await render(props)).toBe(await render(props))
  })
})
