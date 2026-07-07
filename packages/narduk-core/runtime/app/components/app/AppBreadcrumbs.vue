<script setup lang="ts">
import { useBreadcrumbs } from '../../composables/useBreadcrumbs'

import type { BreadcrumbItem } from '../../composables/useBreadcrumbs'

const props = withDefaults(
  defineProps<{
    homeIcon?: string
    items?: BreadcrumbItem[]
    resolveLabel?: (segment: string) => string | undefined
  }>(),
  {
    items: undefined,
    resolveLabel: undefined,
    homeIcon: 'i-lucide-house',
  },
)

const generatedBreadcrumbs = useBreadcrumbs({
  resolveLabel: toRef(props, 'resolveLabel'),
  homeIcon: toRef(props, 'homeIcon'),
})

const items = computed(() => {
  if (props.items?.length) {
    return props.items
  }

  return generatedBreadcrumbs.items.value
})
</script>

<template>
  <UBreadcrumb
    v-if="items.length > 0"
    :items="items"
    class="flex-wrap gap-y-2 text-sm text-muted"
  />
</template>
