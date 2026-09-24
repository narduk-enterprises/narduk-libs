/**
 * Stand-ins for the `@nuxt/ui` primitives the suite wraps.
 *
 * The real `UEmpty`, `USkeleton` and `UAlert` cannot be imported here: their
 * sources resolve `#build/ui/*` and `#imports`, virtual modules that only
 * exist inside a Nuxt build. In an app they arrive as globally registered
 * components, which is exactly how the suite's own SFCs address them, so the
 * faithful test double is a global registration too.
 *
 * Each stub renders the props the wrapper passes it, under a `data-stub`
 * attribute, so a test can assert that the title, description and icon
 * actually reached the primitive rather than asserting on Nuxt UI's markup.
 */
import { defineComponent, h } from 'vue'

import type { Component } from 'vue'

const UEmpty = defineComponent({
  name: 'UEmpty',
  props: {
    description: { default: '', type: String },
    icon: { default: '', type: String },
    title: { default: '', type: String },
  },
  setup(props, { slots }) {
    return () =>
      h('div', { 'data-stub': 'UEmpty', 'data-stub-icon': props.icon }, [
        h('h2', { 'data-stub-slot': 'title' }, props.title),
        h('p', { 'data-stub-slot': 'description' }, props.description),
        slots.default?.(),
      ])
  },
})

const USkeleton = defineComponent({
  name: 'USkeleton',
  setup(_props, { slots }) {
    return () => h('div', { 'data-stub': 'USkeleton' }, slots.default?.())
  },
})

const UCard = defineComponent({
  name: 'UCard',
  setup(_props, { attrs, slots }) {
    return () =>
      h('div', { 'data-stub': 'UCard', ...attrs }, [
        slots.header ? h('header', { 'data-stub-slot': 'header' }, slots.header()) : null,
        slots.default?.(),
        slots.footer ? h('footer', { 'data-stub-slot': 'footer' }, slots.footer()) : null,
      ])
  },
})

const UAlert = defineComponent({
  name: 'UAlert',
  props: {
    color: { default: '', type: String },
    description: { default: '', type: String },
    icon: { default: '', type: String },
    role: { default: undefined, type: String },
    title: { default: '', type: String },
    variant: { default: '', type: String },
  },
  setup(props, { slots }) {
    return () =>
      h(
        'div',
        {
          'data-stub': 'UAlert',
          'data-stub-color': props.color,
          'data-stub-icon': props.icon,
          role: props.role,
        },
        [
          h('strong', { 'data-stub-slot': 'title' }, props.title),
          h('p', { 'data-stub-slot': 'description' }, props.description),
          slots.default?.(),
        ],
      )
  },
})

/** Registered globally, exactly as `@nuxt/ui` registers the real ones. */
export const nuxtUiStubs: Record<string, Component> = { UAlert, UCard, UEmpty, USkeleton }
