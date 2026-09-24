// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'

import NardukLineChart from './NardukLineChart.vue'
import {
  hydrationMismatchLines,
  hydrationWarnings,
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
    // `console.warn` and `console.error`. Vue 3.5 hydrateElement force-patches
    // SVG geometry as DOM props; those are getter-only, so a live warn spy
    // sees `Failed setting prop`. An error-only spy would miss both that and
    // withDirectives, and this test would be vacuous again.
    const { warnings } = await hydrationWarnings(NardukLineChart, GAUGE_CHART)
    expect(
      warnings.some(line => line.includes('[Vue warn]') && line.includes('Failed setting prop')),
    ).toBe(true)
    expect(warnings.some(line => line.includes('withDirectives'))).toBe(false)
    expect(unexpectedDevelopmentWarnings(warnings)).toEqual([])
  })
})
