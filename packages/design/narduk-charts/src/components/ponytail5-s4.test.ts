// @vitest-environment happy-dom
// ponytail-5 s4 audit regression tests
import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import NardukLineChart from './NardukLineChart.vue'
import NardukScatterChart from './NardukScatterChart.vue'

describe('maps-charts #6: line click reports the original index under decimation', () => {
  it('pointClick index matches the source label', async () => {
    const labels = Array.from({ length: 100 }, (_, i) => `L${i}`)
    const w = mount(NardukLineChart, {
      props: {
        labels,
        series: [{ name: 'a', data: labels.map((_, i) => i) }],
        maxRenderPoints: 10,
        width: 400,
        height: 200,
        animate: false,
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
      },
    })
    const svg = w.get('svg')
    vi.spyOn(svg.element, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 20, 200, 100))
    await svg.trigger('click', { clientX: 209, clientY: 50 })
    const ev = (w.emitted('pointClick') ?? []) as Array<[{ index: number; label: string }]>
    expect(ev.length).toBe(1)
    expect(ev[0]![0].index).toBe(99)
    expect(`L${ev[0]![0].index}`).toBe(ev[0]![0].label)
  })
})

describe('maps-charts #7: log scale gaps non-positive values', () => {
  it('draws a single line segment of one point, not a floor-pinned run', async () => {
    const w = mount(NardukLineChart, {
      props: {
        labels: ['a', 'b', 'c'],
        series: [{ name: 's', data: [-5, 0, 10] }],
        yScale: 'log',
        width: 600,
        height: 300,
        animate: false,
      },
    })
    await w.vm.$nextTick()
    // -5 and 0 are gaps, so only one value remains: nothing to connect.
    expect(
      w
        .findAll('path.narduk-line-path')
        .map(p => p.attributes('d'))
        .filter(Boolean),
    ).toEqual([])
  })
})

describe('maps-charts #16: scatter keyboard', () => {
  it('exposes one tab stop, not one per point', async () => {
    const w = mount(NardukScatterChart, {
      props: {
        series: [{ name: 's', points: Array.from({ length: 40 }, (_, i) => ({ x: i, y: i })) }],
        width: 600,
        height: 300,
        animate: false,
      },
    })
    await w.vm.$nextTick()
    const stops = w
      .findAll('circle.narduk-scatter-point')
      .filter(c => c.attributes('tabindex') === '0')
    expect(stops.length).toBe(1)
  })
})
