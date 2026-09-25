// @vitest-environment happy-dom
/*
 * NeDetailView, mounted (narduk-libs#264): label / value / format / unit,
 * and a missing reading that never looks like zero.
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import NeDetailView from '../src/runtime/components/NeDetailView.vue'

import type { NeDetailViewProps } from '../src/index'

function render(props: NeDetailViewProps) {
  return mount(NeDetailView, { props })
}

describe('NeDetailView: a missing reading is not a zero', () => {
  it('prints a quantity through formatQuantity', () => {
    const wrapper = render({
      items: [{ format: 'quantity', label: 'Stage', unit: 'foot', value: 5 }],
    })
    expect(wrapper.find('[data-ne-detail-view]').exists()).toBe(true)
    expect(wrapper.text()).toContain('Stage')
    expect(wrapper.text()).toContain('5 ft')
    expect(wrapper.find('[data-ne-detail-unavailable]').exists()).toBe(false)
  })

  it('prints the unavailable message when the reading is missing', () => {
    const wrapper = render({
      items: [{ format: 'quantity', label: 'Stage', unit: 'foot', value: null }],
      unavailableMessage: 'No reading',
    })
    expect(wrapper.get('[data-ne-detail-unavailable]').text()).toContain('No reading')
    expect(wrapper.text()).not.toMatch(/\b0\b/)
    expect(wrapper.text()).not.toContain('—')
  })

  it('defaults a missing reading to the formatter empty placeholder', () => {
    const wrapper = render({ items: [{ label: 'Stage', value: undefined }] })
    expect(wrapper.get('[data-ne-detail-unavailable]').text()).toContain('—')
  })

  it('formats a grouped number with pinned en-US, not the host locale', () => {
    const wrapper = render({
      items: [{ format: 'number', label: 'Count', value: 1234 }],
    })
    expect(wrapper.text()).toContain('1,234')
  })

  it('formats money only when a currency is given', () => {
    const withCurrency = render({
      items: [{ currency: 'USD', format: 'money', label: 'Fee', value: 12.5 }],
    })
    expect(withCurrency.text()).toContain('$12.50')

    const missingCurrency = render({
      items: [{ format: 'money', label: 'Fee', value: 12.5 }],
      unavailableMessage: 'No reading',
    })
    expect(missingCurrency.get('[data-ne-detail-unavailable]').text()).toContain('No reading')
  })

  it('formats a date only in an explicit zone, never the host zone', () => {
    const wrapper = render({
      items: [{ format: 'date', label: 'Observed', value: '2026-03-08T08:30:00Z' }],
      timeZone: 'America/Chicago',
    })
    expect(wrapper.text()).toContain('Mar 8, 2026')
  })

  it('treats a date without a zone as unavailable rather than guessing one', () => {
    const wrapper = render({
      items: [{ format: 'date', label: 'Observed', value: '2026-03-08T08:30:00Z' }],
      unavailableMessage: 'No reading',
    })
    expect(wrapper.get('[data-ne-detail-unavailable]').text()).toContain('No reading')
  })

  it('passes a pre-formatted string through when no format is given', () => {
    const wrapper = render({ items: [{ label: 'Kind', value: 'Major flood' }] })
    expect(wrapper.text()).toContain('Major flood')
  })
})

/*
 * narduk-libs#875: "unavailable" means nothing renderable was reported, not
 * "the rendered text happens to equal the placeholder". A reported string
 * that reads like the placeholder is still a reported value.
 */
describe('NeDetailView: a reported value that reads like the placeholder', () => {
  it('keeps a reported string equal to the row placeholder available', () => {
    const wrapper = render({
      items: [
        { empty: 'N/A', label: 'Priority', value: 'N/A' },
        { empty: 'N/A', label: 'Owner', value: null },
      ],
    })
    const rows = wrapper.findAll('.ne-detail-view__row')
    expect(rows[0]!.attributes('data-ne-detail-unavailable')).toBeUndefined()
    expect(rows[0]!.get('dd').classes()).not.toContain('text-muted')
    expect(rows[1]!.attributes('data-ne-detail-unavailable')).toBe('true')
  })

  it('keeps a reported em dash available against the default placeholder', () => {
    const wrapper = render({ items: [{ label: 'Change', value: '—' }] })
    expect(wrapper.find('[data-ne-detail-unavailable]').exists()).toBe(false)
    expect(wrapper.text()).toContain('—')
  })

  it('still marks a present value its format cannot render as unavailable', () => {
    const wrapper = render({
      items: [
        { format: 'quantity', label: 'Stage', value: 5 },
        { format: 'number', label: 'Count', value: 'many' },
        { format: 'date', label: 'Seen', value: '2026-09-25' },
      ],
    })
    expect(wrapper.findAll('[data-ne-detail-unavailable]')).toHaveLength(3)
  })
})
