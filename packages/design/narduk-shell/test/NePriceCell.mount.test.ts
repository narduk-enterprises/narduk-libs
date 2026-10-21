// @vitest-environment happy-dom
/*
 * NePriceCell, mounted: a reserved width, formatted text, a tint that is data
 * on the element (colour is the stylesheet's), a live flash that clears, and an
 * unreported mark -- never a blank or a zero -- when there is no figure.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import NePriceCell from '../src/runtime/components/NePriceCell.vue'
import { priceCellText } from '../src/runtime/components/ne-price-cell-types'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('NePriceCell', () => {
  it('formats money, numbers and percentages', () => {
    const money = mount(NePriceCell, {
      props: { value: 1234.5, kind: 'money', currency: 'USD', digits: 2 },
    })
    expect(money.text()).toBe('$1,234.50')
    const number = mount(NePriceCell, { props: { value: 1234.5, digits: 1 } })
    expect(number.text()).toBe('1,234.5')
    const percent = mount(NePriceCell, { props: { value: 0.0123, kind: 'percent' } })
    expect(percent.text()).toBe('1.2%')
    const fromPercent = mount(NePriceCell, {
      props: { value: 5.5, kind: 'percent', input: 'percent' },
    })
    expect(fromPercent.text()).toBe('5.5%')
  })

  it('writes the sign when `signed`, so colour is never the only cue', () => {
    const props = { kind: 'money', currency: 'USD', digits: 2, signed: true } as const
    expect(mount(NePriceCell, { props: { ...props, value: 1.2 } }).text()).toBe('+$1.20')
    expect(mount(NePriceCell, { props: { ...props, value: -0.4 } }).text()).toBe('-$0.40')
    expect(mount(NePriceCell, { props: { ...props, value: 0 } }).text()).toBe('$0.00')
  })

  it('shows money without a currency as a plain number rather than guessing one', () => {
    const wrapper = mount(NePriceCell, { props: { value: 9.5, kind: 'money', digits: 2 } })
    expect(wrapper.text()).toBe('9.50')
  })

  it('reserves its width in ch, and is end-aligned unless told otherwise', () => {
    const wrapper = mount(NePriceCell, { props: { value: 1, chars: 12 } })
    expect(wrapper.attributes('style')).toContain('--ne-price-cell-chars: 12')
    expect(wrapper.attributes('data-align')).toBe('end')
    expect(mount(NePriceCell, { props: { value: 1 } }).attributes('style')).toContain(
      '--ne-price-cell-chars: 8',
    )
    expect(
      mount(NePriceCell, { props: { value: 1, align: 'start' } }).attributes('data-align'),
    ).toBe('start')
  })

  it('draws the unreported mark in the same slot for a missing figure', () => {
    for (const value of [null, undefined, Number.NaN]) {
      const wrapper = mount(NePriceCell, { props: { value, label: 'Last price' } })
      expect(wrapper.find('[data-testid="ne-absent"]').exists()).toBe(true)
      expect(wrapper.get('[role="img"]').attributes('aria-label')).toBe('Last price: not reported')
      expect(wrapper.text()).toBe('')
      expect(wrapper.attributes('data-tone')).toBeUndefined()
      expect(wrapper.attributes('style')).toContain('--ne-price-cell-chars')
    }
    expect(mount(NePriceCell, { props: { value: 0 } }).text()).toBe('0')
  })

  it('tints by sign, with nothing at zero', () => {
    const tone = (value: number) =>
      mount(NePriceCell, { props: { value, tint: 'sign' } }).attributes('data-tone')
    expect(tone(2)).toBe('up')
    expect(tone(-2)).toBe('down')
    expect(tone(0)).toBeUndefined()
    expect(
      mount(NePriceCell, { props: { value: 2, tint: 'none' } }).attributes('data-tone'),
    ).toBeUndefined()
  })

  it('flashes in the direction of a move, then settles; the first render has no tint', async () => {
    const wrapper = mount(NePriceCell, { props: { value: 100, tint: 'flash', flashMs: 500 } })
    expect(wrapper.attributes('data-tone')).toBeUndefined()

    await wrapper.setProps({ value: 100.5 })
    expect(wrapper.attributes('data-tone')).toBe('up')

    vi.advanceTimersByTime(499)
    await wrapper.vm.$nextTick()
    expect(wrapper.attributes('data-tone')).toBe('up')
    vi.advanceTimersByTime(1)
    await wrapper.vm.$nextTick()
    expect(wrapper.attributes('data-tone')).toBeUndefined()

    await wrapper.setProps({ value: 99 })
    expect(wrapper.attributes('data-tone')).toBe('down')
    // A new move restarts the clock rather than stacking timers.
    vi.advanceTimersByTime(300)
    await wrapper.setProps({ value: 98 })
    vi.advanceTimersByTime(300)
    await wrapper.vm.$nextTick()
    expect(wrapper.attributes('data-tone')).toBe('down')
    wrapper.unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not flash for an unchanged value or without tint="flash"', async () => {
    const flash = mount(NePriceCell, { props: { value: 100, tint: 'flash' } })
    await flash.setProps({ value: 100 })
    expect(flash.attributes('data-tone')).toBeUndefined()

    const none = mount(NePriceCell, { props: { value: 100 } })
    await none.setProps({ value: 101 })
    expect(none.attributes('data-tone')).toBeUndefined()
  })

  it('never changes its own box when it changes tone: a tone rule sets `color` and only `color`', () => {
    // mount() does not load scoped CSS, so the contract is read from the source.
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../src/runtime/components/NePriceCell.vue'),
      'utf8',
    )
    const rules = [...source.matchAll(/\[data-tone='[a-z]+'\]\s*\{([^}]*)\}/g)]
    expect(rules.length).toBeGreaterThanOrEqual(4)
    for (const [, body] of rules) {
      const properties = [...body!.matchAll(/([a-z-]+)\s*:/g)].map((match) => match[1])
      expect(properties).toEqual(['color'])
    }
    // And the transition names `color`, so a tone change animates nothing else.
    expect(source).toMatch(/transition:\s*color /)
    expect(source).toMatch(/font-variant-numeric:\s*tabular-nums/)
    expect(source).toMatch(/min-width:\s*calc\(var\(--ne-price-cell-chars\) \* 1ch\)/)
  })

  it('has a text helper for places that cannot mount a cell', () => {
    expect(priceCellText({ value: 3, kind: 'percent', input: 'percent' })).toBe('3.0%')
    expect(priceCellText({ value: null })).toBeUndefined()
  })
})
