<script setup lang="ts">
import type { NeCollectionColumn, NeCollectionFilter } from '@narduk-enterprises/narduk-shell'

interface Station {
  id: string
  name: string
  region: string
  wind: number | null
}

// A small, fully loaded set: the table sorts, searches and filters it in the
// browser. A paged server list belongs to NeDataTable and useCollection().
const stations: Station[] = [
  { id: 'port-aransas', name: 'Port Aransas', region: 'Coastal Bend', wind: 14 },
  { id: 'apalachicola', name: 'Apalachicola', region: 'Gulf', wind: null },
  { id: 'port-isabel', name: 'Port Isabel', region: 'Laguna', wind: 21 },
  { id: 'aransas-bay', name: 'Aransas Bay', region: 'Coastal Bend', wind: 6 },
]

const columns: Array<NeCollectionColumn<Station>> = [
  { key: 'name', label: 'Station' },
  { key: 'region', label: 'Region', phone: false, width: '9rem' },
  { key: 'wind', label: 'Wind', numeric: true, unit: 'kt', width: '6rem' },
]

const filters: Array<NeCollectionFilter<Station>> = [
  { key: 'coastal', label: 'Coastal Bend', test: (station) => station.region === 'Coastal Bend' },
]
</script>

<template>
  <NeCollectionTable
    caption="Stations"
    :columns="columns"
    :rows="stations"
    :filters="filters"
    :row-key="(station) => station.id"
    :row-href="(station) => `#${station.id}`"
    noun="stations"
    sort="wind:desc"
    toolbar="always"
    missing-text="unreported"
  />
</template>
