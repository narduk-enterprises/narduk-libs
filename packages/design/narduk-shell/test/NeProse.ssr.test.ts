/*
 * Server-render proof for NeProse (narduk-libs#1005).
 *
 * Pattern: packages/design/narduk-charts/src/ssr.test.ts. This file runs in
 * vitest's `node` environment (this package's default) with no `document`, and
 * renders through `@vue/server-renderer`. A document is content: its headings,
 * their anchor ids and its text have to be in the first paint, and anything in
 * the source that looks like markup has to arrive escaped.
 */
import { renderToString } from '@vue/server-renderer'
import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'

import NeProse from '../src/runtime/components/NeProse.vue'

import type { NeProseProps } from '../src/runtime/components/ne-prose-types'

it('runs in an environment with no DOM, which is the whole point of this file', () => {
  expect(typeof document).toBe('undefined')
  expect(typeof window).toBe('undefined')
})

function render(props: NeProseProps): Promise<string> {
  return renderToString(createSSRApp({ render: () => h(NeProse, props) }))
}

describe('NeProse server rendering', () => {
  it('carries headings with their ids, lists, code and tables into the first paint', async () => {
    const html = await render({
      source:
        '# Title\n\n## Getting started\n\n- one\n  - two\n\n```sh\npnpm i\n```\n\n| a | b |\n| - | -: |\n| 1 | 2 |',
    })

    expect(html).not.toContain('<h1')
    expect(html).toMatch(/<h2[^>]*id="title"/)
    expect(html).toMatch(/<h2[^>]*id="getting-started"/)
    expect(html).toMatch(/<ul[^>]*>.*<li[^>]*>.*<ul[^>]*>.*two/s)
    expect(html).toMatch(
      /<pre[^>]*data-lang="sh"[^>]*><code[^>]*class="language-sh"[^>]*>pnpm i<\/code>/,
    )
    expect(html).toMatch(/<td[^>]*style="text-align:right;?"[^>]*>2<\/td>/)
  })

  it('escapes markup in the source and renders no unsafe href', async () => {
    const html = await render({
      source: '<script>alert(1)</script>\n\n[x](javascript:alert(2)) [y](https://ok.test)',
    })

    expect(html).not.toContain('<script')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).not.toContain('javascript:')
    expect(html).toContain('href="https://ok.test"')
  })
})
