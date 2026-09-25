<script setup lang="ts">
/**
 * NeHero — the top section of a landing page: headline, the page's `<h1>`,
 * description, call-to-action buttons, and an optional media slot beside or
 * below the text.
 *
 * A thin themed wrapper over Nuxt UI's `UPageHero` (components backlog item
 * 21, narduk-libs#268). Every prop and slot is `UPageHero`'s own, passed
 * through unchanged; nothing here is new behaviour. What the wrapper adds is
 * the suite's look where the `theme.css` bridge does not already reach:
 *
 * - the headline reads `--ne-accent` instead of Nuxt UI's `primary` alias,
 *   because the eyebrow is brand chrome, which is what the accent hook is;
 * - the title's tracking reads `--ne-tracking-tight`.
 *
 * Surfaces, ink and borders already arrive through the bridge
 * (`text-highlighted` is `--ne-ink`, `text-muted` is `--ne-ink-muted`), so
 * restating them here would be a second source of truth. A caller's own `ui`
 * classes merge after the suite's and win a conflict.
 *
 * `UPageHero` always renders the title as an `<h1>`: use one `NeHero` per page.
 *
 * Styling contract (narduk-ui guardrail 3, extended to the suite): token
 * reads only, no literal colour, radius, shadow or font.
 */
import UPageHero from '@nuxt/ui/components/PageHero.vue'
import { computed } from 'vue'

import { withNeClasses } from '../utils/slot-classes'

import type { NeHeroProps } from './ne-marketing-types'

const props = withDefaults(defineProps<NeHeroProps>(), {
  as: undefined,
  description: undefined,
  headline: undefined,
  links: undefined,
  orientation: undefined,
  reverse: false,
  title: undefined,
  ui: undefined,
})

defineSlots<{
  /** Between the description and the buttons. */
  body?(): unknown
  /** Below the container, full width. */
  bottom?(): unknown
  /** Media beside (horizontal) or below (vertical) the text — a screenshot, an illustration. */
  default?(): unknown
  /** Replaces the description text. */
  description?(): unknown
  /** Replaces the whole buttons row. */
  footer?(): unknown
  /** Replaces the whole headline + title + description block. */
  header?(): unknown
  /** Replaces the headline text. */
  headline?(): unknown
  /** Replaces the buttons `links` renders. */
  links?(): unknown
  /** Replaces the title text, still inside the `<h1>`. */
  title?(): unknown
  /** Above the container, full width — a background layer or a banner. */
  top?(): unknown
}>()

const NE_HERO_CLASSES = {
  headline: 'text-[var(--ne-accent)]',
  title: 'tracking-[var(--ne-tracking-tight)]',
}

const ui = computed(() => withNeClasses(NE_HERO_CLASSES, props.ui))
</script>

<template>
  <UPageHero
    data-ne-hero
    :as="as"
    :headline="headline"
    :title="title"
    :description="description"
    :links="links"
    :orientation="orientation"
    :reverse="reverse"
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
    <template v-if="$slots.headline" #headline>
      <slot name="headline" />
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
  </UPageHero>
</template>
