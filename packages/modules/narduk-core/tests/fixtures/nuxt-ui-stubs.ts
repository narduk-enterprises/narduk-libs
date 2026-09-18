/**
 * Stand-ins for the `@nuxt/ui` primitives the shared media components wrap.
 * The real `UButton` / `USkeleton` resolve `#build/ui/*` and `#imports`.
 */
import { defineComponent, h } from 'vue'

import type { Component } from 'vue'

const UButton = defineComponent({
  name: 'UButton',
  inheritAttrs: false,
  props: {
    color: { default: '', type: String },
    disabled: { default: false, type: Boolean },
    icon: { default: '', type: String },
    label: { default: '', type: String },
    size: { default: '', type: String },
    variant: { default: '', type: String },
  },
  setup(props, { attrs, slots }) {
    return () =>
      h(
        'button',
        {
          ...attrs,
          type: 'button',
          disabled: props.disabled,
          'data-stub': 'UButton',
          'data-icon': props.icon,
        },
        [props.label, slots.default?.()],
      )
  },
})

const USkeleton = defineComponent({
  name: 'USkeleton',
  inheritAttrs: false,
  setup(_props, { attrs, slots }) {
    return () => h('div', { ...attrs, 'data-stub': 'USkeleton' }, slots.default?.())
  },
})

export const nuxtUiStubs: Record<string, Component> = { UButton, USkeleton }
