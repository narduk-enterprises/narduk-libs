/*
 * Server-render proof for NeMessageProse.
 *
 * Runs in vitest's `node` environment with no `document`, through
 * `@vue/server-renderer`. A message is content: its formatting has to be in the
 * first paint, source markup has to arrive escaped, and a clamped message has
 * to arrive clamped (no button until it is measured to overflow).
 */
import { renderToString } from '@vue/server-renderer'
import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'

import NeMessageProse from '../src/runtime/components/NeMessageProse.vue'

import type { NeMessageProseProps } from '../src/runtime/components/ne-message-prose-types'

it('runs in an environment with no DOM, which is the whole point of this file', () => {
  expect(typeof document).toBe('undefined')
  expect(typeof window).toBe('undefined')
})

function render(props: NeMessageProseProps): Promise<string> {
  return renderToString(createSSRApp({ render: () => h(NeMessageProse, props) }))
}

describe('NeMessageProse server rendering', () => {
  it('carries a restored list, bold and code into the first paint', async () => {
    const html = await render({
      text: 'Still open: - **Release:** the PR. - **Portal:** `ne-prose` next.',
    })
    expect(html).toMatch(/<ul[^>]*>.*<li[^>]*>.*<strong[^>]*>Release:<\/strong>/s)
    expect(html).toContain('<code>ne-prose</code>')
    expect(html).not.toContain('**')
  })

  it('opens an https link in a new tab and renders no other link', async () => {
    const html = await render({
      text: '[a](https://ok.test) [b](http://no.test) [c](javascript:alert(1)) [d](#e) <script>alert(1)</script>',
    })
    expect(html).toMatch(
      /<a[^>]*href="https:\/\/ok.test"[^>]*target="_blank"[^>]*rel="noopener noreferrer"/,
    )
    expect(html.match(/<a /g)).toHaveLength(1)
    expect(html).not.toContain('javascript:')
    expect(html).not.toContain('<script')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
  })

  it('clamps to the line count in the first paint, with no button yet', async () => {
    const html = await render({ text: 'one\n\ntwo\n\nthree', clamp: 2 })
    expect(html).toContain('max-height:2lh')
    expect(html).not.toContain('Show more')
  })

  it('renders inline mode as one span with a plain title', async () => {
    const html = await render({ text: '# **Rotate** `KEY`\n- now', mode: 'inline' })
    expect(html).toMatch(/^<span[^>]*class="ne-message-prose ne-message-prose--inline"/)
    expect(html).toContain('title="# Rotate KEY - now"')
    expect(html).not.toMatch(/<(p|ul|li|h\d|div)[ >]/)
  })

  it('renders nothing but the empty root for no text', async () => {
    expect(await render({ text: null })).not.toMatch(/<p[ >]/)
  })
})
