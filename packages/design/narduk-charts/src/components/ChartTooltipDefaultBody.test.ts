// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ChartTooltipDefaultBody from './ChartTooltipDefaultBody.vue'

describe('ChartTooltipDefaultBody', () => {
  it('renders title and items under a single root', () => {
    const w = mount(ChartTooltipDefaultBody, {
      props: {
        title: '09-09 11:48',
        items: [{ color: '#123456', label: 'Stage', value: '4.2 ft' }],
      },
    })
    expect(w.element.matches('.narduk-tooltip__title')).toBe(false)
    expect(w.element.querySelectorAll(':scope > .narduk-tooltip__title')).toHaveLength(1)
    expect(w.element.querySelectorAll(':scope > .narduk-tooltip__item')).toHaveLength(1)
    expect(w.find('.narduk-tooltip__title').text()).toBe('09-09 11:48')
    expect(w.find('.narduk-tooltip__label').text()).toBe('Stage')
    expect(w.find('.narduk-tooltip__value').text()).toBe('4.2 ft')
  })
})
