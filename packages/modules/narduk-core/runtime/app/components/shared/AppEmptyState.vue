<script setup lang="ts">
/**
 * AppEmptyState — Universal "no data" placeholder.
 *
 * Shows a centered icon, title, description, and an optional action slot.
 * Use this whenever a list, table, or section has no content to display.
 *
 * Usage:
 *   <AppEmptyState
 *     icon="i-lucide-inbox"
 *     title="No invoices yet"
 *     description="Create your first invoice to get started."
 *   >
 *     <UButton to="/invoices/new" icon="i-lucide-plus">Create invoice</UButton>
 *   </AppEmptyState>
 */

withDefaults(
  defineProps<{
    /** Whether to apply a compact vertical padding. */
    compact?: boolean
    /** Secondary text. */
    description?: string
    /** Lucide icon name. */
    icon?: string
    /** Primary text. */
    title: string
  }>(),
  {
    icon: '',
    description: '',
    compact: false,
  },
)
</script>

<template>
  <div :class="compact ? 'py-6' : 'py-12'" class="text-center">
    <div
      v-if="icon"
      class="mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary"
      aria-hidden="true"
    >
      <!-- eslint-disable-next-line vuejs-accessibility/alt-text -- region is aria-hidden; title provides context -->
      <UIcon :name="icon" class="size-7" />
    </div>
    <p class="font-medium text-default">{{ title }}</p>
    <p v-if="description" class="mt-1 text-sm text-muted max-w-sm mx-auto">{{ description }}</p>
    <div v-if="$slots.default" class="mt-5">
      <slot />
    </div>
  </div>
</template>
