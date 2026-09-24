<script setup lang="ts">
/*
 * Interactive NeDataTable, rendered inside the preview frame.
 *
 * The frame hands this demo its state as a query (`query`). The demo answers
 * each query with its canonical form (`canonical`) and each control change
 * with the next canonical query (`state`); the Explorer page owns the URL. Parsing, the fixture and the row order live
 * in demo/table.mts, which the unit tests cover, so what the table draws, what
 * the CSV exports and what the tests assert are one order.
 *
 * The table never sorts rows itself (it emits `update:sort`): this demo plays
 * the page and orders the fixture the way a list endpoint would.
 */
import type { NeDataColumn, NeDataColumnGroup } from '@narduk-enterprises/narduk-shell'

import {
  COLUMN_SETS,
  DAY_LABELS,
  missingCount,
  orderReadings,
  parseTableQuery,
  READINGS,
  sortWire,
  tableQuery,
  type Reading,
  type TableState,
} from '../../demo/table.mts'

// Named, because an SFC can refer to itself by its file name: without this,
// <NeDataTable> in the template would resolve to this demo for vue-tsc.
defineOptions({ name: 'ExplorerDataTableDemo' })

const props = defineProps<{ query: Record<string, string> }>()
const emit = defineEmits<{
  event: [name: string, detail: unknown]
  state: [query: Record<string, string>]
  canonical: [query: Record<string, string>]
}>()

const state = computed<TableState>(() => parseTableQuery(props.query))
// Every query the frame hands over is answered with its canonical form, so a
// malformed or partial link is corrected in the page's URL.
watch(
  () => props.query,
  () => emit('canonical', tableQuery(state.value)),
  { immediate: true },
)
const rows = computed(() => orderReadings(READINGS, state.value))
const divider = computed(() => missingCount(rows.value, state.value))
const sort = computed(() => sortWire(state.value))

function change(next: Partial<TableState>, name: string, detail: unknown) {
  emit('event', name, detail)
  emit('state', tableQuery({ ...state.value, ...next }))
}

function onSort(wire: string) {
  const parsed = parseTableQuery({ sort: wire }).sort
  change({ sort: parsed }, 'update:sort', wire)
}

function onColumnSet(id: string) {
  const parsed = parseTableQuery({ set: id }).set
  change({ set: parsed }, 'update:columnSet', id)
}

const groups: NeDataColumnGroup[] = [
  { id: 'wind', label: 'Wind', unit: 'kt' },
  { id: 'waves', label: 'Waves', unit: 'ft' },
  { id: 'pressure', label: 'Pressure', unit: 'inHg' },
]

const columns: NeDataColumn<Reading>[] = [
  { key: 'station', label: 'Station', sticky: true, sortKey: 'station' },
  // In the export only: a grouped CSV keeps its days.
  { key: 'date', label: 'Date', csvOnly: true },
  {
    key: 'wind',
    label: 'avg',
    group: 'wind',
    numeric: true,
    emphasis: true,
    csvLabel: 'Wind avg (kt)',
    sortKey: 'wind',
    firstDirection: 'desc',
  },
  {
    key: 'gust',
    label: 'gust',
    group: 'wind',
    numeric: true,
    csvLabel: 'Wind gust (kt)',
    sortKey: 'gust',
    firstDirection: 'desc',
  },
  {
    key: 'waves',
    label: 'height',
    group: 'waves',
    numeric: true,
    emphasis: true,
    csvLabel: 'Wave height (ft)',
    sortKey: 'waves',
    firstDirection: 'desc',
  },
  {
    key: 'pressure',
    label: 'sea level',
    group: 'pressure',
    numeric: true,
    csvLabel: 'Pressure (inHg)',
    sortKey: 'pressure',
    format: (value) => (typeof value === 'number' ? value.toFixed(2) : String(value)),
  },
]
</script>

<template>
  <div class="space-y-4">
    <div
      class="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-lg border border-default bg-default p-4"
      data-testid="demo-controls"
    >
      <USwitch
        :model-value="state.grouped"
        label="Group by day"
        data-testid="control-grouped"
        @update:model-value="(on: boolean) => change({ grouped: on }, 'control', { grouped: on })"
      />
      <USwitch
        :model-value="state.loading"
        label="Loading"
        data-testid="control-loading"
        @update:model-value="(on: boolean) => change({ loading: on }, 'control', { loading: on })"
      />
      <USwitch
        :model-value="state.empty"
        label="No rows"
        data-testid="control-empty"
        @update:model-value="(on: boolean) => change({ empty: on }, 'control', { empty: on })"
      />
      <span class="font-mono text-xs text-muted" data-testid="demo-sort"
        >sort: {{ sort ?? 'none' }}</span
      >
      <NeCsvDownload
        class="ml-auto"
        :columns="columns"
        :rows="rows"
        filename="explorer-readings.csv"
        :preamble="['Fixture data, not live readings.']"
        @click="emit('event', 'csv', { rows: rows.length })"
      />
    </div>
    <p
      v-if="state.grouped && state.sort"
      class="text-sm text-muted"
      data-testid="demo-grouped-note"
    >
      Grouped by day, newest first. Rows with no value are last within each day.
    </p>
    <!-- Always controlled: an absent column set means the default one, never
         the table's own last choice, or Back could not undo a switch. -->
    <NeDataTable
      :columns="columns"
      :groups="groups"
      :rows="rows"
      :sort="sort"
      :missing-last="!state.grouped"
      :missing-count="divider"
      :loading="state.loading"
      :column-set="state.set ?? COLUMN_SETS[0]"
      :group-by="state.grouped ? (row: Reading) => row.date : undefined"
      :group-label="(key: string) => DAY_LABELS[key] ?? key"
      :sticky-header="false"
      empty="No readings in this window"
      caption="Coastal station readings (fixture data)"
      data-testid="demo-table"
      @update:sort="onSort"
      @update:column-set="onColumnSet"
    />
  </div>
</template>
