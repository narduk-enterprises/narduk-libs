// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import NardukCandleChart from './NardukCandleChart.vue'
import type { CandleBar } from '../types'

function hourlyBars(count: number): CandleBar[] {
  const start = Date.UTC(2026, 4, 14, 20, 0)
  return Array.from({ length: count }, (_, i) => {
    const base = 100 + Math.sin(i / 8)
    return {
      t: start + i * 60 * 60 * 1000,
      o: base,
      h: base + 2,
      l: base - 2,
      c: base + 0.5,
    }
  })
}

describe('NardukCandleChart time axis', () => {
  it('keeps the extracted time-axis tick selection readable', () => {
    const w = mount(NardukCandleChart, {
      props: {
        bars: hourlyBars(72),
        width: 640,
        height: 320,
        animate: false,
        formatTime: (t: number) => new Date(t).toISOString().slice(5, 16),
      },
    })

    const tickTexts = w.findAll('.narduk-axis text')
      .map(node => node.text().trim())
      .filter(text => /^\d{2}-\d{2}T/.test(text))
    expect(tickTexts.length).toBeLessThan(72)
    expect(tickTexts[0]).toBe('05-14T20:00')
    expect(tickTexts[tickTexts.length - 1]).toBe('05-17T19:00')
  })
})

describe('NardukCandleChart reachedStart (#8)', () => {
  it('emits reachedStart with the earliest bar time when the default view already spans the full dataset', () => {
    const bars = hourlyBars(72)
    const w = mount(NardukCandleChart, {
      props: { bars, width: 640, height: 320, animate: false },
    })

    const events = w.emitted('reachedStart')
    expect(events).toHaveLength(1)
    expect(events![0][0]).toEqual({ earliestTime: bars[0]!.t })
  })

  it('does not re-emit reachedStart for the same dataset identity when the view returns to the start', async () => {
    const bars = hourlyBars(72)
    const w = mount(NardukCandleChart, {
      props: {
        bars,
        width: 640,
        height: 320,
        animate: false,
        zoomable: true,
        domain: { start: bars[0]!.t, end: bars[71]!.t },
      },
    })
    expect(w.emitted('reachedStart')).toHaveLength(1)

    // Pan away from the start, then back—still the same dataset identity.
    await w.setProps({ domain: { start: bars[30]!.t, end: bars[71]!.t } })
    expect(w.emitted('reachedStart')).toHaveLength(1)

    await w.setProps({ domain: { start: bars[0]!.t, end: bars[10]!.t } })
    expect(w.emitted('reachedStart')).toHaveLength(1)
  })

  it('re-arms and emits again with the new earliest time once earlier bars are prepended', async () => {
    const bars = hourlyBars(72)
    const w = mount(NardukCandleChart, {
      props: { bars, width: 640, height: 320, animate: false },
    })
    expect(w.emitted('reachedStart')).toHaveLength(1)
    expect(w.emitted('reachedStart')![0][0]).toEqual({ earliestTime: bars[0]!.t })

    const earlierBars = hourlyBars(24).map((b, i) => ({
      ...b,
      t: bars[0]!.t - (24 - i) * 60 * 60 * 1000,
    }))
    const nextBars = [...earlierBars, ...bars]
    await w.setProps({ bars: nextBars })

    const events = w.emitted('reachedStart')!
    expect(events).toHaveLength(2)
    expect(events[1][0]).toEqual({ earliestTime: earlierBars[0]!.t })
  })

  it('does not fire again once the view pans away from the earliest bar', async () => {
    const bars = hourlyBars(72)
    const w = mount(NardukCandleChart, {
      props: { bars, width: 640, height: 320, animate: false, zoomable: true },
    })
    // Mount defaults to the full-dataset view, which already includes the start.
    expect(w.emitted('reachedStart')).toHaveLength(1)

    await w.setProps({ domain: { start: bars[40]!.t, end: bars[71]!.t } })
    expect(w.emitted('reachedStart')).toHaveLength(1)
  })
})
