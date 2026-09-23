<script setup lang="ts">
/**
 * A type-level fixture, not a mounted test: `pnpm run typecheck` (vue-tsc)
 * compiles it the way `nuxt typecheck` compiles a consumer (narduk-libs#780).
 *
 * It pins that `NeDataTable` declares its slots, so a consumer can write a
 * `<key>-cell` template without a local typed wrapper, and that the slot's
 * `row` is the table's own row type rather than `any` or `unknown`.
 */
import NeDataTable from '../src/runtime/components/NeDataTable.vue'

import type { NeDataColumn } from '../src/runtime/components/ne-data-table-types'

interface Station {
  id: string
  name: string
  status: 'up' | 'down'
}

const columns: Array<NeDataColumn<Station>> = [
  { key: 'name', label: 'Station', sticky: true },
  { key: 'status', label: 'Status' },
]
const rows: Station[] = [{ id: 'a', name: 'Alpha', status: 'up' }]

const statusText = (status: Station['status']): string => (status === 'up' ? 'Up' : 'Down')
const columnLabel = (column: NeDataColumn<Station>): string => column.label
</script>

<template>
  <NeDataTable :columns="columns" :rows="rows" :row-key="(row) => row.id">
    <template #status-cell="{ row, column, value }">
      <span :title="columnLabel(column)" :data-raw="String(value)">{{
        statusText(row.status)
      }}</span>
      <!-- @vue-expect-error `row` is a Station, so an unknown property is an error. -->
      {{ row.notAStationField }}
    </template>
    <template #name-cell="{ row }">
      <b>{{ row.name.toUpperCase() }}</b>
    </template>
    <template #group="{ key, rows: groupRows }">
      {{ key }} · {{ groupRows.map((row) => row.name).join(', ') }}
    </template>
    <template #break="{ column, count }"
      >{{ column?.label ?? 'value' }} missing in {{ count }}</template
    >
  </NeDataTable>
</template>
