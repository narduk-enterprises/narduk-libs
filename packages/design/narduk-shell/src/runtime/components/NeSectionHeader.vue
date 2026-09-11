<script setup lang="ts">
/**
 * NeSectionHeader — a smaller heading for a section within a page: a title,
 * an optional item count, and a right-aligned actions area.
 *
 * Unlike NePageHeader it does not wrap `UPageHeader` (there is no
 * `USectionHeader`); it is a small composed layout. The count is a Nuxt UI
 * `UBadge` (`color="neutral"` / `variant="subtle"`) so chrome comes from
 * tokens, not hardcoded colour, radius, shadow or font.
 *
 * Components-library backlog item 9 (narduk-libs#256); plan
 * docs/plans/components-library-plan.md §2 item 9.
 */
import { computed } from 'vue'

import UBadge from '@nuxt/ui/components/Badge.vue'

export type NeSectionHeaderHeading = 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'

export interface NeSectionHeaderProps {
  /**
   * The heading tag rendered for the title. Default `'h2'` — a section
   * heading sits below the page's own `h1` by default.
   */
  as?: NeSectionHeaderHeading
  /** An item count, shown next to the title as a token-themed badge. Hidden when undefined. */
  count?: number
  /** Supporting copy shown below the title. */
  description?: string
  /** The section title. */
  title: string
}

const props = withDefaults(defineProps<NeSectionHeaderProps>(), {
  as: 'h2',
  count: undefined,
  description: undefined,
})

defineSlots<{
  /** Right-aligned actions next to the title. Never rendered inside the heading element. */
  actions?(): unknown
  /** Extra content below the title/description block. */
  default?(): unknown
}>()

const formattedCount = computed(() =>
  typeof props.count === 'number' ? new Intl.NumberFormat().format(props.count) : null,
)

const countLabel = computed(() =>
  typeof props.count === 'number'
    ? `${props.count} ${props.count === 1 ? 'item' : 'items'}`
    : undefined,
)
</script>

<template>
  <div>
    <div class="flex flex-wrap items-start justify-between gap-4">
      <div>
        <div class="flex items-center gap-2">
          <component :is="as" class="text-highlighted">
            {{ title }}
          </component>
          <UBadge
            v-if="formattedCount !== null"
            data-slot="count"
            color="neutral"
            variant="subtle"
            size="sm"
            :label="formattedCount"
            :aria-label="countLabel"
          />
        </div>
        <p v-if="description" class="text-muted">{{ description }}</p>
      </div>

      <div v-if="$slots.actions" class="flex items-center gap-2">
        <slot name="actions" />
      </div>
    </div>

    <slot />
  </div>
</template>
