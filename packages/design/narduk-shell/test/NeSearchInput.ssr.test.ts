/*
 * Server-render proof for NeSearchInput (narduk-libs#261).
 *
 * Pattern: packages/design/narduk-charts/src/ssr.test.ts. A search field is
 * chrome that arrives with the document, so the accessible name and any
 * applied term have to be in the first paint. This file runs in vitest's
 * `node` environment (this package's default) and renders through
 * `@vue/server-renderer`, so a setup-time `document` reach throws here
 * instead of only in a Workers first paint.
 *
 * The real `UInput` is rendered, not a stub. A stub emitting its own
 * `<input>` would pass while the shipped field threw.
 */
import { renderToString } from '@vue/server-renderer'
import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'

import NeSearchInput from '../src/runtime/components/NeSearchInput.vue'

import type { NeSearchInputProps } from '../src/runtime/components/ne-search-input-types'

it('runs in an environment with no DOM, which is the whole point of this file', () => {
  expect(typeof document).toBe('undefined')
  expect(typeof window).toBe('undefined')
})

function render(props: NeSearchInputProps): Promise<string> {
  return renderToString(createSSRApp({ render: () => h(NeSearchInput, props) }))
}

describe('NeSearchInput server-rendered without a DOM', () => {
  it('carries the field, its name and its type into the first paint', async () => {
    const html = await render({
      label: 'Search runners',
      placeholder: 'Search runners',
    })

    expect(html).toContain('data-ne-search-input')
    expect(html).toContain('data-ne-search-field')
    expect(html).toContain('aria-label="Search runners"')
    expect(html).toContain('type="search"')
    expect(html).toContain('Search runners')
  })

  it('carries an applied term into the first paint, so hydration does not invent it', async () => {
    const html = await render({ label: 'Search runners', modelValue: 'gtm' })

    expect(html).toContain('gtm')
    expect(html).toContain('data-ne-search-clear')
    expect(html).toContain('Clear search')
  })

  it('carries the applied-term summary when the caller asked for one', async () => {
    const html = await render({
      label: 'Search runners',
      modelValue: 'gtm',
      showSummary: true,
    })

    expect(html).toContain('data-ne-search-summary')
    expect(html).toContain('Searching for “gtm”')
    expect(html).toContain('aria-live="polite"')
  })

  it('does not paint a summary or a clear control when nothing is applied', async () => {
    const html = await render({ label: 'Search runners', showSummary: true })

    expect(html).not.toContain('data-ne-search-summary')
    expect(html).not.toContain('data-ne-search-clear')
  })

  it('marks a pending search busy in the first paint', async () => {
    const html = await render({ label: 'Search runners', pending: true })

    expect(html).toContain('aria-busy="true"')
  })

  it('does not touch a DOM global merely by rendering twice', async () => {
    await expect(render({ label: 'Search runners' })).resolves.toContain('data-ne-search-input')
    await expect(render({ label: 'Search runners', modelValue: 'gtm' })).resolves.toContain('gtm')
    expect(typeof document).toBe('undefined')
    expect(typeof window).toBe('undefined')
  })
})
