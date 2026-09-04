// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import NardukPieChart from './NardukPieChart.vue'
import type { PieDataItem } from '../types'

function sampleData(): PieDataItem[] {
  return [
    { label: 'Chrome', value: 65 },
    { label: 'Firefox', value: 15 },
    { label: 'Safari', value: 12 },
    { label: 'Other', value: 8 },
  ]
}

describe('NardukPieChart consumer ergonomics (#9)', () => {
  it('emits sliceHover with the index on pointerenter and null on pointerleave', async () => {
    const w = mount(NardukPieChart, {
      props: { data: sampleData(), width: 300, height: 300, animate: false },
    })
    await nextTick()

    const slices = w.findAll('.narduk-pie-slice')
    expect(slices.length).toBe(4)

    await slices[1]!.trigger('pointerenter')
    expect(w.emitted('sliceHover')).toEqual([[1]])

    await slices[1]!.trigger('pointerleave')
    expect(w.emitted('sliceHover')).toEqual([[1], [null]])
  })

  it('defaults showLegend, showCenterLabel, and showTooltip to true (unchanged current behavior)', async () => {
    const w = mount(NardukPieChart, {
      attachTo: document.body,
      props: { data: sampleData(), width: 300, height: 300, animate: false, donut: true },
    })

    expect(w.find('.narduk-legend').exists()).toBe(true)
    expect(w.text()).toContain('Total')

    const svg = w.find('svg').element as SVGSVGElement
    svg.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 300,
      bottom: 300,
      width: 300,
      height: 300,
      toJSON: () => ({}),
    })
    await w.find('svg').trigger('mousemove', { clientX: 150, clientY: 40 })
    expect(w.find('.narduk-tooltip').exists()).toBe(true)
    w.unmount()
  })

  it('showLegend=false hides the built-in legend', () => {
    const w = mount(NardukPieChart, {
      props: { data: sampleData(), width: 300, height: 300, animate: false, showLegend: false },
    })
    expect(w.find('.narduk-legend').exists()).toBe(false)
  })

  it('showCenterLabel=false hides the donut center total/label', () => {
    const w = mount(NardukPieChart, {
      props: {
        data: sampleData(),
        width: 300,
        height: 300,
        animate: false,
        donut: true,
        showCenterLabel: false,
      },
    })
    expect(w.text()).not.toContain('Total')
  })

  it('showTooltip=false disables the built-in cursor tooltip', async () => {
    const w = mount(NardukPieChart, {
      attachTo: document.body,
      props: { data: sampleData(), width: 300, height: 300, animate: false, showTooltip: false },
    })

    const svg = w.find('svg').element as SVGSVGElement
    svg.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 300,
      bottom: 300,
      width: 300,
      height: 300,
      toJSON: () => ({}),
    })
    await w.find('svg').trigger('mousemove', { clientX: 150, clientY: 40 })
    expect(w.find('.narduk-tooltip').exists()).toBe(false)
    w.unmount()
  })
})
