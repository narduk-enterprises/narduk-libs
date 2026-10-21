// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { expect, it } from 'vitest'

import NeTimelineHero from '../src/runtime/components/NeTimelineHero.vue'

const headline = { subject: 'Texas', verb: 'paid', value: '$200B' }

it('renders one data-led h1 and emits a controlled selection from real Nuxt UI buttons', async () => {
  const wrapper = mount(NeTimelineHero, {
    props: {
      ...headline,
      modelValue: '2025',
      periods: [
        { id: '2024', label: 'FY24', value: 100, valueLabel: '$100B' },
        { id: '2025', label: 'FY25', value: 200, valueLabel: '$200B', partial: true },
      ],
    },
    slots: { source: 'Sample data', media: '<p>Caller media</p>' },
  })
  expect(wrapper.findAll('h1')).toHaveLength(1)
  expect(wrapper.get('h1').text()).toContain('Texas paid $200B')
  const buttons = wrapper.findAll('button')
  expect(buttons.map((button) => button.attributes('aria-pressed'))).toEqual(['false', 'true'])
  expect(buttons[1]!.attributes('aria-label')).toBe('FY25, $200B, partial period')
  expect(wrapper.findAll('.ne-timeline-hero__bar').map((bar) => bar.attributes('style'))).toEqual([
    'height: 50%;',
    'height: 100%;',
  ])
  expect(wrapper.text()).toContain('Partial')
  await buttons[0]!.trigger('click')
  expect(wrapper.emitted('update:modelValue')).toEqual([['2024']])
  expect(buttons[1]!.attributes('aria-pressed')).toBe('true')
  await wrapper.setProps({ modelValue: '2024', value: '$100B' })
  expect(buttons[0]!.attributes('aria-pressed')).toBe('true')
  expect(wrapper.get('h1').text()).toContain('$100B')
  expect(wrapper.text()).toContain('Sample data')
  expect(wrapper.text()).toContain('Caller media')
})

it('distinguishes zero from missing and invalid quantities without inventing a magnitude', () => {
  const wrapper = mount(NeTimelineHero, {
    props: {
      ...headline,
      value: null,
      periods: [
        { id: 'zero', label: 'Zero', value: 0 },
        { id: 'missing', label: 'Missing', value: null, valueLabel: '$99' },
        { id: 'negative', label: 'Invalid', value: -1 },
        { id: 'nan', label: 'NaN', value: Number.NaN },
        { id: 'infinite', label: 'Infinity', value: Number.POSITIVE_INFINITY },
      ],
    },
  })
  expect(wrapper.get('h1').text()).toContain('Not reported')
  expect(wrapper.findAll('.ne-timeline-hero__gap')).toHaveLength(4)
  expect(wrapper.get('.ne-timeline-hero__bar').attributes('style')).toBe('height: 0%;')
  expect(wrapper.findAll('button')[0]!.attributes('aria-label')).toBe('Zero, 0')
  expect(wrapper.findAll('button')[1]!.attributes('aria-label')).toBe('Missing, Not reported')
  expect(wrapper.text()).not.toContain('$99')
})

it('renders an honest empty collection', () => {
  const wrapper = mount(NeTimelineHero, { props: { ...headline, periods: [] } })
  expect(wrapper.findAll('button')).toHaveLength(0)
  expect(wrapper.text()).toContain('No periods reported.')
  expect(wrapper.find('.ne-timeline-hero__media').exists()).toBe(false)
})
