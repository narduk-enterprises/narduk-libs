// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'

import ChartTooltip from './ChartTooltip.vue'
import { hydrationMismatchLines, hydrationWarnings } from './hydration-warnings'

const IDLE = { chartWidth: 600, items: [], title: '', visible: false, x: 0, y: 0 }

describe('ChartTooltip hydration', () => {
  it('hydrates its idle state without a mismatch', async () => {
    // The state every chart renders on the server: no hover has happened, so
    // there is no title and no items. riverstatus#204 caught this on
    // `/gauges/usgs/09380000` — "rendered on server: JSHandle@node, expected
    // on client: Symbol(v-cmt)" at `<ChartTooltip visible=false x=0>`, one of
    // 91 warnings on a single page.
    const { warnings } = await hydrationWarnings(ChartTooltip, IDLE)
    expect(hydrationMismatchLines(warnings)).toEqual([])
    expect(warnings).toEqual([])
  })

  it('hydrates a populated tooltip without a mismatch', async () => {
    const { warnings } = await hydrationWarnings(ChartTooltip, {
      ...IDLE,
      items: [{ color: '#123456', label: 'Stage', value: '4.2 ft' }],
      title: '09-09 11:48',
      visible: true,
    })
    expect(hydrationMismatchLines(warnings)).toEqual([])
    expect(warnings).toEqual([])
  })
})
