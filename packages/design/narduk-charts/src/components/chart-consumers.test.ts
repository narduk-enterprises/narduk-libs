// @vitest-environment happy-dom
import { renderToString } from '@vue/server-renderer'
import { enableAutoUnmount, mount } from '@vue/test-utils'
import { createSSRApp, h, nextTick, type Component } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'

import NardukBarChart from './NardukBarChart.vue'
import NardukLineChart from './NardukLineChart.vue'
import { captureConsoleStreams } from './hydration-warnings'

enableAutoUnmount(afterEach)
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const base = {
  labels: ['A', 'B', 'C'],
  series: [{ name: 'Price', data: [0, 12.5, 25] }],
  width: 400,
  height: 200,
  animate: false,
  dark: false,
  smooth: false,
  padding: { top: 0, right: 0, bottom: 0, left: 0 },
  yMin: 0,
  yMax: 25,
  yTickCount: 3,
}

function pointerChart(extra = {}) {
  const wrapper = mount(NardukLineChart, { props: { ...base, ...extra } })
  const svg = wrapper.get('svg')
  vi.spyOn(svg.element, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 20, 200, 100))
  return { wrapper, svg }
}

describe('line active index', () => {
  it.each(['mouse', 'touch', 'pen'])(
    'emits source indices for %s move, leave and cancel without a tooltip',
    async pointerType => {
      const { wrapper, svg } = pointerChart({ showTooltip: false })
      expect(svg.attributes('style')).toContain('touch-action: pan-y')
      await svg.trigger('pointermove', { clientX: 110, clientY: 50, pointerType })
      await svg.trigger('pointerleave', { pointerType })
      await svg.trigger('pointermove', { clientX: 210, clientY: 50, pointerType })
      await svg.trigger('pointercancel', { pointerType })
      expect(wrapper.emitted('activeIndex')).toEqual([[1], [null], [2], [null]])
      expect(wrapper.emitted('pointHover')).toEqual(wrapper.emitted('activeIndex'))
      expect(wrapper.find('.narduk-tooltip').exists()).toBe(false)
    },
  )

  it('clears on leaving the plot and ignores compatibility mouse duplicates', async () => {
    const { wrapper, svg } = pointerChart()
    await svg.trigger('pointermove', { clientX: 110, clientY: 50 })
    await svg.trigger('mousemove', { clientX: 110, clientY: 50 })
    await svg.trigger('pointermove', { clientX: 500, clientY: 50 })
    expect(wrapper.emitted('activeIndex')).toEqual([[1], [null]])
  })

  it('maps decimated indices back to the input arrays', async () => {
    const { wrapper, svg } = pointerChart({
      labels: ['A', 'B', 'C', 'D', 'E'],
      series: [{ name: 'Price', data: [0, 5, 10, 15, 20] }],
      maxRenderPoints: 3,
    })
    await svg.trigger('pointermove', { clientX: 110, clientY: 50 })
    expect(wrapper.emitted('activeIndex')).toEqual([[2]])
  })

  it('also exposes keyboard focus and clears it on blur', async () => {
    const { wrapper, svg } = pointerChart()
    await svg.trigger('focus')
    await svg.trigger('keydown', { key: 'ArrowRight' })
    await svg.trigger('blur')
    expect(wrapper.emitted('activeIndex')).toEqual([[1], [2], [null]])
  })

  it('does not commit a cancelled zoom drag', async () => {
    const { wrapper, svg } = pointerChart({ zoomable: true, zoomMinPoints: 1 })
    Object.assign(svg.element, { setPointerCapture: vi.fn(), releasePointerCapture: vi.fn() })
    await svg.trigger('pointerdown', { button: 0, pointerId: 1, clientX: 30, clientY: 50 })
    await svg.trigger('pointermove', { pointerId: 1, clientX: 150, clientY: 50 })
    await svg.trigger('pointercancel', { pointerId: 1 })
    expect(wrapper.emitted('zoom')).toBeUndefined()
    expect(wrapper.find('.narduk-zoom-box').exists()).toBe(false)
  })
})

const charts: Array<[string, Component]> = [
  ['line', NardukLineChart],
  ['bar', NardukBarChart],
]

describe.each(charts)('%s tick formatters', (_name, component) => {
  it('formats currency and categories, preferring the new names', () => {
    const wrapper = mount(component, {
      props: {
        ...base,
        formatYTick: (value: number) => `$${value.toFixed(2)}`,
        formatXTick: (label: string, index: number) => `${label}-${index}`,
        formatTickValue: () => 'legacy-value',
        formatXLabel: () => 'legacy-category',
      },
    })
    const labels = wrapper.findAll('.narduk-axis text').map(node => node.text())
    expect(labels).toContain('$0.00')
    expect(labels).toContain('$25.00')
    expect(labels).toContain('B-1')
    expect(labels).not.toContain('legacy-value')
    expect(labels).not.toContain('legacy-category')
    if (component === NardukLineChart) expect(labels).toContain('$12.50')
  })

  it('formats percentages and retains legacy callbacks', async () => {
    const wrapper = mount(component, {
      props: {
        ...base,
        yMax: 20,
        formatYTick: (value: number) => `${value}%`,
        formatXLabel: (label: string) => `legacy-${label}`,
        formatTickValue: () => 'legacy-value',
      },
    })
    expect(wrapper.findAll('.narduk-axis text').map(node => node.text())).toContain('20%')
    expect(wrapper.text()).toContain('legacy-B')
    await wrapper.setProps({ formatYTick: undefined })
    expect(wrapper.text()).toContain('legacy-value')
  })
})

it('formats both line Y axes and overrides time labels with formatXTick', () => {
  const wrapper = mount(NardukLineChart, {
    props: {
      ...base,
      dualYAxis: true,
      series: [...base.series, { name: 'Other', data: [100, 200, 300], yAxis: 'secondary' }],
      xAxisType: 'time',
      times: [0, 1000, 2000],
      formatTime: () => 'legacy-time',
      formatXTick: (label, index) => `${label}-${index}`,
      formatYTick: value => `$${value.toFixed(2)}`,
    },
  })
  const labels = wrapper.findAll('.narduk-axis text').map(node => node.text())
  expect(labels).toContain('$300.00')
  expect(labels).toContain('A-0')
  expect(labels).not.toContain('legacy-time')
})

it('keeps bar formatters tied to values and categories in horizontal orientation', () => {
  const wrapper = mount(NardukBarChart, {
    props: {
      ...base,
      orientation: 'horizontal',
      formatYTick: value => `${value}%`,
      formatXTick: label => `category-${label}`,
    },
  })
  const labels = wrapper.findAll('.narduk-axis text').map(node => node.text())
  expect(labels).toContain('25%')
  expect(labels).toContain('category-B')
})

describe('finished server render', () => {
  it.each([320, 720])('renders and hydrates the full line geometry at width %s', async width => {
    const props = { ...base, width }
    const html = await renderToString(createSSRApp(() => h(NardukLineChart, props)))
    const root = document.createElement('div')
    root.innerHTML = html
    const path = root.querySelector('.narduk-line-path')!
    expect(root.querySelector('svg')?.getAttribute('width')).toBe(String(width))
    expect(path.getAttribute('d')).toBe(`M0,200 L${width / 2},100 L${width},0`)
    expect(path.getAttribute('stroke-dashoffset')).toBe('0')
    const before = path.outerHTML
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1200)
    const captured = captureConsoleStreams()
    const app = createSSRApp(() => h(NardukLineChart, props))
    try {
      app.mount(root)
      await nextTick()
      expect(captured.warnings).toEqual([])
      expect(root.querySelector('.narduk-line-path')?.outerHTML).toBe(before)
      expect(root.querySelector('svg')?.getAttribute('width')).toBe(String(width))
    } finally {
      app.unmount()
      captured.restore()
    }
  })

  it('renders full bar geometry on the server', async () => {
    const html = await renderToString(createSSRApp(() => h(NardukBarChart, base)))
    const root = document.createElement('div')
    root.innerHTML = html
    const bars = root.querySelectorAll('.narduk-bar-rect')
    expect(bars).toHaveLength(3)
    expect(bars[2]?.getAttribute('height')).toBe('200')
    expect(root.querySelector('svg')?.getAttribute('width')).toBe('400')
  })

  it('positions fractional annotations between sample coordinates', async () => {
    const html = await renderToString(
      createSSRApp(() =>
        h(NardukLineChart, {
          ...base,
          annotations: [
            { type: 'point', xIndex: 1, y: 12.5 },
            { type: 'point', xIndex: 1.5, y: 18.75, label: 'Between' },
            { type: 'point', xIndex: 2, y: 25 },
          ],
        }),
      ),
    )
    const root = document.createElement('div')
    root.innerHTML = html
    const points = [...root.querySelectorAll('.narduk-ann-point')]
    expect(points.map(point => point.getAttribute('cx'))).toEqual(['200', '300', '400'])
    expect(points[1]?.getAttribute('cy')).toBe('50')
  })
})
