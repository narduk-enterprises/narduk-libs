/*
 * Server-render proof, the packages/design/narduk-charts/src/ssr.test.ts
 * pattern: consumers on Nuxt/Nitro (Cloudflare Workers included) render this
 * component for the first time on a server with no `window` and no
 * `document` at all, so this file runs in the `node` environment
 * (vitest.config.ts's default) and renders through `@vue/server-renderer`.
 */
import { renderToString } from '@vue/server-renderer'
import { describe, expect, it } from 'vitest'
import { createSSRApp, defineComponent, h } from 'vue'

import NeStatusBadge from '../src/runtime/components/NeStatusBadge.vue'

import type { NeStatusTone } from '../src/runtime/utils/status-map'

/** Same fake as test/NeStatusBadge.mount.test.ts -- see its header comment. */
const FakeUBadge = defineComponent({
  name: 'UBadge',
  props: ['color', 'variant', 'size', 'icon'],
  setup(props, { attrs, slots }) {
    return () => h('span', { ...attrs, 'data-color': props.color }, slots.default?.())
  },
})

function renderBadge(props: { tone: NeStatusTone; label: string }): Promise<string> {
  const app = createSSRApp(NeStatusBadge, props)
  app.component('UBadge', FakeUBadge)
  return renderToString(app)
}

it('runs in an environment with no DOM, which is the whole point of this file', () => {
  expect(typeof document).toBe('undefined')
  expect(typeof window).toBe('undefined')
})

describe('NeStatusBadge server rendering', () => {
  const tones: NeStatusTone[] = ['ok', 'warn', 'error', 'info', 'neutral', 'pending']

  for (const tone of tones) {
    it(`renders tone "${tone}" without throwing and carries the label`, async () => {
      const html = await renderBadge({ tone, label: `${tone} label` })
      expect(html).toContain(`${tone} label`)
      expect(html).toContain('data-color')
    })
  }

  it('carries the status role and aria-label into the server output, not only after hydration', async () => {
    const html = await renderBadge({ tone: 'error', label: 'Offline' })
    expect(html).toContain('role="status"')
    expect(html).toContain('aria-label="error: Offline"')
  })

  it('carries the word-safe label class into the server output', async () => {
    const html = await renderBadge({ tone: 'neutral', label: 'unknown' })
    expect(html).toContain('whitespace-nowrap')
  })
})
