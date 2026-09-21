<script setup lang="ts">
import type { NeDataColumn } from '@narduk-enterprises/narduk-shell'

interface Reading {
  station: string
  wind: number | null
}

const columns: NeDataColumn<Reading>[] = [
  { key: 'station', label: 'Station' },
  { key: 'wind', label: 'Wind', unit: 'kt', numeric: true },
]
const rows: Reading[] = [
  { station: 'Port Aransas', wind: 14 },
  { station: 'Aransas Bay', wind: null },
]
</script>

<template>
  <!-- Raw values, missing as an empty cell, exactly the rows passed in. -->
  <NeCsvDownload
    :columns="columns"
    :rows="rows"
    filename="readings"
    :preamble="['Source: NOAA NDBC']"
  />
</template>
