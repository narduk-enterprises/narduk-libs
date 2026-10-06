// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
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

  function mountBars(props: {
    series: Array<{ name: string; data: number[] }>
    labels: string[]
    orientation?: 'horizontal' | 'vertical'
    stacked?: boolean
  }) {
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

describe('NardukBarChart keyboard focus (narduk-libs#1237)', () => {
  function mountBars(errorHandler?: (error: unknown) => void) {
    return mount(NardukBarChart, {
      attachTo: document.body,
      props: {
        series: [{ name: 'A', data: [10, 20, 30] }],
        labels: ['x', 'y', 'z'],
        width: 300,
        height: 160,
        animate: false,
        barRadius: 0,
      },
      ...(errorHandler ? { global: { config: { errorHandler } } } : {}),
    })
  }

  it('moves focus to the next bar on ArrowRight', async () => {
    const w = mountBars()
    await nextTick()
    const rects = w.findAll('rect.narduk-bar-rect')

    await rects[0]!.trigger('keydown', { key: 'ArrowRight' })

    await vi.waitFor(() => {
      expect(document.activeElement).toBe(rects[1]!.element)
    })
    w.unmount()
  })

  // The focus runs a tick after the keypress. A throw there must reach the
  // app's error handler, never surface as an unhandled promise rejection.
  it('hands a failed focus to the app error handler, not an unhandled rejection', async () => {
    const failure = new Error('focus failed')
    const focus = vi.spyOn(SVGElement.prototype, 'focus').mockImplementation(() => {
      throw failure
    })
    const errorHandler = vi.fn()
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    try {
      const w = mountBars(errorHandler)
      await nextTick()

      await w.findAll('rect.narduk-bar-rect')[0]!.trigger('keydown', { key: 'ArrowRight' })

      await vi.waitFor(() => {
        expect(errorHandler).toHaveBeenCalledOnce()
      })
      expect(errorHandler.mock.calls[0]![0]).toBe(failure)
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(unhandled).not.toHaveBeenCalled()
      w.unmount()
    } finally {
      process.off('unhandledRejection', unhandled)
      focus.mockRestore()
    }
  })
})

describe('NardukBarChart missing values (narduk-libs#1544)', () => {
  const base = {
    series: [{ name: 'Users', data: [3, null, 0, 5] as Array<number | null> }],
    labels: ['Mon', 'Tue', 'Wed', 'Thu'],
    width: 400,
    height: 160,
    animate: false,
    barRadius: 0,
  }
  const geometry = (el: Element) => ({
    height: Number(el.getAttribute('height')),
    width: Number(el.getAttribute('width')),
    x: Number(el.getAttribute('x')),
    y: Number(el.getAttribute('y')),
  })

  it('draws a null as zero by default: no stub, no change to the default name or table', () => {
    const w = mount(NardukBarChart, { props: { ...base, showDataTable: true } })
    expect(w.findAll('.narduk-bar-rect--missing')).toHaveLength(0)
    expect(w.find('[data-nc-state="missing"]').exists()).toBe(false)
    const rects = w.findAll('rect.narduk-bar-rect')
    // null and a real 0 are the same empty slot: the ambiguity this opt-in ends.
    expect(geometry(rects[1]!.element).height).toBe(0)
    expect(geometry(rects[2]!.element).height).toBe(0)
    expect(w.find('svg title').text()).toBe('Bar chart: Users')
    expect(w.findAll('tbody td').map(t => t.text())).toEqual(['3', '', '0', '5'])
  })

  it('gap mode: null is a hatched stub, a real 0 is a 1px floor bar, and they differ', () => {
    const w = mount(NardukBarChart, { props: { ...base, missingValues: 'gap' } })
    const rects = w.findAll('rect.narduk-bar-rect')
    expect(rects).toHaveLength(4)

    const stub = rects[1]!
    const zero = rects[2]!
    expect(stub.classes()).toContain('narduk-bar-rect--missing')
    expect(stub.attributes('data-nc-state')).toBe('missing')
    expect(stub.attributes('fill')).toMatch(/^url\(#nc-bh-.+-0\)$/)
    expect(zero.classes()).not.toContain('narduk-bar-rect--missing')
    expect(zero.attributes('data-nc-state')).toBeUndefined()
    expect(zero.attributes('fill')).not.toMatch(/^url\(/)

    const stubBox = geometry(stub.element)
    const zeroBox = geometry(zero.element)
    expect(zeroBox.height).toBe(1)
    expect(stubBox.height).toBeGreaterThan(zeroBox.height)
    // Both sit on the axis: the floor grows up from it, never below it.
    expect(stubBox.y + stubBox.height).toBeCloseTo(zeroBox.y + zeroBox.height, 5)

    // The hatch pattern the stub paints with is defined.
    const pattern = w.find('pattern')
    expect(pattern.attributes('id')).toBe(stub.attributes('fill')!.slice(5, -1))
  })

  it('gap mode: names the gap in the bar, the default chart name and the data table', () => {
    const w = mount(NardukBarChart, {
      props: { ...base, missingValues: 'gap', missingLabel: 'no row', showDataTable: true },
    })
    const rects = w.findAll('rect.narduk-bar-rect')
    expect(rects[1]!.attributes('aria-label')).toBe('Users, Tue, no row')
    expect(rects[2]!.attributes('aria-label')).toBe('Users, Wed, 0')
    expect(w.find('svg title').text()).toBe('Bar chart: Users, 1 slot has no row')
    expect(w.findAll('tbody td').map(t => t.text())).toEqual(['3', 'no row', '0', '5'])
  })

  it('gap mode: a caller chartTitle still wins, and no gaps leaves the name alone', () => {
    const titled = mount(NardukBarChart, {
      props: { ...base, missingValues: 'gap', chartTitle: 'Daily users, 1 day has no row' },
    })
    expect(titled.find('svg title').text()).toBe('Daily users, 1 day has no row')
    const full = mount(NardukBarChart, {
      props: { ...base, series: [{ name: 'Users', data: [3, 1, 0, 5] }], missingValues: 'gap' },
    })
    expect(full.find('svg title').text()).toBe('Bar chart: Users')
    expect(full.findAll('.narduk-bar-rect--missing')).toHaveLength(0)
  })

  it('gap mode: the tooltip says the missing label, and a missing slot emits no barClick', async () => {
    const w = mount(NardukBarChart, {
      props: { ...base, missingValues: 'gap', missingLabel: 'no row' },
      attachTo: document.body,
    })
    await nextTick()
    const rects = w.findAll('rect.narduk-bar-rect')
    await rects[1]!.trigger('keydown', { key: 'Enter' })
    await rects[1]!.trigger('click')
    expect(w.emitted('barClick')).toBeUndefined()
    await rects[0]!.trigger('click')
    expect(w.emitted('barClick')).toHaveLength(1)
    await rects[0]!.trigger('keydown', { key: 'ArrowRight' })
    await vi.waitFor(() => expect(w.text()).toContain('no row'))
    w.unmount()
  })

  it('gap mode: horizontal stub starts at the axis and a real zero is a 1px floor', () => {
    const w = mount(NardukBarChart, {
      props: {
        ...base,
        orientation: 'horizontal',
        missingValues: 'gap',
        categoryLabelMaxWidth: 60,
      },
    })
    const rects = w.findAll('rect.narduk-bar-rect')
    const stub = geometry(rects[1]!.element)
    const zero = geometry(rects[2]!.element)
    expect(rects[1]!.classes()).toContain('narduk-bar-rect--missing')
    expect(zero.width).toBe(1)
    expect(stub.width).toBeGreaterThan(zero.width)
    expect(stub.x).toBe(zero.x)
  })

  it('gap mode, stacked: one stub for a category with no value in any series, none for a partial one', () => {
    const w = mount(NardukBarChart, {
      props: {
        series: [
          { name: 'A', data: [4, null, null] },
          { name: 'B', data: [6, 2, null] },
        ],
        labels: ['x', 'y', 'z'],
        stacked: true,
        missingValues: 'gap',
        width: 400,
        height: 160,
        animate: false,
        barRadius: 0,
      },
    })
    const rects = w.findAll('rect.narduk-bar-rect')
    expect(rects).toHaveLength(6)
    const missing = rects.filter(r => r.classes().includes('narduk-bar-rect--missing'))
    expect(missing).toHaveLength(3)
    // y/A is a missing segment of a stack that has a row: no extent.
    expect(geometry(rects[2]!.element).height).toBe(0)
    // z has no value in either series: A carries the one stub, B nothing.
    expect(geometry(rects[4]!.element).height).toBeGreaterThan(0)
    expect(geometry(rects[5]!.element).height).toBe(0)
  })
})
