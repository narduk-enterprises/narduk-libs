<script setup lang="ts">
/**
 * Template host for NeDataTable tests. `mount()` / `h()` cannot instantiate
 * `<script setup generic="T">`, so they default T to unknown and reject a
 * typed `NeDataColumn<Reading>[]`. A real `.vue` template is how consumers
 * bind the generic, and how vue-tsc checks it.
 *
 * Defaults match NeDataTable: an explicit `undefined` on a Boolean prop
 * (missingLast, phoneColumnSets) would coerce to `false` and skip the
 * child's withDefaults.
 */
import NeDataTable from '../src/runtime/components/NeDataTable.vue'

import type { NeDataTableProps } from '../src/runtime/components/ne-data-table-types'

export interface Reading {
  day: string
  gust: number | null
  pressure?: number | null
  time: string
  visibility?: number | null
  wind: number | null
}

withDefaults(defineProps<NeDataTableProps<Reading>>(), {
  caption: undefined,
  columnSet: undefined,
  dropEmptyColumns: false,
  empty: 'No rows',
  groupBy: undefined,
  groupLabel: undefined,
  groups: () => [],
  loading: false,
  missingCount: null,
  missingLabel: undefined,
  missingLast: true,
  phoneColumnSets: undefined,
  rowKey: undefined,
  sort: null,
  stickyHeader: true,
})
defineEmits<{
  'update:columnSet': [id: string]
  'update:sort': [sort: string]
}>()
</script>

<template>
  <NeDataTable
    :caption="caption"
    :column-set="columnSet"
    :columns="columns"
    :drop-empty-columns="dropEmptyColumns"
    :empty="empty"
    :group-by="groupBy"
    :group-label="groupLabel"
    :groups="groups"
    :loading="loading"
    :missing-count="missingCount"
    :missing-label="missingLabel"
    :missing-last="missingLast"
    :phone-column-sets="phoneColumnSets"
    :row-key="rowKey"
    :rows="rows"
    :sort="sort"
    :sticky-header="stickyHeader"
    @update:column-set="$emit('update:columnSet', $event)"
    @update:sort="$emit('update:sort', $event)"
  >
    <template v-for="(_, name) in $slots" #[name]="slotProps">
      <slot :name="name" v-bind="slotProps || {}" />
    </template>
  </NeDataTable>
</template>
