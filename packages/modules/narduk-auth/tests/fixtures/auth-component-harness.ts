import { renderToString } from '@vue/server-renderer'
import { type ComponentMountingOptions, mount } from '@vue/test-utils'
import { type Component, createSSRApp, defineComponent, h } from 'vue'

const EMPTY = ''
const STUB_ATTR = 'data-stub'
const UPDATE_MODEL_VALUE = 'update:modelValue'

function passthrough(name: string) {
  return defineComponent({
    name,
    inheritAttrs: false,
    setup(_props, { slots, attrs }) {
      return () =>
        h('div', { ...attrs, [STUB_ATTR]: name }, [
          slots.header ? h('div', { 'data-slot': 'header' }, slots.header()) : null,
          slots.default?.(),
          slots.description ? h('div', { 'data-slot': 'description' }, slots.description()) : null,
          slots.footer ? h('div', { 'data-slot': 'footer' }, slots.footer()) : null,
        ])
    },
  })
}

const UAlert = defineComponent({
  name: 'UAlert',
  inheritAttrs: false,
  props: {
    description: { default: EMPTY, type: String },
    title: { default: EMPTY, type: String },
  },
  setup(props, { attrs, slots }) {
    return () =>
      h('div', { ...attrs, [STUB_ATTR]: 'UAlert' }, [
        props.title ? h('strong', props.title) : null,
        props.description ? h('p', props.description) : null,
        slots.description?.(),
        slots.default?.(),
      ])
  },
})

const UInput = defineComponent({
  name: 'UInput',
  props: {
    modelValue: { default: EMPTY, type: [String, Number] },
  },
  emits: [UPDATE_MODEL_VALUE],
  setup(props, { attrs, emit }) {
    return () =>
      h('input', {
        ...attrs,
        value: props.modelValue,
        onInput: (event: Event) => {
          emit(UPDATE_MODEL_VALUE, (event.target as HTMLInputElement).value)
        },
      })
  },
})

const UTextarea = defineComponent({
  name: 'UTextarea',
  props: {
    modelValue: { default: EMPTY, type: String },
  },
  emits: [UPDATE_MODEL_VALUE],
  setup(props, { attrs, emit }) {
    return () =>
      h('textarea', {
        ...attrs,
        value: props.modelValue,
        onInput: (event: Event) => {
          emit(UPDATE_MODEL_VALUE, (event.target as HTMLTextAreaElement).value)
        },
      })
  },
})

const USelectMenu = defineComponent({
  name: 'USelectMenu',
  props: {
    modelValue: { default: EMPTY, type: [String, Number] },
  },
  emits: [UPDATE_MODEL_VALUE],
  setup(props, { attrs }) {
    return () =>
      h('div', { ...attrs, [STUB_ATTR]: 'USelectMenu' }, String(props.modelValue ?? EMPTY))
  },
})

const UButton = defineComponent({
  name: 'UButton',
  props: {
    loading: { default: false, type: Boolean },
    to: { default: undefined, type: [String, Object] },
    type: { default: 'button', type: String },
  },
  setup(props, { attrs, slots }) {
    return () =>
      h(
        props.to === undefined ? 'button' : 'a',
        {
          ...attrs,
          'data-loading': props.loading ? 'true' : undefined,
          type: props.to === undefined ? props.type : undefined,
        },
        slots.default?.(),
      )
  },
})

const ULink = defineComponent({
  name: 'ULink',
  props: {
    to: { default: undefined, type: [String, Object] },
  },
  setup(props, { attrs, slots }) {
    return () =>
      h(
        'a',
        {
          ...attrs,
          href: typeof props.to === 'string' ? props.to : '#',
        },
        slots.default?.(),
      )
  },
})

/**
 * Real Nuxt UI `UForm` validates `state` against `schema` on submit and
 * invokes its `onSubmit` handler with the native submit event mutated to
 * carry the parsed result as `.data`
 * (`node_modules/@nuxt/ui/dist/runtime/components/Form.vue`,
 * `event.data = await _validate(...)`). A handler reading `event.data` (e.g.
 * `AuthApiKeysPanel.submitCreate`) got `undefined` from the previous stub,
 * which only emitted the raw DOM event — a bug latent only because nothing
 * exercised it (narduk-libs PR #282 review).
 */
const UForm = defineComponent({
  name: 'UForm',
  inheritAttrs: false,
  props: {
    schema: { default: undefined, type: null },
    state: { default: undefined, type: null },
  },
  emits: ['submit'],
  setup(props, { attrs, emit, slots }) {
    return () =>
      h(
        'form',
        {
          ...attrs,
          onSubmit: (event: Event) => {
            event.preventDefault()
            // Mutate the real native event (as `@submit.prevent`'s compiled
            // `withModifiers` wrapper calls `.preventDefault()` on whatever
            // this emits) rather than emitting a fresh `{ data }` object,
            // which has no `.preventDefault` and threw.
            const data = props.schema ? props.schema.parse(props.state) : props.state
            Object.assign(event, { data })
            emit('submit', event)
          },
        },
        slots.default?.(),
      )
  },
})

export const authUiComponents: Record<string, Component> = {
  AppCopyButton: passthrough('AppCopyButton'),
  UAlert,
  UBadge: passthrough('UBadge'),
  UButton,
  UCard: passthrough('UCard'),
  UForm,
  UFormField: passthrough('UFormField'),
  UIcon: passthrough('UIcon'),
  UInput,
  ULink,
  USelectMenu,
  UTextarea,
}

export function mountAuthCard(
  component: Component,
  options: ComponentMountingOptions<Component> = {},
) {
  return mount(component, {
    ...options,
    global: {
      ...options.global,
      components: {
        ...authUiComponents,
        ...options.global?.components,
      },
    },
  })
}

export function renderAuthCard(component: Component, props: Record<string, unknown> = {}) {
  const app = createSSRApp(component, props)
  for (const [name, stub] of Object.entries(authUiComponents)) {
    app.component(name, stub)
  }
  return renderToString(app)
}
