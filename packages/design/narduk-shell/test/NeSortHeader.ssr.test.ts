/*
 * Server-render proof for NeSortHeader (narduk-libs#528).
 *
 * Pattern: packages/design/narduk-charts/src/ssr.test.ts. The header writes
 * `aria-sort` onto its closest `<th>` after mount — a DOM walk that must not
 * run on the server. This file therefore runs in vitest's `node` environment
 * (this package's default) and renders through `@vue/server-renderer`, so a
 * setup-time `document` / `closest` reach throws here instead of only in a
 * Workers first paint.
 *
 * The real `UButton` is rendered, not a stub. A stub emitting its own
 * `<button>` would pass while the shipped header threw.
 */
import { renderToString } from '@vue/server-renderer'
import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import type { Component } from 'vue'

import NeSortHeader from '../src/runtime/components/NeSortHeader.vue'

it('runs in an environment with no DOM, which is the whole point of this file', () => {
  expect(typeof document).toBe('undefined')
  expect(typeof window).toBe('undefined')
})

function render(props: Record<string, unknown>): Promise<string> {
  return renderToString(
    createSSRApp({
      render: () =>
        h('table', [h('thead', [h('tr', [h('th', [h(NeSortHeader as Component, props)])])])]),
    }),
  )
}

describe('NeSortHeader server-rendered without a DOM', () => {
  it('carries the label, unit and sort header into the first paint', async () => {
    const html = await render({
      firstDirection: 'desc',
      label: 'Wind',
      sortKey: 'wind',
      unit: 'kt',
    })

    expect(html).toContain('data-ne-sort-header')
    expect(html).toContain('Wind')
    expect(html).toContain('data-ne-unit')
    expect(html).toContain('kt')
    expect(html).toContain('<button')
  })

  it('marks the sorted direction in the server output without writing aria-sort', async () => {
    const html = await render({
      label: 'Wind',
      sort: 'wind:desc',
      sortKey: 'wind',
    })

    expect(html).toContain('data-ne-sort-direction="desc"')
    // `aria-sort` belongs on the `<th>` and is written after mount. The
    // server must not throw looking for that cell, and must not emit a
    // stale attribute it cannot keep in sync.
    expect(html).not.toContain('aria-sort')
  })

  it('renders a rest header with no direction attribute', async () => {
    const html = await render({ label: 'Station', sortKey: 'name' })

    expect(html).toContain('data-ne-sort-header')
    expect(html).not.toContain('data-ne-sort-direction')
  })

  it('does not touch a DOM global merely by rendering twice', async () => {
    await expect(render({ label: 'Wind', sortKey: 'wind' })).resolves.toContain(
      'data-ne-sort-header',
    )
    await expect(render({ label: 'Wind', sort: 'wind:asc', sortKey: 'wind' })).resolves.toContain(
      'data-ne-sort-direction="asc"',
    )
    expect(typeof document).toBe('undefined')
    expect(typeof window).toBe('undefined')
  })
})
