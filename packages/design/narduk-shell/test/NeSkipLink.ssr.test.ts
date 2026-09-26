/*
 * Server-render proof for NeSkipLink (narduk-libs#977).
 *
 * Pattern: packages/design/narduk-charts/src/ssr.test.ts. This file runs in
 * vitest's `node` environment (this package's default) with no `document`, and
 * renders through `@vue/server-renderer` with no router installed at all. A
 * skip link is the first thing a keyboard reader meets, so it has to be in the
 * first paint, and it has to be a plain fragment anchor — never a RouterLink,
 * whose click handler routes instead of moving focus (the bug in #977).
 */
import { renderToString } from '@vue/server-renderer'
import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'

import NeSkipLink from '../src/runtime/components/NeSkipLink.vue'
import { NE_MAIN_ID } from '../src/index'

import type { NeSkipLinkProps } from '../src/runtime/components/ne-skip-link-types'

it('runs in an environment with no DOM, which is the whole point of this file', () => {
  expect(typeof document).toBe('undefined')
  expect(typeof window).toBe('undefined')
})

function render(props: NeSkipLinkProps = {}): Promise<string> {
  return renderToString(createSSRApp({ render: () => h(NeSkipLink, props) }))
}

describe('NeSkipLink server rendering', () => {
  it('renders one plain anchor to #main-content by default', async () => {
    const html = await render()

    expect(NE_MAIN_ID).toBe('main-content')
    expect(html).toMatch(/^<a [^>]*href="#main-content"[^>]*>Skip to content<\/a>$/)
    expect(html).toContain('class="ne-skip-link"')
  })

  it('takes its target and label from props', async () => {
    const html = await render({ target: 'page-body', label: 'Skip to results' })

    expect(html).toContain('href="#page-body"')
    expect(html).toContain('>Skip to results</a>')
  })

  it('is not a router link: no router is needed, and none of its markers appear', async () => {
    const html = await render()

    expect(html).not.toContain('router-link')
    expect(html).not.toContain('aria-current')
    expect(html).not.toContain('data-slot="link"')
  })
})
