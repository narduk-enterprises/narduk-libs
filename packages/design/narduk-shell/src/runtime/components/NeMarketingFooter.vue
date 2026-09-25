<script setup lang="ts">
/**
 * NeMarketingFooter — the page footer of a public site: link columns above,
 * then a row of left / centre / right content (a copyright line, legal links,
 * social buttons).
 *
 * A thin themed wrapper over Nuxt UI's `UFooter` (components backlog item 21,
 * narduk-libs#268). Every prop and slot is `UFooter`'s own; it renders a
 * `<footer>` (the page's `contentinfo` landmark) by default. Link columns are
 * Nuxt UI's `UFooterColumns`, placed in the `#top` slot by the caller — the
 * wrapper does not grow a `columns` prop of its own.
 *
 * Theming: a `--ne-hairline` rule separates the footer from the page above
 * it. Ink and surfaces already arrive through the `theme.css` bridge. A
 * caller's own `ui` classes merge after the suite's.
 *
 * Styling contract (narduk-ui guardrail 3, extended to the suite): token
 * reads only, no literal colour, radius, shadow or font.
 */
import UFooter from '@nuxt/ui/components/Footer.vue'
import { computed } from 'vue'

import { withNeClasses } from '../utils/slot-classes'

import type { NeMarketingFooterProps } from './ne-marketing-types'

const props = withDefaults(defineProps<NeMarketingFooterProps>(), {
  as: undefined,
  ui: undefined,
})

defineSlots<{
  /** Below the main row, full width. */
  bottom?(): unknown
  /** Middle of the main row. */
  default?(): unknown
  /** Start of the main row on wide screens; last when the row stacks (Nuxt UI's order). */
  left?(): unknown
  /** End of the main row on wide screens; first when the row stacks. */
  right?(): unknown
  /** Above the main row, full width — typically `UFooterColumns`. */
  top?(): unknown
}>()

const NE_FOOTER_CLASSES = {
  root: 'border-t border-[var(--ne-hairline)]',
}

const ui = computed(() => withNeClasses(NE_FOOTER_CLASSES, props.ui))
</script>

<template>
  <UFooter data-ne-marketing-footer :as="as" :ui="ui">
    <!-- Forwarded only when the caller fills them: Nuxt UI decides whether
         to render a block from `!!slots.<name>`, so an always-forwarded
         empty slot would render empty wrappers. -->
    <template v-if="$slots.top" #top>
      <slot name="top" />
    </template>
    <template v-if="$slots.left" #left>
      <slot name="left" />
    </template>
    <template v-if="$slots.default" #default>
      <slot />
    </template>
    <template v-if="$slots.right" #right>
      <slot name="right" />
    </template>
    <template v-if="$slots.bottom" #bottom>
      <slot name="bottom" />
    </template>
  </UFooter>
</template>
