// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import NardukBarChart from './NardukBarChart.vue'

describe('NardukBarChart', () => {
  it('horizontal mode: category text on the left, bars extend +X from shared origin', () => {
    const series = [{ name: 'Revenue', data: [5, 25] }]
    const labels = ['A', 'Long category label']

    const w = mount(NardukBarChart, {
      props: {
        series,
        labels,
        width: 420,
        height: 160,
        orientation: 'horizontal',
        animate: false,
        barRadius: 0,
        categoryLabelMaxWidth: 120,
      },
    })

    expect(w.text()).toContain('Long category label')

    const rects = w.findAll('rect.narduk-bar-rect')
    expect(rects.length).toBe(2)

    const x0 = Number((rects[0]!.element as SVGRectElement).getAttribute('x'))
    const x1 = Number((rects[1]!.element as SVGRectElement).getAttribute('x'))
    expect(x0).toBe(x1)
    expect(x0).toBe(120)

    const bw0 = Number((rects[0]!.element as SVGRectElement).getAttribute('width'))
    const bw1 = Number((rects[1]!.element as SVGRectElement).getAttribute('width'))
    expect(bw0).toBeGreaterThan(0)
    expect(bw1).toBeGreaterThan(bw0)

    const tickTexts = w.findAll('.narduk-axis text').map(t => t.text().trim())
    expect(tickTexts.some(t => !Number.isNaN(Number.parseFloat(t.replace(/,/g, ''))))).toBe(true)
  })

  it('defaults to vertical layout when orientation omitted', () => {
    const w = mount(NardukBarChart, {
      props: {
        series: [{ name: 'A', data: [10] }],
        labels: ['x'],
        width: 200,
        height: 120,
        animate: false,
      },
    })
    const rects = w.findAll('rect.narduk-bar-rect')
    expect(rects.length).toBe(1)
    expect((rects[0]!.element as SVGRectElement).getAttribute('width')).not.toBe('0')
  })
})
