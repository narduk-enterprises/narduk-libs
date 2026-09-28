// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
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

describe('NardukPieChart keyboard focus (narduk-libs#1237)', () => {
  function mountPie(errorHandler?: (error: unknown) => void) {
    return mount(NardukPieChart, {
      attachTo: document.body,
      props: { data: sampleData(), width: 300, height: 300, animate: false },
      ...(errorHandler ? { global: { config: { errorHandler } } } : {}),
    })
  }

  it('moves focus to the next slice on ArrowRight', async () => {
    const w = mountPie()
    await nextTick()
    const slices = w.findAll('.narduk-pie-slice')

    await slices[0]!.trigger('keydown', { key: 'ArrowRight' })

    await vi.waitFor(() => {
      expect(document.activeElement).toBe(slices[1]!.element)
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
      const w = mountPie(errorHandler)
      await nextTick()

      await w.findAll('.narduk-pie-slice')[0]!.trigger('keydown', { key: 'ArrowRight' })

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
