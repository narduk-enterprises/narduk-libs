// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import NardukScatterChart from './NardukScatterChart.vue'

function baseProps() {
  return {
    series: [
      {
        name: 'Series A',
        points: [
          { x: 1, y: 2 },
          { x: 3, y: 4 },
        ],
      },
    ],
    width: 300,
    height: 150,
    animate: false,
  }
}

describe('NardukScatterChart', () => {
  it('renders one point per series entry, positioned within the plot', () => {
    const w = mount(NardukScatterChart, { props: baseProps() })
    const points = w.findAll('.narduk-scatter-point')
    expect(points).toHaveLength(2)
    for (const p of points) {
      expect(Number.isFinite(Number(p.attributes('cx')))).toBe(true)
      expect(Number.isFinite(Number(p.attributes('cy')))).toBe(true)
    }
  })

  it('labels each point with its series name and formatted x, y for assistive tech', () => {
    const w = mount(NardukScatterChart, { props: baseProps() })
    const points = w.findAll('.narduk-scatter-point')
    expect(points[0]!.attributes('aria-label')).toBe('Series A 1, 2')
    expect(points[1]!.attributes('aria-label')).toBe('Series A 3, 4')
  })

  it('uses an explicit per-series color over the built-in palette', () => {
    const w = mount(NardukScatterChart, {
      props: {
        series: [{ name: 'S', points: [{ x: 1, y: 1 }], color: '#123456' }],
        width: 300,
        height: 150,
        animate: false,
      },
    })
    expect(w.find('.narduk-scatter-point').attributes('fill')).toBe('#123456')
  })

  it('emits pointClick with the series name, index and value on click', async () => {
    const w = mount(NardukScatterChart, { props: baseProps() })
    await w.findAll('.narduk-scatter-point')[1]!.trigger('click')
    expect(w.emitted('pointClick')).toEqual([
      [{ seriesName: 'Series A', pointIndex: 1, x: 3, y: 4 }],
    ])
  })

  it('emits pointClick on Enter and Space keyboard activation, not on other keys', async () => {
    const w = mount(NardukScatterChart, { props: baseProps() })
    const point = w.findAll('.narduk-scatter-point')[0]!
    await point.trigger('keydown', { key: 'Tab' })
    expect(w.emitted('pointClick')).toBeUndefined()
    await point.trigger('keydown', { key: 'Enter' })
    expect(w.emitted('pointClick')).toHaveLength(1)
    await point.trigger('keydown', { key: ' ' })
    expect(w.emitted('pointClick')).toHaveLength(2)
  })

  it('shows a "No data" placeholder and no plot when every series is empty', () => {
    const w = mount(NardukScatterChart, {
      props: { series: [{ name: 'Empty', points: [] }], width: 300, height: 150 },
    })
    expect(w.find('.narduk-chart__empty').text()).toBe('No data')
    expect(w.find('svg').exists()).toBe(false)
  })

  it('falls back to a generated accessible name built from series names when chartTitle is unset', () => {
    const w = mount(NardukScatterChart, { props: baseProps() })
    expect(w.find('svg title').text()).toBe('Scatter chart: Series A')
    expect(w.find('[role="group"]').attributes('aria-label')).toBe('Scatter chart: Series A')
  })

  it('uses chartTitle as the visible caption and the accessible name when provided', () => {
    const w = mount(NardukScatterChart, {
      props: { ...baseProps(), chartTitle: 'Custom title' },
    })
    expect(w.find('.narduk-chart__title').text()).toBe('Custom title')
    expect(w.find('svg title').text()).toBe('Custom title')
    expect(w.find('[role="group"]').attributes('aria-labelledby')).toBeDefined()
    expect(w.find('[role="group"]').attributes('aria-label')).toBeUndefined()
  })
})
