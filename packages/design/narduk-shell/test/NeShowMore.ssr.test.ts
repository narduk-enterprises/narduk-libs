/*
 * Server-render proof for NeShowMore: the label, with its formatted count, is
 * in the first paint. Runs in vitest's `node` environment: no DOM.
 */
import { renderToString } from '@vue/server-renderer'
import { describe, expect, it } from 'vitest'
import { h } from 'vue'

import { createSSRAppWithEnv as createSSRApp } from './support/ssr-app'
import NeShowMore from '../src/runtime/components/NeShowMore.vue'

import type { NeShowMoreProps } from '../src/runtime/components/ne-show-more-types'

it('runs in an environment with no DOM, which is the whole point of this file', () => {
  expect(typeof document).toBe('undefined')
  expect(typeof window).toBe('undefined')
})

function render(props: NeShowMoreProps): Promise<string> {
  return renderToString(createSSRApp({ render: () => h(NeShowMore, props) }))
}

describe('NeShowMore server rendering', () => {
  it('renders the button and its formatted label', async () => {
    const html = await render({ total: 1200, noun: 'runners', controls: 'agenda' })

    expect(html).toContain('<button')
    expect(html).toContain('Show all 1,200 runners')
    expect(html).toContain('aria-controls="agenda"')
    expect(html).toContain('data-ne-show-more')
  })

  it('renders nothing when nothing is hidden', async () => {
    expect(await render({ total: 3, hidden: 0 })).not.toContain('<button')
  })
})
