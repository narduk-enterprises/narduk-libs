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

    const tickTexts = w.findAll('.narduk-axis text')
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
      x: 0, y: 0, left: 0, top: 0, right: 240, bottom: 120, width: 240, height: 120, toJSON: () => ({}),
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
      x: 0, y: 0, left: 0, top: 0, right: 240, bottom: 120, width: 240, height: 120, toJSON: () => ({}),
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
