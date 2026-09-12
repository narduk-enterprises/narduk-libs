// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import NardukBrandBackdrop from './NardukBrandBackdrop.vue'

describe('NardukBrandBackdrop', () => {
  it('renders as a decorative, non-interactive full-bleed layer with no props required', () => {
    const w = mount(NardukBrandBackdrop)
    const root = w.find('div')
    expect(root.attributes('aria-hidden')).toBe('true')
    expect(root.classes()).toContain('pointer-events-none')
  })

  it('renders a slice-fit SVG sized to its own fixed 1200x640 canvas', () => {
    const w = mount(NardukBrandBackdrop)
    const svg = w.find('svg')
    expect(svg.attributes('viewBox')).toBe('0 0 1200 640')
    expect(svg.attributes('preserveAspectRatio')).toBe('xMidYMid slice')
  })

  it('draws the grid, trend lines and candle hints keyed to the chart CSS tokens', () => {
    const w = mount(NardukBrandBackdrop)
    expect(w.findAll('polyline')).toHaveLength(2)
    expect(w.find('pattern#narduk-brand-grid').exists()).toBe(true)
    expect(w.find('pattern#narduk-brand-grid-major').exists()).toBe(true)
    expect(w.find('linearGradient#narduk-brand-backdrop-fade').exists()).toBe(true)
  })
})
