/*
 * Server-render proof, the packages/design/narduk-charts/src/ssr.test.ts
 * pattern: consumers on Nuxt/Nitro (Cloudflare Workers included) render this
 * component for the first time on a server with no `window` and no
 * `document` at all, so this file runs in the `node` environment
 * (vitest.config.ts's default) and renders through `@vue/server-renderer`.
 */
import { renderToString } from '@vue/server-renderer'
import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'

import NeKpiBand from '../src/runtime/components/NeKpiBand.vue'

import type { NeKpiBandProps } from '../src/runtime/components/NeKpiBand.vue'

function renderBand(props: NeKpiBandProps = {}): Promise<string> {
  const app = createSSRApp({
    render: () =>
      h(NeKpiBand, props, {
        default: () => [h('span', 'tile one'), h('span', 'tile two')],
      }),
  })
  return renderToString(app)
}

it('runs in an environment with no DOM, which is the whole point of this file', () => {
  expect(typeof document).toBe('undefined')
  expect(typeof window).toBe('undefined')
})

describe('NeKpiBand server rendering', () => {
  it('carries the default single-column grid class into the server output', async () => {
    const html = await renderBand()
    expect(html).toContain('grid-cols-1')
  })

  it('carries every requested breakpoint class into the server output', async () => {
    const html = await renderBand({ columns: { base: 1, sm: 2, lg: 4 } })
    expect(html).toContain('grid-cols-1')
    expect(html).toContain('sm:grid-cols-2')
    expect(html).toContain('lg:grid-cols-4')
  })

  it('carries the slotted tile content into the server output', async () => {
    const html = await renderBand()
    expect(html).toContain('tile one')
    expect(html).toContain('tile two')
  })
})
