/*
 * Server-render proof for NeMeter (narduk-libs#601, #602).
 *
 * Pattern: packages/design/narduk-charts/src/ssr.test.ts. This file runs in
 * vitest's `node` environment (this package's default) with no `document`, and
 * renders through `@vue/server-renderer`. A meter is a figure, so its reading —
 * the fill width, the formatted digits, and for a figure with no producer the
 * hatch and the "not reported" name — has to be in the first paint rather than
 * arrive with hydration.
 */
import { renderToString } from '@vue/server-renderer'
import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'

import NeMeter from '../src/runtime/components/NeMeter.vue'

import type { NeMeterProps } from '../src/runtime/components/ne-meter-types'

it('runs in an environment with no DOM, which is the whole point of this file', () => {
  expect(typeof document).toBe('undefined')
  expect(typeof window).toBe('undefined')
})

function render(props: NeMeterProps): Promise<string> {
  return renderToString(createSSRApp({ render: () => h(NeMeter, props) }))
}

describe('NeMeter server rendering', () => {
  it('carries the fill, the figure and the meter semantics into the first paint', async () => {
    const html = await render({ value: 4200, max: 5000, label: 'Core REST' })

    expect(html).toContain('role="meter"')
    expect(html).toContain('aria-label="Core REST"')
    expect(html).toContain('aria-valuenow="4200"')
    expect(html).toContain('aria-valuemax="5000"')
    expect(html).toContain('aria-valuetext="4,200 of 5,000"')
    expect(html).toContain('width:84%')
    expect(html).toContain('4,200')
    expect(html).toContain('5,000')
    expect(html).toContain('data-state="reported"')
  })

  it('carries the unreported treatment into the first paint: hatch, em-dash, no value', async () => {
    const html = await render({ value: null, max: 5000, label: 'Core REST' })

    expect(html).toContain('ne-meter--unreported')
    expect(html).toContain('data-state="unreported"')
    expect(html).toContain('role="img"')
    expect(html).toContain('aria-label="Core REST: not reported"')
    expect(html).toContain('—')
    expect(html).not.toContain('aria-valuenow')
    expect(html).not.toContain('ne-meter__fill')
  })

  it('renders the inline variant', async () => {
    const html = await render({ value: 1, max: 4, variant: 'inline' })
    expect(html).toContain('ne-meter--inline')
    expect(html).toContain('width:25%')
  })
})
