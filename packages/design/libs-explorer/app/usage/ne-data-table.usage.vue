<script setup lang="ts">
import type { NeDataColumn, NeDataColumnGroup } from '@narduk-enterprises/narduk-shell'

interface Reading {
  station: string
  day: string
  wind: number | null
  gust: number | null
  pressure: number | null
}

// Stands in for your list endpoint. The table never reorders rows: the owner
// of the set sorts it (here, missing values last in both directions) and the
// table draws what arrives.
const READINGS: Reading[] = [
  { station: 'Port Aransas', day: 'Fri, Sep 18', wind: 14, gust: 16, pressure: 30.08 },
  { station: 'Aransas Bay', day: 'Fri, Sep 18', wind: null, gust: null, pressure: 30.1 },
  { station: 'Sabine Pass', day: 'Thu, Sep 17', wind: 21, gust: 27, pressure: 29.94 },
  { station: 'Galveston', day: 'Thu, Sep 17', wind: 8, gust: null, pressure: 30.02 },
]
type SortKey = 'station' | 'wind' | 'gust' | 'pressure'
const SORTABLE: readonly SortKey[] = ['station', 'wind', 'gust', 'pressure']

function listReadings(sort: string | undefined): Reading[] {
  const [key, direction] = (sort ?? '').split(':') as [SortKey, 'asc' | 'desc']
  if (!SORTABLE.includes(key)) return READINGS
  const sign = direction === 'desc' ? -1 : 1
  return [...READINGS].sort((a, b) => {
    const left = a[key]
    const right = b[key]
    if (left === null || right === null) return left === right ? 0 : left === null ? 1 : -1
    return (
      (typeof left === 'number' && typeof right === 'number'
        ? left - right
        : String(left).localeCompare(String(right))) * sign
    )
  })
}

const collection = useCollection<Reading>({
  fetch: ({ limit, offset, sort }) => {
    const items = listReadings(sort)
    return {
      items: items.slice(offset, offset + limit),
      total: items.length,
      limit,
      offset,
      q: null,
      sort: sort ?? null,
    }
  },
  sortable: SORTABLE,
})

const groups: NeDataColumnGroup[] = [
  { id: 'wind', label: 'Wind', unit: 'kt' },
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
    key: 'pressure',
    label: 'sea level',
    group: 'pressure',
    numeric: true,
    sortKey: 'pressure',
    format: (value) => (typeof value === 'number' ? value.toFixed(2) : String(value)),
  },
]

// Which column group a phone shows. Keep it in the URL too if it should survive a reload.
const columnSet = ref<string>('wind')
</script>

<template>
  <div class="space-y-3">
    <NeCsvDownload :columns="columns" :rows="collection.items" filename="readings" />
    <NeDataTable
      v-model:column-set="columnSet"
      :columns="columns"
      :groups="groups"
      :rows="collection.items"
      :sort="collection.sort"
      :loading="collection.pending"
      caption="Coastal station readings"
      @update:sort="collection.setSort"
    />
  </div>
</template>
