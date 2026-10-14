// @vitest-environment happy-dom
/*
 * NeShowMore, mounted: "Show all N" for a list `useRowLimit` capped. It only
 * emits; the caller owns the state.
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import NeShowMore from '../src/runtime/components/NeShowMore.vue'
import { showMoreLabel, type NeShowMoreProps } from '../src/index'

function mountMore(props: NeShowMoreProps) {
  return mount(NeShowMore, { props })
}

describe('showMoreLabel', () => {
  it('counts the whole list and takes an optional noun', () => {
    expect(showMoreLabel(24)).toBe('Show all 24')
    expect(showMoreLabel('1,200', 'runners')).toBe('Show all 1,200 runners')
  })
})

describe('NeShowMore', () => {
  it('is a button reading "Show all <total>", with thousands formatted', () => {
    const wrapper = mountMore({ total: 1200 })
    expect(wrapper.element.tagName).toBe('BUTTON')
    expect(wrapper.text()).toBe('Show all 1,200')
    expect(wrapper.attributes('data-ne-show-more')).toBeDefined()
  })

  it('appends a noun, or is replaced by a label', () => {
    expect(mountMore({ total: 24, noun: 'runners' }).text()).toBe('Show all 24 runners')
    expect(mountMore({ total: 24, noun: 'runners', label: 'See every one' }).text()).toBe(
      'See every one',
    )
  })

  it('emits expand on click and nothing else', async () => {
    const wrapper = mountMore({ total: 24 })
    await wrapper.trigger('click')
    expect(wrapper.emitted('expand')).toHaveLength(1)
    expect(Object.keys(wrapper.emitted())).not.toContain('update:modelValue')
  })

  it('names the list it reveals', () => {
    expect(mountMore({ total: 24, controls: 'agenda' }).attributes('aria-controls')).toBe('agenda')
  })

  it('renders nothing once nothing is hidden, and always when hidden is omitted', () => {
    expect(mountMore({ total: 24, hidden: 0 }).find('button').exists()).toBe(false)
    expect(mountMore({ total: 24, hidden: 19 }).find('button').exists()).toBe(true)
    expect(mountMore({ total: 24 }).find('button').exists()).toBe(true)
  })

  it('passes a test id through to the button', () => {
    const wrapper = mount(NeShowMore, {
      props: { total: 3 },
      attrs: { 'data-testid': 'agenda-more' },
    })
    expect(wrapper.attributes('data-testid')).toBe('agenda-more')
  })
})
