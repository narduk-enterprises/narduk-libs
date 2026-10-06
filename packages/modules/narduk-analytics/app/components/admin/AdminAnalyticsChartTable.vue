<script setup lang="ts">
import { computed } from 'vue'

/** The chart's table view: the same figures as the bars, one row per bucket. */
const props = defineProps<{
  /** "Day" or "Time". */
  first: string
  /** One column per drawn series. */
  metrics: Array<{ id: string; label: string }>
  /** Pre-formatted rows: `label` plus one string per metric id. */
  rows: Array<Record<string, string>>
}>()

const right = {
  td: 'text-right tabular-nums whitespace-nowrap',
  th: 'text-right whitespace-nowrap',
}
const columns = computed(() => [
  { accessorKey: 'label', header: props.first },
  ...props.metrics.map((metric) => ({
    accessorKey: metric.id,
    header: metric.label,
    meta: { class: right },
  })),
])
</script>

<template>
  <UTable
    class="ne-an-scroll"
    sticky
    :data="rows"
    :columns="columns"
    :ui="{ td: 'whitespace-nowrap', th: 'whitespace-nowrap' }"
  />
</template>
