/*
 * Server-render proof for NeFilterBar (narduk-libs#261).
 *
 * Pattern: packages/design/narduk-charts/src/ssr.test.ts. The row holds
 * template refs to its controls for the tablist's roving focus, which is a DOM
 * reach that must not run on the server. This file runs in vitest's `node`
 * environment (this package's default) and renders through
 * `@vue/server-renderer`, so a setup-time `document` reach throws here instead
 * of only in a Workers first paint.
 *
 * The real `UButton` is rendered, not a stub. A stub emitting its own
 * `<button>` would pass while the shipped row threw.
 *
 * What the assertions are actually for: a filter row is chrome that arrives
 * with the document, and the ARIA that makes it usable has to be in the FIRST
 * paint. A row that only becomes a tablist after hydration is, for the window
 * before hydration, an unlabelled pile of buttons.
 */
import { renderToString } from '@vue/server-renderer'
import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'

import NeFilterBar from '../src/runtime/components/NeFilterBar.vue'

import type { NeFilterBarProps } from '../src/runtime/components/ne-filter-bar-types'

it('runs in an environment with no DOM, which is the whole point of this file', () => {
  expect(typeof document).toBe('undefined')
  expect(typeof window).toBe('undefined')
})

function render(props: NeFilterBarProps): Promise<string> {
  return renderToString(createSSRApp({ render: () => h(NeFilterBar, props) }))
}

const ITEMS = [
  { key: 'all', label: 'All', count: 12 },
  { key: 'open', label: 'Open' },
]

describe('NeFilterBar server-rendered without a DOM', () => {
  it('carries the row, its name and its controls into the first paint', async () => {
    const html = await render({ items: ITEMS, label: 'State' })

    expect(html).toContain('data-ne-filter-bar')
    expect(html).toContain('aria-label="State"')
    expect(html).toContain('role="group"')
    expect(html).toContain('<button')
    expect(html).toContain('All')
    expect(html).toContain('Open')
  })

  it('carries the selection as aria-pressed, not only as a colour', async () => {
    const html = await render({ items: ITEMS, label: 'State', modelValue: 'all' })

    expect(html).toContain('aria-pressed="true"')
    expect(html).toContain('aria-pressed="false"')
  })

  it('renders a count only where the caller gave one', async () => {
    const html = await render({ items: ITEMS, label: 'State' })

    expect(html).toContain('data-ne-filter-count')
    // One count element for two controls: an absent count renders nothing at
    // all rather than a zero nobody measured.
    expect(html.match(/data-ne-filter-count/g)).toHaveLength(1)
  })

  it('is a tablist in the first paint, with its panel wiring already present', async () => {
    const html = await render({
      idPrefix: 'work',
      items: ITEMS,
      kind: 'tabs',
      label: 'View',
      modelValue: 'open',
    })

    expect(html).toContain('role="tablist"')
    expect(html).toContain('role="tab"')
    expect(html).toContain('id="work-tab-open"')
    expect(html).toContain('aria-controls="work-panel-open"')
    expect(html).toContain('aria-selected="true"')
    // One tab in the tab order before any JavaScript runs.
    expect(html.match(/tabindex="0"/g)).toHaveLength(1)
  })

  it('server-renders a filter with no producer as present and disabled', async () => {
    const html = await render({
      items: [
        { key: 'all', label: 'All' },
        { key: 'soon', label: 'By owner', disabled: true, title: 'Lands with the owner ledger' },
      ],
      label: 'State',
      note: 'By owner lands with the owner ledger',
    })

    // The point of the disabled treatment is that it is VISIBLE, so it has to
    // survive to the first paint rather than appearing on hydration.
    expect(html).toContain('By owner')
    expect(html).toContain('aria-disabled="true"')
    expect(html).toContain('data-ne-filter-note')
    expect(html).toContain('Lands with the owner ledger')
  })

  it('does not touch a DOM global merely by rendering twice', async () => {
    await expect(render({ items: ITEMS, label: 'State' })).resolves.toContain('data-ne-filter-bar')
    await expect(render({ items: ITEMS, kind: 'tabs', label: 'State' })).resolves.toContain(
      'role="tablist"',
    )
    expect(typeof document).toBe('undefined')
    expect(typeof window).toBe('undefined')
  })
})
