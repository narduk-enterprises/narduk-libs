// @vitest-environment happy-dom
/*
 * NeAdminEditPage, mounted — components backlog item 20 (narduk-libs#267).
 *
 * Composition over NePageHeader + NeStatePanel + NeForm. NeForm's bug-class
 * proofs (double-submit, honest dirty state, focus-on-error) live in
 * NeForm.mount.test.ts and are inherited, not repeated; this suite proves the
 * composition: the header, the loading gate in front of the form, the submit
 * path, and the cancel action.
 */
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, reactive, type Component, type VNode } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'

import UFormField from '@nuxt/ui/components/FormField.vue'
import UInput from '@nuxt/ui/components/Input.vue'

import NeAdminEditPage from '../src/runtime/components/NeAdminEditPage.vue'
import NeFormSection from '../src/runtime/components/NeFormSection.vue'
import { nuxtUiStubs } from './nuxt-ui-stubs'

import type { NeAdminEditPageProps } from '../src/index'

const Blank: Component = defineComponent({ setup: () => () => h('div') })

const mounted: VueWrapper[] = []

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
  document.body.innerHTML = ''
})

function render(
  props: Partial<NeAdminEditPageProps> = {},
  slots: Record<string, () => VNode | VNode[] | string> = {},
) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:pathMatch(.*)*', component: Blank }],
  })
  const wrapper = mount(NeAdminEditPage, {
    attachTo: document.body,
    global: { components: nuxtUiStubs, plugins: [router] },
    props: { state: reactive({ name: 'runner-01' }), title: 'Edit runner', ...props },
    slots,
  })
  mounted.push(wrapper)
  return wrapper
}

describe('NeAdminEditPage', () => {
  it('renders the title as the one h1, with the eyebrow and breadcrumbs', () => {
    const wrapper = render({
      breadcrumbs: [{ label: 'Runners', to: '/admin/runners' }, { label: 'runner-01' }],
      eyebrow: 'Admin',
    })

    const headings = wrapper.findAll('h1')
    expect(headings).toHaveLength(1)
    expect(headings[0]?.text()).toBe('Edit runner')
    expect(wrapper.text()).toContain('Admin')
    expect(wrapper.findAll('nav[aria-label="Breadcrumb"]')).toHaveLength(1)
    expect(wrapper.find('[data-ne-admin-edit-page]').exists()).toBe(true)
  })

  it('renders the fields in a sticky-save NeForm', () => {
    const state = reactive({ name: 'runner-01' })
    const wrapper = render(
      { state },
      {
        default: () =>
          h(NeFormSection, { title: 'General' }, () =>
            h(UFormField, { label: 'Name', name: 'name' }, () =>
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

    expect(wrapper.get('h3').text()).toBe('General')
    expect(wrapper.get('input').element.value).toBe('runner-01')
    expect(wrapper.get('.ne-form__save-bar').classes()).toContain('sticky')
  })

  it('lets stickySave be turned off for a short form', () => {
    const wrapper = render({ stickySave: false })
    expect(wrapper.get('.ne-form__save-bar').classes()).not.toContain('sticky')
  })

  it('forwards submit to the caller with the validated data', async () => {
    const onSubmit = vi.fn(async () => {})
    const wrapper = render({ onSubmit, saveLabel: 'Save runner' })

    expect(wrapper.get('button[type="submit"]').text()).toBe('Save runner')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(onSubmit).toHaveBeenCalledWith({ name: 'runner-01' })
  })

  it('renders a cancel button in the save bar that calls onCancel', async () => {
    const onCancel = vi.fn()
    const onSubmit = vi.fn()
    const wrapper = render({ cancelLabel: 'Discard', onCancel, onSubmit })

    const cancel = wrapper.get('.ne-form__save-bar [data-ne-admin-cancel]')
    expect(cancel.text()).toBe('Discard')
    expect(cancel.attributes('type')).toBe('button')
    await cancel.trigger('click')
    await flushPromises()

    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('renders cancelTo as a real link back', async () => {
    const wrapper = render({ cancelTo: '/admin/runners/r1' })
    await flushPromises()

    expect(wrapper.get('a[data-ne-admin-cancel]').attributes('href')).toBe('/admin/runners/r1')
  })

  it('renders no cancel action when neither onCancel nor cancelTo is given', () => {
    const wrapper = render()
    expect(wrapper.find('[data-ne-admin-cancel]').exists()).toBe(false)
  })

  it('holds the form back behind the loading panel while the record is pending', () => {
    const wrapper = render({ loadingTitle: 'Loading runner', status: 'pending' })

    expect(wrapper.find('form').exists()).toBe(false)
    expect(wrapper.find('[aria-busy="true"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('Loading runner')
  })

  it('holds the form back behind the error panel when the record did not load', () => {
    const wrapper = render({ errorTitle: 'Runner did not load', status: 'error' })

    expect(wrapper.find('form').exists()).toBe(false)
    expect(wrapper.text()).toContain('Runner did not load')
  })

  it('renders header actions and save-bar actions in their own places', () => {
    const wrapper = render(
      {},
      {
        actions: () => h('button', { 'data-bar-extra': '', type: 'button' }, 'Save draft'),
        headerActions: () => h('a', { 'data-header-extra': '' }, 'View'),
      },
    )

    expect(wrapper.get('.ne-form__save-bar [data-bar-extra]').text()).toBe('Save draft')
    expect(wrapper.find('.ne-form__save-bar [data-header-extra]').exists()).toBe(false)
    expect(wrapper.get('[data-header-extra]').text()).toBe('View')
  })
})
