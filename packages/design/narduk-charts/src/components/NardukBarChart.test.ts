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

describe('NardukBarChart thin "% of normal" bar (narduk-charts#37)', () => {
  const props = {
    series: [{ name: 'Rain', data: [87], color: 'var(--farm-accent)' }],
    labels: ['Rain'],
    orientation: 'horizontal' as const,
    width: 300,
    height: 14,
    animate: false,
    barRadius: 0,
    yMin: 0,
    yMax: 150,
    referenceLines: [{ value: 100, dashed: false }],
    showXAxis: false,
    showYAxis: false,
    showGrid: false,
    showLegend: false,
    padding: { top: 1, right: 0, bottom: 1, left: 0 },
    chartTitle: 'Rainfall, 87% of normal',
  }

  it('draws no axes, grid or legend, and fills the width it is given', () => {
    const w = mount(NardukBarChart, { props })
    expect(w.findAll('.narduk-axis')).toHaveLength(0)
    expect(w.findAll('.narduk-grid')).toHaveLength(0)
    expect(w.find('.narduk-legend__fieldset').exists()).toBe(false)
    const bar = w.find('rect.narduk-bar-rect')
    expect(Number(bar.attributes('x'))).toBe(0)
    expect(bar.attributes('fill')).toBe('var(--farm-accent)')
  })

  it('scales the bar and the reference tick against the pinned 0–150 domain', () => {
    const w = mount(NardukBarChart, { props })
    const bar = w.find('rect.narduk-bar-rect')
    expect(Number(bar.attributes('width'))).toBeCloseTo((87 / 150) * 300, 5)
    const tick = w.find('line.narduk-ref-line')
    expect(Number(tick.attributes('x1'))).toBeCloseTo((100 / 150) * 300, 5)
    expect(tick.classes()).not.toContain('narduk-ref-line--dashed')
  })

  it('keeps its accessible name', () => {
    const w = mount(NardukBarChart, { props })
    expect(w.find('svg title').text()).toBe('Rainfall, 87% of normal')
  })
})

describe('NardukBarChart stacked on a non-linear axis (#873)', () => {
  const series = [
    { name: 'A', data: [30, 10, 100] },
    { name: 'B', data: [70, 90, 0] },
  ]
  // The third category is one 100 segment: where the axis itself places 100.
  const labels = ['split 30/70', 'split 10/90', 'whole 100']

  function stackEnds(orientation: 'vertical' | 'horizontal', yScale: 'log' | 'symlog') {
    const w = mount(NardukBarChart, {
      props: {
        series,
        labels,
        stacked: true,
        yScale,
        orientation,
        width: 400,
        height: 300,
        animate: false,
        barRadius: 0,
      },
    })
    const rects = w.findAll('rect.narduk-bar-rect').map(r => r.element as SVGRectElement)
    const n = (el: SVGRectElement, a: string) => Number(el.getAttribute(a))
    const byCategory = new Map<number, SVGRectElement[]>()
    for (const el of rects) {
      const key = orientation === 'vertical' ? n(el, 'x') : n(el, 'y')
      byCategory.set(key, [...(byCategory.get(key) ?? []), el])
    }
    return [...byCategory.values()].map(group =>
      orientation === 'vertical'
        ? Math.min(...group.map(el => n(el, 'y')))
        : Math.max(...group.map(el => n(el, 'x') + n(el, 'width'))),
    )
  }

  it.each([
    ['vertical', 'log'],
    ['horizontal', 'log'],
    ['vertical', 'symlog'],
    ['horizontal', 'symlog'],
  ] as const)('%s %s: equal totals end at the same place', (orientation, yScale) => {
    const ends = stackEnds(orientation, yScale)
    expect(ends).toHaveLength(3)
    expect(ends[0]).toBeCloseTo(ends[2]!, 6)
    expect(ends[1]).toBeCloseTo(ends[2]!, 6)
  })
})

// #928: bars grew from the domain floor, so a negative value drew as a short
// positive bar and a positive bar included the whole negative band.
describe('NardukBarChart signed values grow from zero (#928)', () => {
  function rectBoxes(w: ReturnType<typeof mount>) {
    return w.findAll('rect.narduk-bar-rect').map(r => {
      const el = r.element as SVGRectElement
      const n = (name: string) => Number(el.getAttribute(name))
      return { x: n('x'), y: n('y'), width: n('width'), height: n('height') }
    })
  }

  function mountBars(props: Record<string, unknown>) {
    return mount(NardukBarChart, {
      props: { width: 400, height: 300, animate: false, barRadius: 0, ...props },
    })
  }

  it('vertical: a negative bar hangs below the zero line a positive bar rises from', () => {
    const [neg, pos] = rectBoxes(
      mountBars({ series: [{ name: 'P&L', data: [-30, 50] }], labels: ['a', 'b'] }),
    )
    // Both bars meet at the zero line.
    expect(neg!.y).toBeCloseTo(pos!.y + pos!.height, 6)
    // Heights are proportional to |value|, not to value - domain.min.
    expect(pos!.height / neg!.height).toBeCloseTo(50 / 30, 6)
  })

  it('horizontal: a negative bar extends left of the zero line', () => {
    const [neg, pos] = rectBoxes(
      mountBars({
        series: [{ name: 'P&L', data: [-30, 50] }],
        labels: ['a', 'b'],
        orientation: 'horizontal',
      }),
    )
    expect(neg!.x + neg!.width).toBeCloseTo(pos!.x, 6)
    expect(pos!.width / neg!.width).toBeCloseTo(50 / 30, 6)
  })

  it('stacked: positive and negative segments stack away from zero separately', () => {
    const [a, b, c] = rectBoxes(
      mountBars({
        series: [
          { name: 'A', data: [20] },
          { name: 'B', data: [-10] },
          { name: 'C', data: [30] },
        ],
        labels: ['x'],
        stacked: true,
      }),
    )
    const zeroY = a!.y + a!.height
    // B hangs below zero; C sits on top of A.
    expect(b!.y).toBeCloseTo(zeroY, 6)
    expect(c!.y + c!.height).toBeCloseTo(a!.y, 6)
    expect(a!.height / b!.height).toBeCloseTo(2, 6)
    expect(c!.height / b!.height).toBeCloseTo(3, 6)
  })
})
