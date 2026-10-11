// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import NardukBarChart from './NardukBarChart.vue'
import NardukLineChart from './NardukLineChart.vue'

const labels = ['A', 'B', 'C', 'D', 'E', 'F']
const spiky = [1, 9, 1, 9, 0, 8]

function studio(extra: Record<string, unknown> = {}, width = 560) {
  return mount(NardukLineChart, {
    props: {
      series: [
        { name: 'Now', data: spiky },
        { name: 'Before', data: [3, 3, 4, 4, 5, null], emphasis: 'context' },
      ],
      labels,
      width,
      height: 300,
      animate: false,
      dark: false,
      look: 'studio',
      ...extra,
    },
  })
}

/** Every Y in a cubic path's control points, per segment, with its endpoints. */
function cubicYs(d: string) {
  const nums = d.match(/-?\d+(?:\.\d+)?(?:e-?\d+)?/g)!.map(Number)
  const out: Array<{ y0: number; c1: number; c2: number; y1: number }> = []
  let py = nums[1]!
  for (let i = 2; i + 5 < nums.length; i += 6) {
    out.push({ y0: py, c1: nums[i + 1]!, c2: nums[i + 3]!, y1: nums[i + 5]! })
    py = nums[i + 5]!
  }
  return out
}

describe('NardukLineChart look="studio"', () => {
  it('applies the studio class to the chart box and the figure; classic gets neither', () => {
    const w = studio({ chartTitle: 'T' })
    expect(w.find('.narduk-chart').classes()).toContain('narduk-chart--look-studio')
    expect(w.find('figure').classes()).toContain('narduk-chart-figure--look-studio')

    const classic = studio({ look: 'classic', chartTitle: 'T' })
    expect(classic.find('.narduk-chart').classes()).not.toContain('narduk-chart--look-studio')
    expect(classic.find('figure').classes()).not.toContain('narduk-chart-figure--look-studio')
    expect(classic.find('.narduk-now').exists()).toBe(false)
  })

  it('carries the dark class to the figure so the title takes the dark tokens', () => {
    const w = studio({ dark: true, chartTitle: 'T' })
    expect(w.find('figure').classes()).toContain('narduk-chart--dark')
  })

  it('draws monotone curves: no control point leaves the Y range of its two points', () => {
    const w = studio({ series: [{ name: 'Now', data: spiky }] })
    const d = w.find('.narduk-line-path').attributes('d')!
    const segs = cubicYs(d)
    expect(segs.length).toBe(spiky.length - 1)
    for (const s of segs) {
      const lo = Math.min(s.y0, s.y1)
      const hi = Math.max(s.y0, s.y1)
      expect(s.c1).toBeGreaterThanOrEqual(lo - 1e-6)
      expect(s.c1).toBeLessThanOrEqual(hi + 1e-6)
      expect(s.c2).toBeGreaterThanOrEqual(lo - 1e-6)
      expect(s.c2).toBeLessThanOrEqual(hi + 1e-6)
    }
  })

  it('renders a now tag for the last non-null value of a lead series, and none for a context series', () => {
    const w = studio({
      series: [
        { name: 'Now', data: [1, 2, 3, null, null, null], formatValue: (v: number) => `${v} u` },
        { name: 'Before', data: [3, 3, 4, 4, 5, 6], emphasis: 'context' },
        { name: 'Projection', data: [null, null, 3, 4, 5, 6], dashed: true },
      ],
    })
    const tags = w.findAll('.narduk-now__value')
    expect(tags.map(t => t.text())).toEqual(['3 u'])
    expect(w.findAll('.narduk-now__dot')).toHaveLength(1)
  })

  it('shows no tag with showNowTag off', () => {
    const w = studio({ showNowTag: false })
    expect(w.find('.narduk-now').exists()).toBe(false)
  })

  it('styles a context series thin and behind the lead series', () => {
    const w = studio()
    const paths = w.findAll('.narduk-line-path')
    expect(paths[0]!.classes()).toContain('narduk-line-path--context')
    expect(paths[0]!.attributes('stroke')).toContain('color-mix(in oklch')
    expect(paths[0]!.attributes('stroke')).toContain('40%')
    expect(paths[1]!.classes()).not.toContain('narduk-line-path--context')
  })

  it('ignores emphasis in the classic look', () => {
    const w = studio({ look: 'classic' })
    expect(w.find('.narduk-line-path--context').exists()).toBe(false)
  })

  it('keeps the now tag, with its end label, inside the SVG', () => {
    for (const width of [320, 375, 560]) {
      const w = studio(
        {
          series: [{ name: 'Wastewater', data: [10, 20, 30, 40, 50, 1234567] }],
          endLabels: true,
          yBands: [{ y0: 0, y1: 100, label: 'Very high', color: '#bf3b2c' }],
        },
        width,
      )
      const g = w.find('.narduk-now__row g')
      const m = /translate\(([\d.]+),/.exec(g.attributes('transform')!)!
      const x = Number(m[1])
      const chip = Number(w.find('.narduk-now__chip').attributes('width'))
      const name = w.find('.narduk-now__name')
      const nameW = name.exists() ? 'Wastewater'.length * 11 * 0.6 + 6 : 0
      expect(x + chip + nameW).toBeLessThanOrEqual(width)
      /* Level labels share the gutter. */
      for (const lv of w.findAll('.narduk-level-label')) {
        expect(Number(lv.attributes('x')) + 'Very high'.length * 10 * 0.6).toBeLessThanOrEqual(
          width,
        )
      }
    }
  })

  it('leaves end labels to the legend when they would collide', () => {
    const w = studio({
      endLabels: true,
      series: [
        { name: 'One', data: [1, 2, 3, 4, 5, 5] },
        { name: 'Two', data: [1, 2, 3, 4, 5, 5.1] },
      ],
    })
    expect(w.findAll('.narduk-now__name')).toHaveLength(0)
    expect(w.findAll('.narduk-now__value')).toHaveLength(2)
  })

  it('prints end labels when the series end apart', () => {
    const w = studio({
      endLabels: true,
      series: [
        { name: 'One', data: [1, 2, 3, 4, 5, 9] },
        { name: 'Two', data: [1, 2, 3, 4, 5, 1] },
      ],
    })
    expect(w.findAll('.narduk-now__name').map(n => n.text())).toEqual(['One', 'Two'])
  })

  it('prints yUnit after the top tick', () => {
    const w = studio({ yUnit: 'WVAL' })
    expect(w.find('.narduk-axis-unit').text()).toBe('WVAL')
    expect(studio().find('.narduk-axis-unit').exists()).toBe(false)
  })

  it('has no Y axis line and draws level rails and gutter labels for tall bands', () => {
    const w = studio({
      yBands: [
        { y0: 0, y1: 4, label: 'Low', color: '#9fc5e3' },
        { y0: 4, y1: 9.9, label: 'High', color: '#e07b39' },
      ],
    })
    const axisLines = w.findAll('.narduk-axis line')
    /* Only the X axis line remains. */
    expect(axisLines).toHaveLength(1)
    expect(w.findAll('.narduk-y-rail')).toHaveLength(2)
    expect(w.findAll('.narduk-level-label').map(l => l.text())).toContain('High')
  })

  it('takes a band colour from the series it names', () => {
    const w = studio({
      series: [
        { name: 'Measured', data: [1, 2, 3, 4, 5, 6], color: '#111111' },
        { name: 'Projection', data: [null, null, null, 4, 5, 6], color: '#22aa44', dashed: true },
      ],
      bands: [
        {
          name: '80%',
          series: 'Projection',
          low: [null, null, null, 3, 4, 5],
          high: [null, null, null, 5, 6, 7],
        },
      ],
    })
    expect(w.find('.narduk-band-path').attributes('fill')).toBe('#22aa44')
  })

  it('also honours band.series in the classic look', () => {
    const w = studio({
      look: 'classic',
      series: [{ name: 'P', data: [1, 2, 3, 4, 5, 6], color: '#22aa44' }],
      bands: [{ name: 'B', series: 'P', low: [0, 1, 2, 3, 4, 5], high: [2, 3, 4, 5, 6, 7] }],
    })
    expect(w.find('.narduk-band-path').attributes('fill')).toBe('#22aa44')
  })

  it('draws a fade gradient for a single lead series against context series', () => {
    const w = studio()
    expect(w.findAll('linearGradient')).toHaveLength(1)
    const area = w.find('.narduk-area-path')
    expect(area.attributes('fill')).toMatch(/^url\(#nc-fade-/)
    expect(studio({ look: 'classic' }).find('linearGradient').exists()).toBe(false)
  })

  it('puts the legend above the plot, with line keys, and a context key styled apart', () => {
    const w = studio()
    const children = [...w.find('.narduk-chart').element.children]
    const legend = children.findIndex(c => c.classList.contains('narduk-legend'))
    const svg = children.findIndex(c => c.tagName.toLowerCase() === 'svg')
    expect(legend).toBeGreaterThanOrEqual(0)
    expect(legend).toBeLessThan(svg)
    expect(w.findAll('.narduk-legend__item--context')).toHaveLength(1)
  })

  it('draws a ringed dot per visible series and a hairline on hover', async () => {
    const w = studio()
    const svg = w.find('svg')
    ;(svg.element as SVGSVGElement).getBoundingClientRect = () =>
      ({ x: 0, y: 0, left: 0, top: 0, right: 560, bottom: 300, width: 560, height: 300 }) as DOMRect
    await svg.trigger('mousemove', { clientX: 300, clientY: 120 })
    expect(w.find('.narduk-crosshair').exists()).toBe(true)
    const group = w.find('.narduk-crosshair').element.parentElement!
    const dots = [...group.querySelectorAll('circle.narduk-line-point')]
    expect(dots.length).toBe(2)
    expect(dots[0]!.getAttribute('r')).toBe('4')
  })

  it('never lets two X labels overlap, keeping the last one', () => {
    const many = Array.from({ length: 40 }, (_, i) => `Wk ${i}`)
    const w = studio(
      {
        labels: many,
        series: [{ name: 'S', data: many.map((_, i) => i) }],
        xAxisMinLabelPx: 10,
      },
      375,
    )
    const ticks = w.findAll('.narduk-axis text').filter(t => t.text().startsWith('Wk'))
    expect(ticks.at(-1)!.text()).toBe('Wk 39')
    const xs = ticks.map(t => Number(t.attributes('x')))
    for (let i = 1; i < xs.length; i++) expect(xs[i]! - xs[i - 1]!).toBeGreaterThanOrEqual(5 * 6.2)
  })
})

describe('other charts accept look', () => {
  it('NardukBarChart adds the studio class and leaves its marks alone', () => {
    const props = {
      series: [{ name: 'S', data: [1, 2, 3] }],
      labels: ['a', 'b', 'c'],
      width: 400,
      height: 240,
      animate: false,
    }
    const classic = mount(NardukBarChart, { props })
    const studioBar = mount(NardukBarChart, { props: { ...props, look: 'studio' } })
    expect(studioBar.find('.narduk-chart').classes()).toContain('narduk-chart--look-studio')
    expect(classic.find('.narduk-chart').classes()).not.toContain('narduk-chart--look-studio')
    expect(studioBar.findAll('.narduk-bar-rect').length).toBe(
      classic.findAll('.narduk-bar-rect').length,
    )
  })
})
