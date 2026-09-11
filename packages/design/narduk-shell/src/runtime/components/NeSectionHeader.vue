<script setup lang="ts">
/**
 * NeSectionHeader — a smaller heading for a section within a page: a title,
 * an optional item count, a description, and a right-aligned actions area.
 *
 * Unlike NePageHeader it does not wrap a Nuxt UI component (there is no
 * `USectionHeader`); it is a small composed layout using Nuxt UI's semantic
 * text tokens (`text-highlighted`, `text-muted`) so it themes the same way
 * `U*` components do.
 *
 * Components-library backlog item 9 (narduk-libs#256); plan
 * docs/plans/components-library-plan.md §2 item 9.
 */
import { computed } from 'vue'

export interface NeSectionHeaderProps {
  /**
   * The heading tag rendered for the title. Default `'h2'` — a section
   * heading sits below the page's own `h1` by default.
   */
  as?: string
  /** An item count, shown next to the title as a muted, formatted number. */
  count?: number
  /** Supporting copy shown below the title. */
  description?: string
  /** The section title. */
  title: string
}

const props = withDefaults(defineProps<NeSectionHeaderProps>(), {
  count: undefined,
  description: undefined,
  as: 'h2',
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
  typeof props.count === 'number' ? `${props.count} ${props.count === 1 ? 'item' : 'items'}` : undefined,
)
</script>

<template>
  <div>
    <div class="flex flex-wrap items-start justify-between gap-4">
      <div>
        <component :is="as" class="flex items-center gap-2 text-lg font-semibold text-highlighted">
          {{ title }}
          <span v-if="formattedCount !== null" class="text-sm font-normal text-muted" :aria-label="countLabel">
            {{ formattedCount }}
          </span>
        </component>
        <p v-if="description" class="mt-1 text-sm text-muted">{{ description }}</p>
      </div>

      <div v-if="$slots.actions" class="flex items-center gap-2">
        <slot name="actions" />
      </div>
    </div>

    <slot />
  </div>
</template>
