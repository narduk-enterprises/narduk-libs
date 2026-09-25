<script setup lang="ts">
/**
 * NeFeatureGrid — a responsive grid of feature tiles: icon, title,
 * description, optionally a link.
 *
 * A thin themed wrapper over Nuxt UI's `UPageGrid` and `UPageFeature`
 * (components backlog item 21, narduk-libs#268). `UPageGrid` is only the
 * one-/two-/three-column grid and `UPageFeature` only one tile; the
 * `features` array joins them the same way Nuxt UI's own `UPageSection`
 * renders its `features` prop — a `ul` of `UPageFeature`s `as="li"`, each
 * bound to one entry unchanged. The default slot replaces the tiles for a
 * grid of anything else (cards, testimonials), and the grid then renders as a
 * `div`, since the slot's children are not list items.
 *
 * Theming: each tile's leading icon reads `--ne-accent` instead of Nuxt UI's
 * `primary` alias. Title and description ink already arrive through the
 * `theme.css` bridge. A tile's own `ui` classes merge after the suite's.
 *
 * Styling contract (narduk-ui guardrail 3, extended to the suite): token
 * reads only, no literal colour, radius, shadow or font.
 */
import UPageFeature from '@nuxt/ui/components/PageFeature.vue'
import UPageGrid from '@nuxt/ui/components/PageGrid.vue'
import { computed, useSlots } from 'vue'

import { type NeUiClasses, withNeClasses } from '../utils/slot-classes'

import type { NeFeature, NeFeatureGridProps } from './ne-marketing-types'

const props = withDefaults(defineProps<NeFeatureGridProps>(), {
  as: undefined,
  features: () => [],
  ui: undefined,
})

defineSlots<{
  /** Replaces the tiles. The grid then renders as a `div`. */
  default?(): unknown
}>()

const slots = useSlots()

const NE_FEATURE_CLASSES = {
  leadingIcon: 'text-[var(--ne-accent)]',
}

const listed = computed(() => !slots.default)
const tag = computed(() => props.as ?? (listed.value ? 'ul' : 'div'))

function featureUi(feature: NeFeature) {
  return withNeClasses(NE_FEATURE_CLASSES, feature.ui as NeUiClasses | undefined)
}
</script>

<template>
  <UPageGrid v-if="!listed || features.length > 0" data-ne-feature-grid :as="tag" :ui="ui">
    <slot>
      <UPageFeature
        v-for="(feature, index) in features"
        :key="index"
        as="li"
        v-bind="feature"
        :ui="featureUi(feature)"
      />
    </slot>
  </UPageGrid>
</template>
