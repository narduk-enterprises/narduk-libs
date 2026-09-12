/*
 * Server-render proof, the packages/design/narduk-charts/src/ssr.test.ts
 * pattern: consumers on Nuxt/Nitro (Cloudflare Workers included) render this
 * component for the first time on a server with no `window` and no
 * `document` at all, so this file runs in the `node` environment
 * (vitest.config.ts's default) and renders through `@vue/server-renderer`.
 *
 * The formatted value and delta must appear in this first server-rendered
 * paint. `formatNumber`'s fixed `en-US` locale (item 5, narduk-libs#261) is
 * what makes that safe: the server and the browser format the same digits,
 * so there is nothing for hydration to silently overwrite.
 */
import { renderToString } from '@vue/server-renderer'
import { describe, expect, it } from 'vitest'
import { createSSRApp, defineComponent, h } from 'vue'

import NeKpiTile from '../src/runtime/components/NeKpiTile.vue'

import type { NeNumberOptions } from '../src/format'

/** Same fake as test/NeKpiTile.mount.test.ts -- see its header comment. */
const FakeUCard = defineComponent({
  name: 'UCard',
  setup(_props, { attrs, slots }) {
    return () => h('div', { ...attrs }, slots.default?.())
  },
})

function renderTile(props: {
  label: string
  value: number | string | null | undefined
  valueOptions?: NeNumberOptions
  delta?: number | string | null
  detail?: string
}): Promise<string> {
  const app = createSSRApp(NeKpiTile, props)
  app.component('UCard', FakeUCard)
  return renderToString(app)
}

it('runs in an environment with no DOM, which is the whole point of this file', () => {
  expect(typeof document).toBe('undefined')
  expect(typeof window).toBe('undefined')
})

describe('NeKpiTile server rendering', () => {
  it('carries the formatted numeric value into the server output', async () => {
    const html = await renderTile({ label: 'Runners online', value: 12345 })
    expect(html).toContain('Runners online')
    expect(html).toContain('12,345')
  })

  it('carries the empty-value placeholder into the server output', async () => {
    const html = await renderTile({ label: 'Runners online', value: null })
    expect(html).toContain('—')
  })

  it('carries a pre-formatted string value into the server output unchanged', async () => {
    const html = await renderTile({ label: 'Spend', value: '$1,234.00' })
    expect(html).toContain('$1,234.00')
  })

  it('carries the signed, glyphed delta into the server output', async () => {
    const html = await renderTile({ label: 'Runners online', value: 128, delta: 6 })
    expect(html).toContain('▲')
    expect(html).toContain('+6')
  })

  it('carries the detail caption into the server output', async () => {
    const html = await renderTile({
      label: 'Runners online',
      value: 128,
      delta: 6,
      detail: 'vs yesterday',
    })
    expect(html).toContain('vs yesterday')
  })

  it('renders without throwing when the #spark slot is used', async () => {
    const app = createSSRApp({
      components: { NeKpiTile },
      template:
        '<NeKpiTile label="Runners online" :value="128"><template #spark>chart</template></NeKpiTile>',
    })
    app.component('UCard', FakeUCard)
    const html = await renderToString(app)
    expect(html).toContain('chart')
  })
})
