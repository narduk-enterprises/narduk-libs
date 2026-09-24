// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import NardukLineChart from './NardukLineChart.vue'

function hourlyTimes(count: number): number[] {
  const start = Date.UTC(2026, 4, 14, 20, 0)
  return Array.from({ length: count }, (_, i) => start + i * 60 * 60 * 1000)
}

describe('NardukLineChart time axis', () => {
  it('renders fewer X labels for dense time-series input', () => {
    const times = hourlyTimes(72)
    const labels = times.map(t => new Date(t).toISOString())
    const w = mount(NardukLineChart, {
      props: {
        series: [{ name: 'Wind · kt', data: labels.map((_, i) => 5 + Math.sin(i / 8) * 2) }],
        labels,
        times,
        xAxisType: 'time',
        width: 640,
        height: 320,
        animate: false,
        formatTime: (t: number) => new Date(t).toISOString().slice(5, 16),
      },
    })

    const tickTexts = w
      .findAll('.narduk-axis text')
      .map(node => node.text().trim())
      .filter(text => /^\d{2}-\d{2}T/.test(text))
    expect(tickTexts.length).toBeLessThan(72)
    expect(tickTexts[0]).toBe('05-14T20:00')
    expect(tickTexts[tickTexts.length - 1]).toBe('05-17T19:00')
  })

  it('uses formatted time in tooltip titles', async () => {
    const labels = ['raw-a', 'raw-b', 'raw-c']
    const times = hourlyTimes(3)
    const w = mount(NardukLineChart, {
      attachTo: document.body,
      props: {
        series: [{ name: 'Wind · kt', data: [1, 2, 3] }],
        labels,
        times,
        xAxisType: 'time',
        width: 420,
        height: 240,
        animate: false,
        formatTime: (t: number) => `time-${new Date(t).getUTCHours()}`,
      },
    })

    const svg = w.find('svg').element as SVGSVGElement
    svg.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 420,
      bottom: 240,
      width: 420,
      height: 240,
      toJSON: () => ({}),
    })

    await w.find('svg').trigger('mousemove', { clientX: 210, clientY: 120 })

    expect(w.text()).toContain('time-21')
    w.unmount()
  })

  it('falls back to category labels when a time value is missing', () => {
    const times = hourlyTimes(3)
    const w = mount(NardukLineChart, {
      props: {
        series: [{ name: 'Wind · kt', data: [1, 2, 3] }],
        labels: ['fallback-a', 'fallback-b', 'fallback-c'],
        times: [times[0]!, Number.NaN, times[2]!],
        xAxisType: 'time',
        width: 420,
        height: 240,
        animate: false,
        xAxisMinLabelPx: 50,
        formatTime: (t: number) => `time-${new Date(t).getUTCHours()}`,
      },
    })

    expect(w.text()).toContain('fallback-b')
  })

  it('keeps raw category labels in hover tooltips when axis labels are formatted', async () => {
    const w = mount(NardukLineChart, {
      attachTo: document.body,
      props: {
        series: [{ name: 'Revenue', data: [1, 2, 3] }],
        labels: ['Full category A', 'Full category B', 'Full category C'],
        width: 420,
        height: 240,
        animate: false,
        formatXLabel: (_label: string, index: number) => `C${index + 1}`,
      },
    })

    const svg = w.find('svg').element as SVGSVGElement
    svg.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 420,
      bottom: 240,
      width: 420,
      height: 240,
      toJSON: () => ({}),
    })

    await w.find('svg').trigger('mousemove', { clientX: 210, clientY: 120 })

    expect(w.text()).toContain('Full category B')
    w.unmount()
  })

  it('allows compact padding overrides for axis-free previews', () => {
    const w = mount(NardukLineChart, {
      props: {
        series: [{ name: 'Trend', data: [2, 4, 3, 5] }],
        labels: ['1', '2', '3', '4'],
        width: 120,
        height: 64,
        animate: false,
        padding: { top: 6, right: 8, bottom: 6, left: 8 },
        showGrid: false,
      },
    })

    const surface = w.find('.narduk-plot-surface--line')
    expect(surface.attributes('x')).toBe('8')
    expect(surface.attributes('y')).toBe('6')
    expect(surface.attributes('width')).toBe('104')
    expect(surface.attributes('height')).toBe('52')
  })

  it('can render a data-relative positive linear Y domain', () => {
    const w = mount(NardukLineChart, {
      props: {
        series: [{ name: 'Air temp', data: [79.8, 80.1, 80.4, 80.6] }],
        labels: ['1', '2', '3', '4'],
        width: 240,
        height: 120,
        animate: false,
        linearFromZero: false,
      },
    })

    const tickTexts = w.findAll('.narduk-axis text').map(node => node.text().trim())
    expect(tickTexts).toContain('80')
    expect(tickTexts).not.toContain('0')
  })
})

describe('NardukLineChart consumer ergonomics', () => {
  function baseProps() {
    return {
      series: [{ name: 'Trend', data: [2, 4, 3, 5] }],
      labels: ['1', '2', '3', '4'],
      width: 240,
      height: 120,
      animate: false,
    }
  }

  it('defaults chrome to true and keeps the card wrapper class absent', () => {
    const w = mount(NardukLineChart, { props: baseProps() })
    expect(w.find('.narduk-chart').classes()).not.toContain('narduk-chart--no-chrome')
  })

  it('chrome=false adds the no-chrome modifier class for card-free sparkline usage', () => {
    const w = mount(NardukLineChart, { props: { ...baseProps(), chrome: false } })
    expect(w.find('.narduk-chart').classes()).toContain('narduk-chart--no-chrome')
  })

  it('showTooltip defaults to true and renders the built-in cursor tooltip on hover', async () => {
    const w = mount(NardukLineChart, {
      attachTo: document.body,
      props: baseProps(),
    })
    const svg = w.find('svg').element as SVGSVGElement
    svg.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 240,
      bottom: 120,
      width: 240,
      height: 120,
      toJSON: () => ({}),
    })
    await w.find('svg').trigger('mousemove', { clientX: 120, clientY: 60 })
    expect(w.find('.narduk-tooltip').exists()).toBe(true)
    w.unmount()
  })

  it('showTooltip=false disables the built-in cursor tooltip', async () => {
    const w = mount(NardukLineChart, {
      attachTo: document.body,
      props: { ...baseProps(), showTooltip: false },
    })
    const svg = w.find('svg').element as SVGSVGElement
    svg.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 240,
      bottom: 120,
      width: 240,
      height: 120,
      toJSON: () => ({}),
    })
    await w.find('svg').trigger('mousemove', { clientX: 120, clientY: 60 })
    expect(w.find('.narduk-tooltip').exists()).toBe(false)
    w.unmount()
  })

  it('defaults focusable to true with a tabbable, non-hidden SVG root', () => {
    const w = mount(NardukLineChart, { props: baseProps() })
    const svg = w.find('svg')
    expect(svg.attributes('tabindex')).toBe('0')
    expect(svg.attributes('aria-hidden')).toBeUndefined()
  })

  it('focusable=false removes tabindex, marks aria-hidden, and ignores keyboard navigation', async () => {
    const w = mount(NardukLineChart, { props: { ...baseProps(), focusable: false } })
    const svg = w.find('svg')
    expect(svg.attributes('tabindex')).toBeUndefined()
    expect(svg.attributes('aria-hidden')).toBe('true')

    await svg.trigger('focus')
    await svg.trigger('keydown', { key: 'ArrowRight' })
    // No point click should fire on Enter either, since keyboard focus never armed.
    await svg.trigger('keydown', { key: 'Enter' })
    expect(w.emitted('pointClick')).toBeUndefined()
  })
})

describe('NardukLineChart volume pane', () => {
  it('does not render a volume pane by default, even when volume data is provided', () => {
    const baseProps = {
      series: [{ name: 'Price', data: [1, 2, 3] }],
      labels: ['a', 'b', 'c'],
      width: 300,
      height: 150,
      animate: false,
    }
    const withoutVolume = mount(NardukLineChart, { props: baseProps })
    const withVolume = mount(NardukLineChart, {
      props: { ...baseProps, volume: [10, 20, 30] },
    })

    expect(withVolume.find('.narduk-line-volume').exists()).toBe(false)
    expect(withVolume.find('.narduk-plot-surface--volume').exists()).toBe(false)
    // Unchanged rendering: the price surface height is identical with or without `volume` data.
    const heightWith = withVolume.find('.narduk-plot-surface--line').attributes('height')
    const heightWithout = withoutVolume.find('.narduk-plot-surface--line').attributes('height')
    expect(heightWith).toBe(heightWithout)
  })

  it('does nothing when showVolume is set but no volume data is provided', () => {
    const w = mount(NardukLineChart, {
      props: {
        series: [{ name: 'Price', data: [1, 2, 3] }],
        labels: ['a', 'b', 'c'],
        showVolume: true,
        width: 300,
        height: 150,
        animate: false,
      },
    })

    expect(w.find('.narduk-line-volume').exists()).toBe(false)
    expect(w.find('.narduk-plot-surface--volume').exists()).toBe(false)
  })

  it('reserves the bottom fraction of the plot for volume and shrinks the price pane', () => {
    const w = mount(NardukLineChart, {
      props: {
        series: [{ name: 'Price', data: [1, 2, 3] }],
        labels: ['a', 'b', 'c'],
        volume: [10, 20, 30],
        showVolume: true,
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
        width: 300,
        height: 200,
        animate: false,
      },
    })

    const priceSurface = w.find('.narduk-plot-surface--line')
    const volSurface = w.find('.narduk-plot-surface--volume')
    expect(volSurface.exists()).toBe(true)
    const priceH = Number(priceSurface.attributes('height'))
    const volH = Number(volSurface.attributes('height'))
    expect(priceH).toBeLessThan(200)
    expect(volH).toBeGreaterThan(0)
    expect(priceH + volH).toBeLessThan(200)
    expect(w.findAll('.narduk-line-volume__bar')).toHaveLength(3)
  })

  it('volumeFraction grows the volume pane and shrinks the price pane, like NardukCandleChart', () => {
    function heights(volumeFraction: number) {
      const w = mount(NardukLineChart, {
        props: {
          series: [{ name: 'Price', data: [1, 2, 3] }],
          labels: ['a', 'b', 'c'],
          volume: [10, 20, 30],
          showVolume: true,
          volumeFraction,
          padding: { top: 0, right: 0, bottom: 0, left: 0 },
          width: 300,
          height: 200,
          animate: false,
        },
      })
      return {
        price: Number(w.find('.narduk-plot-surface--line').attributes('height')),
        volume: Number(w.find('.narduk-plot-surface--volume').attributes('height')),
      }
    }

    const small = heights(0.12)
    const large = heights(0.4)
    expect(large.volume).toBeGreaterThan(small.volume)
    expect(large.price).toBeLessThan(small.price)
  })

  it('aligns volume bars to the same x positions as the decimated series under maxRenderPoints', () => {
    const n = 20
    const labels = Array.from({ length: n }, (_, i) => `L${i}`)
    const data = Array.from({ length: n }, (_, i) => i + 1)
    const volume = Array.from({ length: n }, (_, i) => (i + 1) * 100)
    const w = mount(NardukLineChart, {
      props: {
        series: [{ name: 'Price', data }],
        labels,
        volume,
        showVolume: true,
        showPoints: true,
        maxRenderPoints: 5,
        width: 500,
        height: 200,
        animate: false,
      },
    })

    const points = w.findAll('.narduk-line-point')
    const bars = w.findAll('.narduk-line-volume__bar')
    expect(points.length).toBeLessThan(n)
    expect(bars.length).toBe(points.length)

    for (const [i, pt] of points.entries()) {
      const cx = Number(pt.attributes('cx'))
      const barX = Number(bars[i]!.attributes('x'))
      const barW = Number(bars[i]!.attributes('width'))
      expect(barX + barW / 2).toBeCloseTo(cx, 5)
    }
  })

  it('renders zero-height, neutral-colored bars for null volume entries', () => {
    const w = mount(NardukLineChart, {
      props: {
        series: [{ name: 'Price', data: [10, 12, 9, 15] }],
        labels: ['a', 'b', 'c', 'd'],
        volume: [100, null, 50, null],
        showVolume: true,
        width: 400,
        height: 200,
        animate: false,
      },
    })

    const bars = w.findAll('.narduk-line-volume__bar')
    expect(bars).toHaveLength(4)
    expect(Number(bars[1]!.attributes('height'))).toBe(0)
    expect(bars[1]!.attributes('fill')).toBe('var(--color-chart-muted)')
    expect(Number(bars[3]!.attributes('height'))).toBe(0)
    expect(bars[3]!.attributes('fill')).toBe('var(--color-chart-muted)')
  })

  it('colors bars by close-vs-previous-close direction with a neutral index-0 fallback', () => {
    const w = mount(NardukLineChart, {
      props: {
        // idx0: neutral (no previous). idx1: 10->15 up. idx2: 15->12 down. idx3: 12->12 flat (>=  → up).
        series: [{ name: 'Price', data: [10, 15, 12, 12] }],
        labels: ['a', 'b', 'c', 'd'],
        volume: [100, 200, 150, 90],
        showVolume: true,
        width: 400,
        height: 200,
        animate: false,
      },
    })

    const bars = w.findAll('.narduk-line-volume__bar')
    expect(bars[0]!.attributes('fill')).toBe('var(--color-chart-muted)')
    expect(bars[1]!.attributes('fill')).toBe('var(--color-chart-up, #22c55e)')
    expect(bars[2]!.attributes('fill')).toBe('var(--color-chart-down, #ef4444)')
    expect(bars[3]!.attributes('fill')).toBe('var(--color-chart-up, #22c55e)')
  })

  it('applies volume direction coloring from series[0] only in multi-series charts', () => {
    const w = mount(NardukLineChart, {
      props: {
        series: [
          { name: 'A', data: [10, 5] }, // down
          { name: 'B', data: [1, 100] }, // up — must be ignored for volume coloring
        ],
        labels: ['x', 'y'],
        volume: [10, 20],
        showVolume: true,
        width: 300,
        height: 150,
        animate: false,
      },
    })

    const bars = w.findAll('.narduk-line-volume__bar')
    expect(bars[1]!.attributes('fill')).toBe('var(--color-chart-down, #ef4444)')
  })
})

describe('NardukLineChart series palette is themable', () => {
  const series = [
    { name: 'A', data: [1, 2, 3] },
    { name: 'B', data: [3, 2, 1] },
  ]
  const labels = ['x', 'y', 'z']

  it('paints series from --color-chart-series-N so a theme class can override them', () => {
    const w = mount(NardukLineChart, {
      props: { series, labels, width: 300, height: 150, animate: false },
    })

    const paths = w.findAll('.narduk-line-path')
    expect(paths[0]!.attributes('stroke')).toMatch(/^var\(--color-chart-series-1, /)
    expect(paths[1]!.attributes('stroke')).toMatch(/^var\(--color-chart-series-2, /)
  })

  it('keeps the token under theme="colorblind-safe" — the class repaints it, not the component', () => {
    const w = mount(NardukLineChart, {
      props: { series, labels, width: 300, height: 150, animate: false, theme: 'colorblind-safe' },
    })

    expect(w.find('.narduk-chart--theme-colorblind-safe').exists()).toBe(true)
    expect(w.findAll('.narduk-line-path')[0]!.attributes('stroke')).toMatch(
      /^var\(--color-chart-series-1, /,
    )
  })

  it('still takes an explicit colors prop literally', () => {
    const w = mount(NardukLineChart, {
      props: {
        series,
        labels,
        width: 300,
        height: 150,
        animate: false,
        colors: ['#123456', '#654321'],
      },
    })

    const paths = w.findAll('.narduk-line-path')
    expect(paths[0]!.attributes('stroke')).toBe('#123456')
    expect(paths[1]!.attributes('stroke')).toBe('#654321')
  })
})

describe('NardukLineChart isolated values', () => {
  /*
   * A series whose measured entries never neighbour one another. Every run is
   * a run of one, so before the fix the chart drew NOTHING: `segmentLinePoints`
   * splits at each null and `lineSegmentsToPaths` returns '' below two points.
   */
  const sparse = [{ name: 'users', data: [5, null, 7, null, 9] }]
  const sparseLabels = ['1', '2', '3', '4', '5']

  it('draws a marker for every value with no measured neighbour', () => {
    const w = mount(NardukLineChart, {
      props: { series: sparse, labels: sparseLabels, width: 300, height: 150, animate: false },
    })

    // The regression: every line path is empty, so the markers are the only
    // thing standing between this data and a blank plot.
    const drawn = w.findAll('.narduk-line-path').filter(p => (p.attributes('d') ?? '') !== '')
    expect(drawn).toHaveLength(0)
    expect(w.findAll('.narduk-line-point--isolated')).toHaveLength(3)
  })

  it('places each marker at its own value, not at a shared or collapsed position', () => {
    const w = mount(NardukLineChart, {
      props: { series: sparse, labels: sparseLabels, width: 300, height: 150, animate: false },
    })

    const points = w
      .findAll('.narduk-line-point--isolated')
      .map(p => ({ x: Number(p.attributes('cx')), y: Number(p.attributes('cy')) }))
    for (const point of points) {
      expect(Number.isFinite(point.x)).toBe(true)
      expect(Number.isFinite(point.y)).toBe(true)
    }
    // x ascends with the index; y rises with the value (SVG y grows downward).
    expect(points[0]!.x).toBeLessThan(points[1]!.x)
    expect(points[1]!.x).toBeLessThan(points[2]!.x)
    expect(points[0]!.y).toBeGreaterThan(points[2]!.y)
  })

  it('leaves a genuine two-point run as a line rather than a pair of markers', () => {
    const w = mount(NardukLineChart, {
      props: {
        series: [{ name: 'users', data: [5, 6, null, 9] }],
        labels: ['1', '2', '3', '4'],
        width: 300,
        height: 150,
        animate: false,
      },
    })

    // The [5, 6] run draws a line; only the trailing 9 is isolated.
    expect(w.findAll('.narduk-line-point--isolated')).toHaveLength(1)
    const drawn = w.findAll('.narduk-line-path').filter(p => (p.attributes('d') ?? '') !== '')
    expect(drawn.length).toBeGreaterThan(0)
  })

  it('defers to showPoints so an isolated value never gets two overlapping markers', () => {
    const w = mount(NardukLineChart, {
      props: {
        series: sparse,
        labels: sparseLabels,
        width: 300,
        height: 150,
        animate: false,
        showPoints: true,
      },
    })

    expect(w.findAll('.narduk-line-point--isolated')).toHaveLength(0)
    expect(w.findAll('.narduk-line-point').length).toBeGreaterThan(0)
  })

  it('can be turned off, and honours pointRadius when on', () => {
    const off = mount(NardukLineChart, {
      props: {
        series: sparse,
        labels: sparseLabels,
        width: 300,
        height: 150,
        animate: false,
        showIsolatedPoints: false,
      },
    })
    expect(off.findAll('.narduk-line-point--isolated')).toHaveLength(0)

    const small = mount(NardukLineChart, {
      props: {
        series: sparse,
        labels: sparseLabels,
        width: 300,
        height: 150,
        animate: false,
        pointRadius: 1.5,
      },
    })
    expect(small.find('.narduk-line-point--isolated').attributes('r')).toBe('1.5')
  })
})

describe('NardukLineChart axis suppression', () => {
  const series = [{ name: 'users', data: [4, 9, 6, 11] }]
  const labels = ['1', '2', '3', '4']
  const base = { series, labels, width: 300, height: 150, animate: false }

  it('draws both axes by default', () => {
    const w = mount(NardukLineChart, { props: base })
    expect(w.findAll('.narduk-axis').length).toBeGreaterThanOrEqual(2)
  })

  it('removes the axis lines AND their tick labels, not just the lines', () => {
    const w = mount(NardukLineChart, {
      props: { ...base, showXAxis: false, showYAxis: false, showGrid: false },
    })

    expect(w.findAll('.narduk-axis')).toHaveLength(0)
    // The series itself must survive: this is a sparkline, not an empty chart.
    const drawn = w.findAll('.narduk-line-path').filter(p => (p.attributes('d') ?? '') !== '')
    expect(drawn.length).toBeGreaterThan(0)
  })

  it('suppresses each axis independently', () => {
    const noY = mount(NardukLineChart, { props: { ...base, showYAxis: false } })
    expect(noY.findAll('.narduk-axis')).toHaveLength(1)

    const noX = mount(NardukLineChart, { props: { ...base, showXAxis: false } })
    expect(noX.findAll('.narduk-axis')).toHaveLength(1)
  })

  it('drops the legend on request, and keeps it by default', () => {
    const withLegend = mount(NardukLineChart, { props: base })
    expect(withLegend.findAll('.narduk-legend, [class*="legend"]').length).toBeGreaterThan(0)

    const without = mount(NardukLineChart, { props: { ...base, showLegend: false } })
    expect(without.findAll('.narduk-legend, [class*="legend"]')).toHaveLength(0)
    // The series must survive: this drops chrome, not data.
    const drawn = without.findAll('.narduk-line-path').filter(p => (p.attributes('d') ?? '') !== '')
    expect(drawn.length).toBeGreaterThan(0)
  })

  it('takes the right-hand axis with it under dualYAxis', () => {
    const dual = {
      series: [
        { name: 'a', data: [1, 2, 3, 4] },
        { name: 'b', data: [100, 200, 300, 400], yAxis: 'secondary' as const },
      ],
      labels,
      width: 300,
      height: 150,
      animate: false,
      dualYAxis: true,
    }

    expect(mount(NardukLineChart, { props: dual }).findAll('.narduk-axis--secondary')).toHaveLength(
      1,
    )
    expect(
      mount(NardukLineChart, { props: { ...dual, showYAxis: false } }).findAll(
        '.narduk-axis--secondary',
      ),
    ).toHaveLength(0)
  })
})

describe('NardukLineChart pinned Y domain and tick count', () => {
  const labels = ['1', '2', '3', '4']
  const base = { labels, width: 300, height: 150, animate: false }

  it('draws a quiet and a busy series on one shared scale', () => {
    const quiet = mount(NardukLineChart, {
      props: { ...base, series: [{ name: 'a', data: [1, 2, 3, 4] }], yMin: 0, yMax: 4_000 },
    })
    const busy = mount(NardukLineChart, {
      props: {
        ...base,
        series: [{ name: 'a', data: [3_000, 3_400, 3_900, 4_000] }],
        yMin: 0,
        yMax: 4_000,
      },
    })

    const yOf = (w: ReturnType<typeof mount>) =>
      Number(
        w
          .find('.narduk-line-path')
          .attributes('d')!
          .match(/-?\d+(?:\.\d+)?/g)![1],
      )

    // Self-normalised, both would start at the same height. Pinned, the quiet
    // series sits far below the busy one.
    expect(yOf(quiet)).toBeGreaterThan(yOf(busy))
  })

  it('renders exactly the requested number of Y tick labels', () => {
    const w = mount(NardukLineChart, {
      props: {
        ...base,
        series: [{ name: 'a', data: [0, 500, 900] }],
        yMin: 0,
        yMax: 900,
        yTickCount: 3,
      },
    })

    const ticks = w.findAll('.narduk-axis')[0]!.findAll('text')
    expect(ticks).toHaveLength(3)
    expect(ticks.map((t: { text: () => string }) => t.text())).toEqual(['0', '450', '900'])
  })

  it('clamps an absurd tick count instead of rendering hundreds of labels', () => {
    const w = mount(NardukLineChart, {
      props: { ...base, series: [{ name: 'a', data: [0, 100] }], yTickCount: 500 },
    })
    expect(w.findAll('.narduk-axis')[0]!.findAll('text').length).toBeLessThanOrEqual(12)
  })
})

describe('NardukLineChart xWindow', () => {
  it('keeps a path after a controlled xWindow update', async () => {
    const w = mount(NardukLineChart, {
      props: {
        series: [{ name: 'a', data: [1, 2, 3, 4, 5] }],
        labels: ['a', 'b', 'c', 'd', 'e'],
        width: 300,
        height: 150,
        animate: false,
        zoomable: true,
        xWindow: { start: 0, end: 4 },
      },
    })
    expect(w.findAll('.narduk-line-path').some(p => (p.attributes('d') ?? '') !== '')).toBe(true)
    await w.setProps({ xWindow: { start: 1, end: 3 } })
    expect(w.findAll('.narduk-line-path').some(p => (p.attributes('d') ?? '') !== '')).toBe(true)
  })
})

describe('NardukLineChart sparse seasonal series (narduk-charts#37)', () => {
  /** A 366-slot day-of-year series with passes on days 10, 40, 100 and 110. */
  function doySeries(points: Record<number, number>): Array<number | null> {
    const data: Array<number | null> = Array.from({ length: 366 }, () => null)
    for (const [day, v] of Object.entries(points)) data[Number(day) - 1] = v
    return data
  }
  const labels = Array.from({ length: 366 }, (_, i) => String(i + 1))
  const base = { labels, width: 600, height: 200, animate: false }
  const drawn = (w: ReturnType<typeof mount>) =>
    w.findAll('.narduk-line-path').filter(p => (p.attributes('d') ?? '') !== '')

  it('spanGaps: number joins passes up to that many slots apart and never bridges a longer gap', () => {
    const data = doySeries({ 10: 0.3, 40: 0.5, 100: 0.7, 110: 0.6 })
    const w = mount(NardukLineChart, {
      props: { ...base, series: [{ name: '2024', data, spanGaps: 40 }] },
    })
    // 10 -> 40 (30 days) joins; 40 -> 100 (60 days) breaks; 100 -> 110 joins.
    expect(drawn(w)).toHaveLength(2)
    expect(w.findAll('.narduk-line-point--isolated')).toHaveLength(0)
  })

  it('spanGaps: true bridges every gap; the default bridges none', () => {
    const data = doySeries({ 10: 0.3, 40: 0.5, 100: 0.7 })
    const all = mount(NardukLineChart, {
      props: { ...base, series: [{ name: 's', data, spanGaps: true }] },
    })
    expect(drawn(all)).toHaveLength(1)
    const none = mount(NardukLineChart, { props: { ...base, series: [{ name: 's', data }] } })
    expect(drawn(none)).toHaveLength(0)
    expect(none.findAll('.narduk-line-point--isolated')).toHaveLength(3)
  })

  it("mode: 'points' draws one marker per value and no line or area", () => {
    const data = doySeries({ 10: 0.3, 11: 0.35, 12: 0.4 })
    const w = mount(NardukLineChart, {
      props: {
        ...base,
        showArea: true,
        series: [{ name: 'cloudy', data, mode: 'points' as const }],
      },
    })
    expect(drawn(w)).toHaveLength(0)
    expect(
      w.findAll('.narduk-area-path').filter(p => (p.attributes('d') ?? '') !== ''),
    ).toHaveLength(0)
    const pts = w
      .findAll('circle.narduk-line-point')
      .filter(c => (c.element as SVGElement).style.display !== 'none')
    expect(pts).toHaveLength(3)
  })

  it('marker: hollow ring in the series colour on style, radius and series opacity', () => {
    const data = doySeries({ 10: 0.3, 50: 0.4 })
    const w = mount(NardukLineChart, {
      props: {
        ...base,
        series: [
          {
            name: 'cloudy',
            data,
            mode: 'points' as const,
            color: 'var(--farm-accent)',
            marker: { radius: 2.5, filled: false },
            opacity: 0.5,
          },
        ],
      },
    })
    const pt = w
      .findAll('circle.narduk-line-point')
      .find(c => (c.element as SVGElement).style.display !== 'none')!
    expect(pt.classes()).toContain('narduk-line-point--hollow')
    expect(pt.attributes('r')).toBe('2.5')
    // The ring colour must be inline style: the stylesheet's `stroke` on
    // `.narduk-line-point` outranks a presentation attribute.
    expect((pt.element as SVGElement).style.stroke).toBe('var(--farm-accent)')
    expect(pt.attributes('fill')).toContain('--color-chart-plot-tint')
    expect(pt.element.closest('g[opacity]')?.getAttribute('opacity')).toBe('0.5')
  })

  it('a filled marker keeps the series colour, including a CSS custom property', () => {
    const w = mount(NardukLineChart, {
      props: {
        ...base,
        series: [
          {
            name: 'clear',
            data: doySeries({ 10: 0.3, 20: 0.4 }),
            color: 'var(--farm-accent)',
            spanGaps: 40,
          },
        ],
        showPoints: true,
      },
    })
    expect(drawn(w)[0]!.attributes('stroke')).toBe('var(--farm-accent)')
    const pt = w
      .findAll('circle.narduk-line-point')
      .find(c => (c.element as SVGElement).style.display !== 'none')!
    expect(pt.attributes('fill')).toBe('var(--farm-accent)')
    expect(pt.classes()).not.toContain('narduk-line-point--hollow')
  })

  it('ring point annotation: plot-background fill with the colour as an inline stroke', () => {
    const w = mount(NardukLineChart, {
      props: {
        ...base,
        series: [{ name: '2024', data: doySeries({ 10: 0.3, 40: 0.8 }), spanGaps: 40 }],
        annotations: [
          {
            type: 'point' as const,
            xIndex: 39,
            y: 0.8,
            color: 'var(--farm-accent)',
            ring: true,
            label: 'Peak 0.80',
          },
        ],
      },
    })
    const ring = w.find('circle.narduk-ann-point')
    expect(ring.classes()).toContain('narduk-ann-point--ring')
    expect(ring.attributes('fill')).toContain('--color-chart-plot-tint')
    expect((ring.element as SVGElement).style.stroke).toBe('var(--farm-accent)')
    // The label is drawn text, not a hover tooltip.
    expect(w.find('.narduk-ann-points').text()).toContain('Peak 0.80')
  })

  it('pins plus yTickCount express round 0.1 / 0.2 steps clamped to 0–1', () => {
    const w = mount(NardukLineChart, {
      props: {
        ...base,
        series: [{ name: 's', data: doySeries({ 10: 0.25, 40: 0.71 }), spanGaps: 40 }],
        // Span 0.46 <= 0.5 -> step 0.1 on [0.2, 0.8]: (0.8 - 0.2) / 0.1 + 1 = 7 ticks.
        yMin: 0.2,
        yMax: 0.8,
        yTickCount: 7,
      },
    })
    const ticks = w
      .findAll('.narduk-axis')[0]!
      .findAll('text')
      .map(t => t.text())
    expect(ticks).toEqual(['0.2', '0.3', '0.4', '0.5', '0.6', '0.7', '0.8'])

    const wide = mount(NardukLineChart, {
      props: {
        ...base,
        series: [{ name: 's', data: doySeries({ 10: 0.05, 40: 0.9 }), spanGaps: 40 }],
        yMin: 0,
        yMax: 1,
        yTickCount: 6,
      },
    })
    expect(
      wide
        .findAll('.narduk-axis')[0]!
        .findAll('text')
        .map(t => t.text()),
    ).toEqual(['0', '0.2', '0.4', '0.6', '0.8', '1'])
  })
})

describe('NardukLineChart year-dot timeline (showValues)', () => {
  const labels = ['2019', '2020', '2021', '2022', '2023']
  const series = [
    {
      name: 'Yield',
      data: [62, null, 71.4, 58, null],
      mode: 'points' as const,
      showValues: true,
      formatValue: (v: number) => `${v.toFixed(1)} bu`,
    },
  ]

  it('draws one dot and one always-visible label per year with a value, and nothing for a gap', () => {
    const w = mount(NardukLineChart, {
      props: { series, labels, width: 400, height: 120, animate: false, showDataTable: true },
    })
    const dots = w
      .findAll('circle.narduk-line-point')
      .filter(c => (c.element as SVGElement).style.display !== 'none')
    expect(dots).toHaveLength(3)
    const text = w.findAll('.narduk-line-value').map(t => t.text())
    expect(text).toEqual(['62.0 bu', '71.4 bu', '58.0 bu'])
    expect(
      w.findAll('.narduk-line-path').filter(p => (p.attributes('d') ?? '') !== ''),
    ).toHaveLength(0)
    // The gap years stay on the axis and in the data table.
    expect(w.text()).toContain('2020')
    expect(w.find('table').text()).toContain('2023')
  })

  it('places each label above its own dot', () => {
    const w = mount(NardukLineChart, {
      props: { series, labels, width: 400, height: 120, animate: false },
    })
    const dot = w
      .findAll('circle.narduk-line-point')
      .find(c => (c.element as SVGElement).style.display !== 'none')!
    const label = w.find('.narduk-line-value')
    expect(Number(label.attributes('x'))).toBeCloseTo(Number(dot.attributes('cx')))
    expect(Number(label.attributes('y'))).toBeLessThan(Number(dot.attributes('cy')))
  })
})

describe('NardukLineChart xTickIndices', () => {
  it('labels exactly the given category indices, e.g. month starts on a day-of-year axis', () => {
    const monthStarts = [1, 32, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335]
    const names = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ]
    const w = mount(NardukLineChart, {
      props: {
        series: [
          { name: 's', data: Array.from({ length: 366 }, (_, i) => (i % 30 === 0 ? 0.5 : null)) },
        ],
        labels: Array.from({ length: 366 }, (_, i) => String(i + 1)),
        width: 600,
        height: 200,
        animate: false,
        showYAxis: false,
        xTickIndices: monthStarts.map(d => d - 1).concat([999, -1]),
        formatXLabel: (label: string) => names[monthStarts.indexOf(Number(label))] ?? label,
      },
    })
    const xLabels = w.findAll('.narduk-axis text').map(t => t.text())
    expect(xLabels).toEqual(names)
  })

  it('skips ticks that would collide on a narrow chart instead of shrinking the text', () => {
    const monthStarts = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334]
    const w = mount(NardukLineChart, {
      props: {
        series: [
          { name: 's', data: Array.from({ length: 366 }, (_, i) => (i % 30 === 0 ? 0.5 : null)) },
        ],
        labels: Array.from({ length: 366 }, (_, i) => String(i + 1)),
        width: 300,
        height: 200,
        animate: false,
        showYAxis: false,
        xTickIndices: monthStarts,
      },
    })
    const xs = w.findAll('.narduk-axis text').map(t => Number(t.attributes('x')))
    expect(xs.length).toBeGreaterThan(1)
    expect(xs.length).toBeLessThan(12)
    for (let k = 1; k < xs.length; k++) expect(xs[k]! - xs[k - 1]!).toBeGreaterThanOrEqual(36)
  })
})
