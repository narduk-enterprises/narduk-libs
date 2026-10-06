// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'

import NardukLineChart from './NardukLineChart.vue'
import {
  hydrationMismatchLines,
  hydrationWarnings,
  knownTextMismatchWarnings,
  unexpectedDevelopmentWarnings,
} from './hydration-warnings'

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
    expect(hydrationMismatchLines(warnings)).toEqual([])
  })

  it('raises no development warning at all', async () => {
    // `withDirectives can only be used inside render functions.` is the other
    // half of riverstatus#204 and is not a hydration warning, so it needs its
    // own assertion rather than a /hydrat/i filter. The helper spies
    // `console.warn` and `console.error`; an error-only spy would miss
    // withDirectives and this test would be vacuous. The known text-mismatch
    // control proves the same capture sees a `[Vue warn]` on `console.warn`.
    // (Vue 3.5.39 also warned `Failed setting prop` on SVG geometry, which
    // used to serve as that proof; 3.5.42 no longer raises it.)
    const control = await knownTextMismatchWarnings()
    expect(control.some(line => line.includes('[Vue warn]'))).toBe(true)
    const { warnings } = await hydrationWarnings(NardukLineChart, GAUGE_CHART)
    expect(warnings.some(line => line.includes('withDirectives'))).toBe(false)
    expect(unexpectedDevelopmentWarnings(warnings)).toEqual([])
  })
})
