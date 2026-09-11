// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import NardukChartStack from './NardukChartStack.vue'

describe('NardukChartStack', () => {
  it('renders the stack wrapper and the default slot content', () => {
    const w = mount(NardukChartStack, {
      slots: { default: '<div class="pane">pane content</div>' },
    })
    expect(w.find('.narduk-chart-stack').exists()).toBe(true)
    expect(w.find('.pane').text()).toBe('pane content')
  })

  it('defaults the domain model to null when no v-model is bound', () => {
    const w = mount(NardukChartStack, {
      slots: {
        default: `<template #default="{ domain, domainModel }">
          <span class="d">{{ String(domain) }}</span>
          <span class="dm">{{ String(domainModel) }}</span>
        </template>`,
      },
    })
    expect(w.find('.d').text()).toBe('null')
    expect(w.find('.dm').text()).toBe('null')
  })

  it('forwards a bound domain prop into the default slot scope under both slot keys', async () => {
    const w = mount(NardukChartStack, {
      props: { domain: { start: 0, end: 100 } },
      slots: {
        default: `<template #default="{ domain, domainModel }">
          <span class="d">{{ domain?.start }}</span>
          <span class="dm">{{ domainModel?.end }}</span>
        </template>`,
      },
    })
    expect(w.find('.d').text()).toBe('0')
    expect(w.find('.dm').text()).toBe('100')

    await w.setProps({ domain: { start: 5, end: 50 } })
    expect(w.find('.d').text()).toBe('5')
    expect(w.find('.dm').text()).toBe('50')
  })
})
