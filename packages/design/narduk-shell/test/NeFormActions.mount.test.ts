// @vitest-environment happy-dom
/*
 * NeFormActions, mounted: one row, the buttons in the order they were written
 * (Cancel, then the primary last), and `#lead` in its own group before them.
 * The stacking below 40rem is CSS: NeFormActions.style.test.ts holds it.
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { h } from 'vue'

import NeFormActions from '../src/runtime/components/NeFormActions.vue'

const buttons = () => [
  h('button', { type: 'button' }, 'Cancel'),
  h('button', { type: 'submit' }, 'Save'),
]

describe('NeFormActions', () => {
  it('renders the buttons in source order, the primary last', () => {
    const wrapper = mount(NeFormActions, { slots: { default: buttons } })
    expect(wrapper.attributes('data-ne-form-actions')).toBeDefined()
    expect(wrapper.findAll('button').map((button) => button.text())).toEqual(['Cancel', 'Save'])
    expect(wrapper.find('.ne-form-actions__lead').exists()).toBe(false)
  })

  it('puts #lead in its own group, before the buttons', () => {
    const wrapper = mount(NeFormActions, {
      slots: { default: buttons, lead: () => h('button', { type: 'button' }, 'Delete') },
    })
    const lead = wrapper.get('.ne-form-actions__lead')
    expect(lead.findAll('button').map((button) => button.text())).toEqual(['Delete'])
    expect(wrapper.element.firstElementChild).toBe(lead.element)
    expect(wrapper.findAll('button').map((button) => button.text())).toEqual([
      'Delete',
      'Cancel',
      'Save',
    ])
  })

  it('passes a caller class to the row', () => {
    const wrapper = mount(NeFormActions, {
      attrs: { class: 'border-t pt-4' },
      slots: { default: buttons },
    })
    expect(wrapper.classes()).toEqual(expect.arrayContaining(['ne-form-actions', 'border-t']))
  })

  it('submits the form it sits in when the primary is type="submit"', async () => {
    let submitted = 0
    const wrapper = mount(
      {
        render: () =>
          h(
            'form',
            {
              onSubmit: (event: Event) => {
                event.preventDefault()
                submitted += 1
              },
            },
            [h(NeFormActions, null, { default: buttons })],
          ),
      },
      { attachTo: document.body },
    )
    await wrapper.get('button[type="submit"]').trigger('click')
    expect(submitted).toBe(1)
    await wrapper.get('button[type="button"]').trigger('click')
    expect(submitted).toBe(1)
    wrapper.unmount()
  })
})
