// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { expect, it } from 'vitest'

import NeStatementHero from '../src/runtime/components/NeStatementHero.vue'

it('renders the current product fact with caller actions and media', () => {
  const wrapper = mount(NeStatementHero, {
    props: {
      eyebrow: 'Community radio',
      title: 'Miles Ahead, Miles Behind',
      description: 'With a local host.',
      marker: { label: 'On air now', state: 'current', detail: '5–7:30 PM · sample schedule' },
      links: [{ label: 'Listen', to: '/listen' }],
    },
    slots: { media: '<p>Show artwork</p>', default: '<p>Schedule source</p>' },
  })
  expect(wrapper.findAll('h1')).toHaveLength(1)
  expect(wrapper.get('h1').text()).toBe('Miles Ahead, Miles Behind')
  expect(wrapper.get('[data-state]').attributes('data-state')).toBe('current')
  expect(wrapper.text()).toContain('5–7:30 PM · sample schedule')
  expect(wrapper.get('a').attributes('href')).toBe('/listen')
  expect(wrapper.text()).toContain('Schedule source')
  expect(wrapper.text()).toContain('Show artwork')
})

it.each(['stale', 'unknown'] as const)(
  'names %s status in text, even with a misleading caller label',
  (state) => {
    const wrapper = mount(NeStatementHero, {
      props: { title: 'Last received show', marker: { state, label: 'Station schedule' } },
    })
    expect(wrapper.text()).toContain(state === 'stale' ? 'Last known' : 'Status unknown')
    expect(wrapper.find('.ne-statement-hero__actions').exists()).toBe(false)
    expect(wrapper.find('.ne-statement-hero__media').exists()).toBe(false)
  },
)

it('lets the app supply a stateful action in place of links', async () => {
  const wrapper = mount(NeStatementHero, {
    props: {
      title: 'Community radio',
      marker: { state: 'unknown', label: 'Schedule' },
      links: [{ label: 'Replaced' }],
    },
    slots: { actions: '<button aria-pressed="false">Play</button>' },
  })
  expect(wrapper.get('button').text()).toBe('Play')
  expect(wrapper.text()).not.toContain('Replaced')
  await wrapper.setProps({ marker: { state: 'current', label: 'On air now' } })
  expect(wrapper.text()).not.toContain('Status unknown')
})
