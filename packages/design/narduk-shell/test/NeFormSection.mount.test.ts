// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import NeFormSection from '../src/runtime/components/NeFormSection.vue'

describe('NeFormSection', () => {
  it('renders the title as an h3 by default', () => {
    const wrapper = mount(NeFormSection, { props: { title: 'Profile' } })

    const heading = wrapper.find('h3')
    expect(heading.exists()).toBe(true)
    expect(heading.text()).toBe('Profile')
  })

  it('renders a description below the title', () => {
    const wrapper = mount(NeFormSection, {
      props: { title: 'Profile', description: 'Your public account details.' },
    })

    expect(wrapper.text()).toContain('Your public account details.')
  })

  it('renders the default slot content, for the section fields', () => {
    const wrapper = mount(NeFormSection, {
      props: { title: 'Profile' },
      slots: { default: '<div data-testid="field">A field</div>' },
    })

    expect(wrapper.find('[data-testid="field"]').exists()).toBe(true)
  })

  it('renders actions next to the title, not inside the heading', () => {
    const wrapper = mount(NeFormSection, {
      props: { title: 'Profile' },
      slots: { actions: '<button type="button">Reset</button>' },
    })

    expect(wrapper.find('h3').find('button').exists()).toBe(false)
    expect(wrapper.find('button').text()).toBe('Reset')
  })

  it('honours an explicit heading level override', () => {
    const wrapper = mount(NeFormSection, { props: { title: 'Profile', as: 'h2' } })

    expect(wrapper.find('h2').exists()).toBe(true)
    expect(wrapper.find('h3').exists()).toBe(false)
  })
})
