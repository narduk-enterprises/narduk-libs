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
