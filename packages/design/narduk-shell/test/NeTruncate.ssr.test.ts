/*
 * Server-render proof for NeTruncate (narduk-libs#1855): the split is computed,
 * not measured, so the first paint already has the head, the whole tail and the
 * full value as text and tooltip. Runs in vitest's `node` environment: no DOM.
 */
import { renderToString } from '@vue/server-renderer'
import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'

import NeTruncate from '../src/runtime/components/NeTruncate.vue'

type Props = InstanceType<typeof NeTruncate>['$props']

const URL =
  'https://cdn.example.com/assets/brand/social/og-image-1200x630-2026-10-14-final-v3.png?v=8f3a1c2d'

function render(props: Props): Promise<string> {
  return renderToString(createSSRApp({ render: () => h(NeTruncate, props) }))
}

/** The text of the head and tail spans, joined; the markup between them carries none. */
const textOf = (html: string) =>
  [...html.matchAll(/<span class="ne-truncate__(?:head|tail)"[^>]*>([^<]*)<\/span>/g)]
    .map((match) => match[1])
    .join('')

describe('NeTruncate server rendering', () => {
  it('has no DOM in this file', () => {
    expect(typeof document).toBe('undefined')
  })

  it('renders a head span and a tail span whose text joins back to the full value', async () => {
    const html = await render({ text: URL, kind: 'url' })

    expect(html).toContain('class="ne-truncate__head"')
    expect(html).toContain('class="ne-truncate__tail"')
    expect(textOf(html)).toBe(URL)
    expect(html).toContain('tabindex="0"')
    expect(html).toContain('aria-expanded="false"')
  })

  it('writes the full value as the tooltip', async () => {
    expect(await render({ text: URL })).toContain(`title="${URL}"`)
  })

  it('renders no tail span for short text or for mode="end"', async () => {
    expect(await render({ text: 'short.png' })).not.toContain('ne-truncate__tail')
    const end = await render({ text: URL, mode: 'end' })
    expect(end).not.toContain('ne-truncate__tail')
    expect(textOf(end)).toBe(URL)
  })

  it('renders the same string twice', async () => {
    expect(await render({ text: URL, kind: 'url' })).toBe(await render({ text: URL, kind: 'url' }))
  })
})
