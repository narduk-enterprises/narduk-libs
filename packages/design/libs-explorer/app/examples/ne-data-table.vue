<script setup lang="ts">
/*
 * Interactive NeDataTable. Every control is a URL query parameter, so a state
 * can be shared as a link. The table never sorts rows itself (it emits
 * `update:sort`); this wrapper plays the part of the page and sorts the
 * fixture client-side, missing values last, the way a list endpoint would.
 */
import type { NeDataColumn, NeDataColumnGroup } from '@narduk-enterprises/narduk-shell'

const emit = defineEmits<{ event: [name: string, detail: unknown] }>()
const route = useRoute()
const router = useRouter()

interface Reading {
  station: string
  day: string
  wind: number | null
  gust: number | null
  waves: number | null
  pressure: number | null
}

const READINGS: Reading[] = [
  { station: 'Port Aransas', day: 'Fri, Sep 18', wind: 14, gust: 16, waves: 3.0, pressure: 30.08 },
  { station: 'Port Isabel', day: 'Fri, Sep 18', wind: 10, gust: 12, waves: 3.0, pressure: 30.11 },
  {
    station: 'Aransas Bay',
    day: 'Fri, Sep 18',
    wind: null,
    gust: null,
    waves: 2.1,
    pressure: 30.1,
  },
  { station: 'Bob Hall Pier', day: 'Thu, Sep 17', wind: 16, gust: 19, waves: 3.9, pressure: 30.09 },
  { station: 'Galveston', day: 'Thu, Sep 17', wind: 8, gust: null, waves: null, pressure: 30.02 },
  { station: 'Sabine Pass', day: 'Thu, Sep 17', wind: 21, gust: 27, waves: 4.6, pressure: 29.94 },
]

const groups: NeDataColumnGroup[] = [
  { id: 'wind', label: 'Wind', unit: 'kt' },
  { id: 'waves', label: 'Waves', unit: 'ft' },
  { id: 'pressure', label: 'Pressure', unit: 'inHg' },
]

const columns: NeDataColumn<Reading>[] = [
  { key: 'station', label: 'Station', sticky: true, sortKey: 'station' },
  {
    key: 'wind',
    label: 'avg',
    group: 'wind',
    numeric: true,
    emphasis: true,
    sortKey: 'wind',
    firstDirection: 'desc',
  },
  {
    key: 'gust',
    label: 'gust',
    group: 'wind',
    numeric: true,
    sortKey: 'gust',
    firstDirection: 'desc',
  },
  {
    key: 'waves',
    label: 'height',
    group: 'waves',
    numeric: true,
    emphasis: true,
    sortKey: 'waves',
    firstDirection: 'desc',
  },
  {
    key: 'pressure',
    label: 'sea level',
    group: 'pressure',
    numeric: true,
    sortKey: 'pressure',
    format: (value) => (typeof value === 'number' ? value.toFixed(2) : String(value)),
  },
]

function queryFlag(name: string): boolean {
  return route.query[name] === '1'
}
function setQuery(name: string, value: string | undefined) {
  router.replace({ query: { ...route.query, [name]: value } })
  emit('event', 'control', { [name]: value ?? null })
}

const sort = computed(() => (typeof route.query.sort === 'string' ? route.query.sort : null))
const grouped = computed(() => queryFlag('grouped'))
const loading = computed(() => queryFlag('loading'))
const empty = computed(() => queryFlag('empty'))

const rows = computed<Reading[]>(() => {
  if (empty.value) return []
  const [key, direction] = (sort.value ?? '').split(':') as [keyof Reading | '', string | undefined]
  const sorted = [...READINGS]
  if (key) {
    const sign = direction === 'desc' ? -1 : 1
    sorted.sort((left, right) => {
      const a = left[key]
      const b = right[key]
      if (a === null) return b === null ? 0 : 1
      if (b === null) return -1
      return (
        (typeof a === 'number' && typeof b === 'number'
          ? a - b
          : String(a).localeCompare(String(b))) * sign
      )
    })
  }
  // A group row opens whenever the day changes, so grouped rows must stay
  // contiguous: order by day, keeping the sort inside each day (stable sort).
  if (grouped.value) sorted.sort((left, right) => right.day.localeCompare(left.day))
  return sorted
})

const missingCount = computed(() => {
  const key = (sort.value ?? '').split(':')[0] as keyof Reading | ''
  return key ? rows.value.filter((row) => row[key] === null).length : null
})

function onSort(next: string) {
  emit('event', 'update:sort', next)
  router.replace({ query: { ...route.query, sort: next } })
}
</script>

<template>
  <div class="space-y-4">
    <div
      class="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-lg border border-default bg-default p-4"
      data-testid="demo-controls"
    >
      <USwitch
        :model-value="grouped"
        label="Group by day"
        @update:model-value="(on: boolean) => setQuery('grouped', on ? '1' : undefined)"
      />
      <USwitch
        :model-value="loading"
        label="Loading"
        @update:model-value="(on: boolean) => setQuery('loading', on ? '1' : undefined)"
      />
      <USwitch
        :model-value="empty"
        label="No rows"
        @update:model-value="(on: boolean) => setQuery('empty', on ? '1' : undefined)"
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
    <NeDataTable
      :columns="columns"
      :groups="groups"
      :rows="rows"
      :sort="sort"
      :missing-count="missingCount"
      :loading="loading"
      :group-by="grouped ? (row: Reading) => row.day : undefined"
      :sticky-header="false"
      empty="No readings in this window"
      caption="Coastal station readings (fixture data)"
      @update:sort="onSort"
      @update:column-set="(id: string) => emit('event', 'update:columnSet', id)"
    />
  </div>
</template>
