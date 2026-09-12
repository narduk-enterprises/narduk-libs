// @vitest-environment happy-dom
/*
 * Mount suite for NeForm — components backlog item 19 (narduk-libs#266).
 *
 * Mounts the REAL `@nuxt/ui` `Form`, `FormField`, `Input` and `Button`
 * components rather than stubs: `vitest.config.ts` already loads
 * `@nuxt/ui/vite`, which resolves the `#build/ui/*` and `#imports` virtuals
 * those SFCs import, so a hand-written stub would be less faithful than the
 * real thing for exactly the behaviour this suite exists to pin down —
 * UForm's own submit/validate/dirty machinery.
 *
 * Every test wires a real `UFormField`/`UInput` pair to reactive `state` via
 * a function slot (`slots: { default: () => h(...) }`), rather than a static
 * `slots: { default: '<template>...</template>' }` string: the failing bug
 * classes below (double-submit, dirty lies, lost focus) only reproduce
 * against real `input`/`change` events flowing through `useFormField` and
 * back into `state` — a static slot string never fires those.
 */
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { h, reactive } from 'vue'

import UButton from '@nuxt/ui/components/Button.vue'
import UFormField from '@nuxt/ui/components/FormField.vue'
import UInput from '@nuxt/ui/components/Input.vue'

import NeForm from '../src/runtime/components/NeForm.vue'
import type { NeFormProps } from '../src/runtime/components/NeForm.vue'

// `attachTo: document.body` is required for `document.activeElement` (the
// focus-on-error assertions) to update at all — an element that is never
// connected to `document` cannot become the active element in any DOM
// implementation. Every mounted wrapper is torn down in `afterEach` so two
// tests never collide on Vue's per-app `useId()` counter, which restarts at
// the same id (`v-1`) for the first field of every fresh app instance.
afterEach(() => {
  document.body.innerHTML = ''
})

function mountForm(props: Partial<NeFormProps> & { state: Record<string, unknown> }) {
  // Mounts NeForm directly (`mount(NeForm, { props, slots })`) rather than
  // through a wrapper `defineComponent`: the surface check
  // (scripts/check-component-surface.mjs) requires a literal `mount(NeForm…)`
  // call as its mount-test evidence, and a direct mount is simpler here too —
  // `state` is already the caller's own `reactive()` object, so passing it as
  // a prop keeps the same reactivity a wrapper's `setup()` would have given it.
  return mount(NeForm, {
    props: { ...props },
    slots: {
      default: () =>
        h(UFormField, { name: 'name', label: 'Name' }, () =>
          // `h()`'s overloads pick apart UInput's generic modelValue type more
          // strictly than a template binding would; a test file wiring a plain
          // string field is not the place to fight that generic.
          h(UInput, {
            modelValue: props.state.name,
            'onUpdate:modelValue': (value: string) => {
              props.state.name = value
            },
          } as never),
        ),
    },
    attachTo: document.body,
  })
}

describe('NeForm', () => {
  it('renders the default slot fields and a save button', () => {
    const wrapper = mountForm({ state: reactive({ name: '' }) })

    expect(wrapper.find('input').exists()).toBe(true)
    const button = wrapper.find('button[type="submit"]')
    expect(button.exists()).toBe(true)
    expect(button.text()).toBe('Save')
  })

  it('uses a custom save label', () => {
    const wrapper = mountForm({ state: reactive({ name: '' }), saveLabel: 'Update profile' })

    expect(wrapper.find('button[type="submit"]').text()).toBe('Update profile')
  })

  it('renders no "unsaved changes" note before any field is touched', () => {
    const wrapper = mountForm({ state: reactive({ name: '' }) })

    expect(wrapper.text()).not.toContain('Unsaved changes')
  })

  /*
   * stonx#37: a form with no reentrancy guard issues one submit per click,
   * not one per pixel of double-click travel. Two synchronous native
   * `submit` events, dispatched back to back, proved (against the real,
   * unguarded UForm) to reach `onSubmit` twice — see NeForm.vue's header
   * comment for the capture-phase guard this pins down.
   */
  it('issues exactly one onSubmit call for two rapid submits', async () => {
    const onSubmit = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    const wrapper = mountForm({ state: reactive({ name: 'Ada' }), onSubmit })

    const form = wrapper.get('form')
    await form.trigger('submit')
    await form.trigger('submit')
    await new Promise((resolve) => setTimeout(resolve, 40))

    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('re-enables submission for a later, separate save once the first resolves', async () => {
    const onSubmit = vi.fn(async () => {})
    const wrapper = mountForm({ state: reactive({ name: 'Ada' }), onSubmit })

    await wrapper.get('form').trigger('submit')
    await flushPromises()
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(onSubmit).toHaveBeenCalledTimes(2)
  })

  it('calls onSubmit with the validated data, from the real submitted Event', async () => {
    const onSubmit = vi.fn(async () => {})
    const wrapper = mountForm({ state: reactive({ name: 'Ada' }), onSubmit })

    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(onSubmit).toHaveBeenCalledWith({ name: 'Ada' })
  })

  /*
   * stonx#36: a save bar that flips to "saved" before the network call it is
   * reporting on has resolved is worse than no save bar. `dirty` is UForm's
   * own `dirty` (`!!dirtyFields.size`), read through the template ref, so it
   * only goes false once `dirtyFields.clear()` runs -- which UForm itself
   * places after `onSubmit` resolves without throwing.
   */
  it('shows dirty once a real field changes, and clears it only once submit resolves', async () => {
    const onSubmit = vi.fn(async () => {})
    const state = reactive({ name: '' })
    const wrapper = mountForm({ state, onSubmit })

    await wrapper.get('input').setValue('Ada')
    // useFormField's emitFormInput is debounced (0ms by default): a real
    // timer tick, not just a microtask flush, is needed for it to fire.
    await new Promise((resolve) => setTimeout(resolve, 10))
    await flushPromises()
    expect(wrapper.text()).toContain('Unsaved changes')

    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.text()).not.toContain('Unsaved changes')
  })

  it('leaves dirty true when the submit promise rejects, instead of clearing it optimistically', async () => {
    // UForm re-throws a non-validation rejection out of its own submit
    // wrapper (see Form.vue's onSubmitWrapper), which is unhandled at the
    // point nothing awaits it -- documented upstream behaviour, not a NeForm
    // bug. The listener below is this test's own, so vitest does not fail
    // the run over an error the test is deliberately provoking and asserting
    // on the effect of.
    let unhandled: unknown
    const onUnhandledRejection = (reason: unknown) => {
      unhandled = reason
    }
    process.on('unhandledRejection', onUnhandledRejection)

    const onSubmit = vi.fn(async () => {
      throw new Error('network down')
    })
    const state = reactive({ name: '' })
    const wrapper = mountForm({ state, onSubmit })

    await wrapper.get('input').setValue('Ada')
    await new Promise((resolve) => setTimeout(resolve, 10))
    await flushPromises()
    expect(wrapper.text()).toContain('Unsaved changes')

    await wrapper.get('form').trigger('submit')
    await new Promise((resolve) => setTimeout(resolve, 10))
    await flushPromises()

    expect(wrapper.text()).toContain('Unsaved changes')
    expect(unhandled).toBeInstanceOf(Error)

    process.off('unhandledRejection', onUnhandledRejection)
  })

  /*
   * stonx#350: a validation failure that leaves the reviewer scrolling to
   * find which field broke is a failure of its own. `id` on the thrown error
   * is the same id FormField put on the real <input>, so this reaches the
   * actual control.
   */
  it('blocks submit and focuses the first invalid field on a schema failure', async () => {
    const onSubmit = vi.fn()
    const wrapper = mountForm({
      state: reactive({ name: '' }),
      onSubmit,
      validate: () => [{ name: 'name', message: 'Name is required' }],
    })

    await wrapper.get('form').trigger('submit')
    await flushPromises()
    // The focus call is deferred a macrotask past the point UForm re-enables
    // the field -- see NeForm.vue's onFormError comment for why a microtask
    // flush alone is not late enough.
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(onSubmit).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(wrapper.get('input').element)
    expect(wrapper.text()).toContain('Name is required')
  })

  it('disables the form when the disabled prop is set', () => {
    const wrapper = mountForm({ state: reactive({ name: '' }), disabled: true })

    expect(wrapper.get('input').attributes('disabled')).toBeDefined()
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined()
  })

  it('renders the save bar as sticky only when stickySave is set', () => {
    const plain = mountForm({ state: reactive({ name: '' }) })
    expect(plain.get('.ne-form__save-bar').classes()).not.toContain('sticky')

    const sticky = mountForm({ state: reactive({ name: '' }), stickySave: true })
    expect(sticky.get('.ne-form__save-bar').classes()).toContain('sticky')
  })

  it('renders extra save-bar actions before the save button', () => {
    const state = reactive({ name: '' })
    const wrapper = mount(NeForm, {
      props: { state },
      slots: {
        default: () => h('div'),
        actions: () => h(UButton, { variant: 'ghost', label: 'Cancel' }),
      },
    })

    const buttons = wrapper.findAll('button')
    expect(buttons).toHaveLength(2)
    expect(buttons[0]?.text()).toBe('Cancel')
    expect(buttons[1]?.text()).toBe('Save')
  })
})
