// @vitest-environment happy-dom
/*
 * Mount suite for NeSettingsPage — components backlog item 19
 * (narduk-libs#266). NeSettingsPage is composition over NePageHeader and
 * NeForm; the bug-class tests (double-submit, dirty, focus-on-error) already
 * live in NeForm.mount.test.ts and are not repeated here. This suite proves
 * only the composition: the page title renders, the save bar is sticky by
 * default, fields pass through, and submit reaches the caller's handler.
 */
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, reactive } from 'vue'

import UFormField from '@nuxt/ui/components/FormField.vue'
import UInput from '@nuxt/ui/components/Input.vue'

import NeSettingsPage from '../src/runtime/components/NeSettingsPage.vue'
import NeFormSection from '../src/runtime/components/NeFormSection.vue'

afterEach(() => {
  document.body.innerHTML = ''
})

describe('NeSettingsPage', () => {
  it('renders the page title as a single h1', () => {
    const wrapper = mount(NeSettingsPage, {
      props: { title: 'Settings', state: reactive({ name: '' }) },
    })

    const headings = wrapper.findAll('h1')
    expect(headings).toHaveLength(1)
    expect(headings[0]?.text()).toBe('Settings')
  })

  it('renders the page description', () => {
    const wrapper = mount(NeSettingsPage, {
      props: {
        title: 'Settings',
        description: 'Manage your account.',
        state: reactive({ name: '' }),
      },
    })

    expect(wrapper.text()).toContain('Manage your account.')
  })

  it('makes the save bar sticky by default, unlike a standalone NeForm', () => {
    const wrapper = mount(NeSettingsPage, {
      props: { title: 'Settings', state: reactive({ name: '' }) },
    })

    expect(wrapper.get('.ne-form__save-bar').classes()).toContain('sticky')
  })

  it('renders a NeFormSection passed in the default slot, with its field', () => {
    const state = reactive({ name: 'Ada' })
    const wrapper = mount(
      defineComponent({
        setup() {
          return () =>
            h(
              NeSettingsPage,
              { title: 'Settings', state },
              {
                default: () =>
                  h(NeFormSection, { title: 'Profile' }, () =>
                    h(UFormField, { name: 'name', label: 'Name' }, () =>
                      // See NeForm.mount.test.ts's mountForm for why this is cast:
                      // h()'s overloads fight UInput's generic modelValue type.
                      h(UInput, {
                        modelValue: state.name,
                        'onUpdate:modelValue': (value: string) => {
                          state.name = value
                        },
                      } as never),
                    ),
                  ),
              },
            )
        },
      }),
    )

    expect(wrapper.find('h3').text()).toBe('Profile')
    expect(wrapper.get('input').element.value).toBe('Ada')
  })

  it('forwards submit to the caller, with the validated data', async () => {
    const onSubmit = vi.fn(async () => {})
    const state = reactive({ name: 'Ada' })
    const wrapper = mount(NeSettingsPage, { props: { title: 'Settings', state, onSubmit } })

    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(onSubmit).toHaveBeenCalledWith({ name: 'Ada' })
  })

  it('renders extra actions next to the page title, distinct from the save bar', () => {
    const wrapper = mount(
      defineComponent({
        setup() {
          const state = reactive({ name: '' })
          return () =>
            h(
              NeSettingsPage,
              { title: 'Settings', state },
              { headerActions: () => h('button', { type: 'button' }, 'Export') },
            )
        },
      }),
    )

    const heading = wrapper.get('h1')
    const button = wrapper.get('button[type="button"]')
    expect(button.text()).toBe('Export')
    expect(
      heading.element.compareDocumentPosition(button.element) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })
})
