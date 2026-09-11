/**
 * Faithful stand-ins for the two real `@nuxt/ui` components NePageHeader
 * wraps.
 *
 * The real `PageHeader.vue` and `Breadcrumb.vue` import Nuxt's `#imports`
 * and `#build/ui/*` virtual modules from inside their own `<script>` block
 * (confirmed by hand: importing `@nuxt/ui/components/PageHeader.vue`
 * directly under plain vitest throws `Missing "#imports" specifier in
 * "@nuxt/ui" package` before rendering anything) — those aliases exist only
 * inside a running Nuxt build, which this package deliberately does not
 * stand up for its tests (it ships raw SFCs with no build step; see
 * src/module.ts's comment on `build.transpile`).
 *
 * These stubs reproduce the one piece of each real component's DOM contract
 * that NePageHeader's own tests depend on — read from
 * node_modules/@nuxt/ui's `dist/runtime/components/{PageHeader,Breadcrumb}.vue`
 * on 2026-09-11 (@nuxt/ui 4.6.0, the version this workspace pins) — so the
 * mount and SSR tests verify NePageHeader's composition (title/headline/
 * description/links delegation, breadcrumb items reaching a real `nav`) and
 * not a black box. They are not used to verify Nuxt UI's own behaviour; that
 * is Nuxt UI's test suite's job.
 */
import { defineComponent, h } from 'vue'

import type { PropType } from 'vue'

export const UPageHeaderStub = defineComponent({
  name: 'PageHeader',
  props: {
    title: { type: String, required: false },
    headline: { type: String, required: false },
    description: { type: String, required: false },
  },
  setup(props, { slots }) {
    return () =>
      h('div', { 'data-slot': 'root' }, [
        props.headline || slots.headline
          ? h('div', { 'data-slot': 'headline' }, slots.headline ? slots.headline() : props.headline)
          : null,
        h('div', { 'data-slot': 'container' }, [
          h('div', { 'data-slot': 'wrapper' }, [
            props.title || slots.title
              ? h('h1', { 'data-slot': 'title' }, slots.title ? slots.title() : props.title)
              : null,
            slots.links ? h('div', { 'data-slot': 'links' }, slots.links()) : null,
          ]),
          props.description || slots.description
            ? h(
                'div',
                { 'data-slot': 'description' },
                slots.description ? slots.description() : props.description,
              )
            : null,
          slots.default ? slots.default() : null,
        ]),
      ])
  },
})

export interface StubBreadcrumbItem {
  label?: string
  to?: string
  icon?: string
}

export const UBreadcrumbStub = defineComponent({
  name: 'Breadcrumb',
  props: {
    items: { type: Array as PropType<StubBreadcrumbItem[]>, required: false, default: () => [] },
  },
  setup(props, { attrs }) {
    return () =>
      h(
        'nav',
        { 'aria-label': attrs['aria-label'] ?? 'breadcrumb', 'data-slot': 'root' },
        [
          h(
            'ol',
            { 'data-slot': 'list' },
            props.items.map((item) =>
              h('li', { 'data-slot': 'item' }, [
                item.to
                  ? h('a', { href: item.to }, item.label)
                  : h('span', {}, item.label),
              ]),
            ),
          ),
        ],
      )
  },
})
