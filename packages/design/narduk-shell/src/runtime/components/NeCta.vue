<script setup lang="ts">
/**
 * NeCta — a call-to-action panel: an `<h2>` title, a description and buttons,
 * with an optional slot beside or below the text.
 *
 * A thin themed wrapper over Nuxt UI's `UPageCTA` (components backlog item
 * 21, narduk-libs#268). Every prop and slot is `UPageCTA`'s own, passed
 * through unchanged, including `variant` (`'outline'` by default, Nuxt UI's).
 * Nothing here is new behaviour.
 *
 * Theming: the panel is rounded to `--ne-radius-panel`, the suite's one panel
 * radius, instead of Nuxt UI's larger `rounded-xl` step, so a CTA and an
 * `NeCard` on the same page round alike. Surfaces, ink and the ring already
 * arrive through the `theme.css` bridge (`bg-default` is `--ne-surface`,
 * `bg-inverted` is `--ne-surface-inverted`, `ring-default` is
 * `--ne-hairline`). A caller's own `ui` classes merge after the suite's.
 *
 * Styling contract (narduk-ui guardrail 3, extended to the suite): token
 * reads only, no literal colour, radius, shadow or font.
 */
import UPageCTA from '@nuxt/ui/components/PageCTA.vue'
import { computed } from 'vue'

import { withNeClasses } from '../utils/slot-classes'

import type { NeCtaProps } from './ne-marketing-types'

const props = withDefaults(defineProps<NeCtaProps>(), {
  as: undefined,
  description: undefined,
  links: undefined,
  orientation: undefined,
  reverse: false,
  title: undefined,
  ui: undefined,
  variant: undefined,
})

defineSlots<{
  /** Between the description and the buttons. */
  body?(): unknown
  /** Inside the panel, below the container. */
  bottom?(): unknown
  /** Content beside (horizontal) or below (vertical) the text. */
  default?(): unknown
  /** Replaces the description text. */
  description?(): unknown
  /** Replaces the whole buttons row. */
  footer?(): unknown
  /** Replaces the whole title + description block. */
  header?(): unknown
  /** Replaces the buttons `links` renders. */
  links?(): unknown
  /** Replaces the title text, still inside the `<h2>`. */
  title?(): unknown
  /** Inside the panel, above the container — a background layer. */
  top?(): unknown
}>()

const NE_CTA_CLASSES = {
  root: 'rounded-[var(--ne-radius-panel)]',
}

const ui = computed(() => withNeClasses(NE_CTA_CLASSES, props.ui))
</script>

<template>
  <UPageCTA
    data-ne-cta
    :as="as"
    :title="title"
    :description="description"
    :links="links"
    :orientation="orientation"
    :reverse="reverse"
    :variant="variant"
    :ui="ui"
  >
    <!-- Forwarded only when the caller fills them: Nuxt UI decides whether
         to render a block from `!!slots.<name>`, so an always-forwarded
         empty slot would render empty wrappers. -->
    <template v-if="$slots.top" #top>
      <slot name="top" />
    </template>
    <template v-if="$slots.header" #header>
      <slot name="header" />
    </template>
    <template v-if="$slots.title" #title>
      <slot name="title" />
    </template>
    <template v-if="$slots.description" #description>
      <slot name="description" />
    </template>
    <template v-if="$slots.body" #body>
      <slot name="body" />
    </template>
    <template v-if="$slots.footer" #footer>
      <slot name="footer" />
    </template>
    <template v-if="$slots.links" #links>
      <slot name="links" />
    </template>
    <template v-if="$slots.default" #default>
      <slot />
    </template>
    <template v-if="$slots.bottom" #bottom>
      <slot name="bottom" />
    </template>
  </UPageCTA>
</template>
