// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import NardukHistogramChart from './NardukHistogramChart.vue'

describe('NardukHistogramChart', () => {
  it('renders one bar per explicit bin, labeled with its range and count', () => {
    const w = mount(NardukHistogramChart, {
      props: {
        // `values` still gates the empty state even when `bins` fully determines
        // the rendered bars — it only needs to be non-empty here.
        values: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
        bins: [
          { start: 0, end: 5, count: 3 },
          { start: 5, end: 10, count: 7 },
        ],
        width: 300,
        height: 150,
        animate: false,
      },
    })
    const bars = w.findAll('.narduk-hist-bar')
    expect(bars).toHaveLength(2)
    expect(bars[0]!.attributes('aria-label')).toBe('0.00–5.00, count 3')
    expect(bars[1]!.attributes('aria-label')).toBe('5.00–10.00, count 7')
  })

  it('computes bins from values via the default bin count when bins is not given', () => {
    const w = mount(NardukHistogramChart, {
      props: {
        values: [0, 1, 2, 3, 4, 5, 6, 7],
        binCount: 4,
        width: 300,
        height: 150,
        animate: false,
      },
    })
    const bars = w.findAll('.narduk-hist-bar')
    expect(bars).toHaveLength(4)
    for (const bar of bars) {
      expect(bar.attributes('aria-label')).toContain('count 2')
    }
  })

  it('ignores binCount and values-derived binning once an explicit bins array is given', () => {
    const w = mount(NardukHistogramChart, {
      props: {
        values: Array.from({ length: 100 }, (_, i) => i),
        binCount: 20,
        bins: [{ start: 0, end: 100, count: 100 }],
        width: 300,
        height: 150,
        animate: false,
      },
    })
    expect(w.findAll('.narduk-hist-bar')).toHaveLength(1)
  })

  it('defaults bar fill to the chart accent token, overridable via barColor', () => {
    const values = [1, 2, 3]
    const withoutColor = mount(NardukHistogramChart, {
      props: { values, width: 300, height: 150, animate: false },
    })
    expect(withoutColor.find('.narduk-hist-bar').attributes('fill')).toBe(
      'var(--color-chart-accent, #6366f1)',
    )

    const withColor = mount(NardukHistogramChart, {
      props: { values, barColor: '#ff0000', width: 300, height: 150, animate: false },
    })
    for (const bar of withColor.findAll('.narduk-hist-bar')) {
      expect(bar.attributes('fill')).toBe('#ff0000')
    }
  })

  it('shows a "No data" placeholder and no plot when values is empty', () => {
    const w = mount(NardukHistogramChart, {
      props: { values: [], width: 300, height: 150 },
    })
    expect(w.find('.narduk-chart__empty').text()).toBe('No data')
    expect(w.find('svg').exists()).toBe(false)
  })

  it('falls back to a generated accessible name built from the bin count when chartTitle is unset', () => {
    const w = mount(NardukHistogramChart, {
      props: {
        values: [1, 2, 3],
        bins: [
          { start: 0, end: 1, count: 1 },
          { start: 1, end: 2, count: 2 },
          { start: 2, end: 3, count: 3 },
        ],
        width: 300,
        height: 150,
        animate: false,
      },
    })
    expect(w.find('svg title').text()).toBe('Histogram, 3 bins')
    expect(w.find('[role="group"]').attributes('aria-label')).toBe('Histogram, 3 bins')
  })

  it('uses chartTitle as the visible caption and the accessible name when provided', () => {
    const w = mount(NardukHistogramChart, {
      props: {
        values: [1, 2, 3],
        chartTitle: 'Response times',
        width: 300,
        height: 150,
        animate: false,
      },
    })
    expect(w.find('.narduk-chart__title').text()).toBe('Response times')
    expect(w.find('svg title').text()).toBe('Response times')
  })
})
