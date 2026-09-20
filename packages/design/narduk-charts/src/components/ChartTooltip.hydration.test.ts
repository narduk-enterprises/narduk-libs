// @vitest-environment happy-dom
import { renderToString } from '@vue/server-renderer'
import { createSSRApp, h } from 'vue'
import { describe, expect, it, vi } from 'vitest'

import ChartTooltip from './ChartTooltip.vue'

import type { Component } from 'vue'

/**
 * Server-render a component, then hydrate that exact markup and report every
 * warning Vue raised while doing it.
 *
 * A hydration mismatch is only ever visible as a development warning — Vue
 * recovers by discarding the server subtree and re-rendering on the client —
 * so the warning *is* the assertion. `console.error` is where `[Vue warn]`
 * lands under a non-production build.
 */
async function hydrationWarnings(component: Component, props: Record<string, unknown>) {
  const html = await renderToString(createSSRApp(() => h(component, props)))
  const root = document.createElement('div')
  root.innerHTML = html
  document.body.append(root)

  const warnings: string[] = []
  const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    warnings.push(args.map(String).join(' '))
  })
  try {
    createSSRApp(() => h(component, props)).mount(root, true)
  } finally {
    spy.mockRestore()
    root.remove()
  }
  return { html, warnings }
}

const IDLE = { chartWidth: 600, items: [], title: '', visible: false, x: 0, y: 0 }

describe('ChartTooltip hydration', () => {
  it('hydrates its idle state without a mismatch', async () => {
    // The state every chart renders on the server: no hover has happened, so
    // there is no title and no items. riverstatus#204 caught this on
    // `/gauges/usgs/09380000` — "rendered on server: JSHandle@node, expected
    // on client: Symbol(v-cmt)" at `<ChartTooltip visible=false x=0>`, one of
    // 91 warnings on a single page.
    const { warnings } = await hydrationWarnings(ChartTooltip, IDLE)
    expect(warnings.filter(line => line.includes('Hydration'))).toEqual([])
  })

  it('hydrates a populated tooltip without a mismatch', async () => {
    const { warnings } = await hydrationWarnings(ChartTooltip, {
      ...IDLE,
      items: [{ color: '#123456', label: 'Stage', value: '4.2 ft' }],
      title: '09-09 11:48',
      visible: true,
    })
    expect(warnings.filter(line => line.includes('Hydration'))).toEqual([])
  })
})
