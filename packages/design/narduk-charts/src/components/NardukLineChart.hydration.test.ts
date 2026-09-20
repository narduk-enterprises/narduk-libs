// @vitest-environment happy-dom
import { renderToString } from '@vue/server-renderer'
import { createSSRApp, h } from 'vue'
import { describe, expect, it, vi } from 'vitest'

import NardukLineChart from './NardukLineChart.vue'

import type { Component } from 'vue'

/** See ChartTooltip.hydration.test.ts — the warning is the assertion. */
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

/** The shape riverstatus draws on `/gauges/usgs/09380000` (riverstatus#204). */
const GAUGE_CHART = {
  animate: false,
  height: 280,
  labels: ['09-09 11:48', '', '', '09-20 06:00'],
  series: [
    { color: '#2f6f9f', data: [3.1, 3.4, 3.2, 3.6], name: 'Observed' },
    { color: '#a45fd6', data: [null, null, null, 1100], name: 'Forecast' },
  ],
}

describe('NardukLineChart hydration', () => {
  it('hydrates the gauge-detail chart without a mismatch', async () => {
    const { warnings } = await hydrationWarnings(NardukLineChart, GAUGE_CHART)
    expect(warnings.filter(line => line.includes('Hydration'))).toEqual([])
  })

  it('raises no development warning at all', async () => {
    // `withDirectives can only be used inside render functions.` is the other
    // half of riverstatus#204 and is not a hydration warning, so it needs its
    // own assertion rather than a filter.
    const { warnings } = await hydrationWarnings(NardukLineChart, GAUGE_CHART)
    expect(warnings).toEqual([])
  })
})
