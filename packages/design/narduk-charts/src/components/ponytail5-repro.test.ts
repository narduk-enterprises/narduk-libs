// @vitest-environment happy-dom
// ponytail-5 audit regression tests
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import NardukCandleChart from './NardukCandleChart.vue'
import type { CandleBar } from '../types'

function hourly(count: number, v?: number): CandleBar[] {
  const start = Date.UTC(2026, 4, 14, 20, 0)
  return Array.from({ length: count }, (_, i) => ({
    t: start + i * 3600_000,
    o: 100,
    h: 102,
    l: 98,
    c: 100.5,
    ...(v != null ? { v } : {}),
  }))
}

describe('maps-charts #1: candle length watch must honor a controlled domain', () => {
  it('does not emit the full span over a zoomed domain when a bar is appended', async () => {
    const bars = hourly(72)
    const domain = { start: bars[62]!.t, end: bars[71]!.t }
    const w = mount(NardukCandleChart, {
      props: { bars, width: 640, height: 320, animate: false, zoomable: true, domain },
    })
    await Promise.resolve()
    const next = [...bars, { ...bars[71]!, t: bars[71]!.t + 3600_000 }]
    await w.setProps({ bars: next })
    await Promise.resolve()
    await Promise.resolve()
    const emits = (w.emitted('update:domain') ?? []) as Array<[{ start: number; end: number }]>
    const last = emits[emits.length - 1]![0]
    expect(last.start).toBeGreaterThanOrEqual(domain.start)
  })
})

describe('maps-charts #3: aggregated volume bars must fit the volume pane', () => {
  it('no volume rect is taller than the volume background', () => {
    const w = mount(NardukCandleChart, {
      props: { bars: hourly(1000, 10), width: 800, height: 400, animate: false, showVolume: true },
    })
    const bg = Number(w.find('.narduk-candle-volume__bg').attributes('height'))
    const heights = w.findAll('.narduk-candle-volume__bar').map(r => Number(r.attributes('height')))
    expect(heights.length).toBeGreaterThan(0)
    expect(Math.max(...heights)).toBeLessThanOrEqual(bg + 1e-6)
  })
})
