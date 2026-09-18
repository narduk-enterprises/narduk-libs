<script setup lang="ts">
/*
 * NE Base design card for NeCsvDownload (narduk-libs#528). The button, and
 * beside it the exact text it would save for three fixed rows, produced by the
 * same `toCsv()` the button calls — so the card shows the file, not a promise.
 */
import NeCsvDownload from '../runtime/components/NeCsvDownload.vue'
import { toCsv } from '../runtime/utils/data-table'

import type { NeDataColumn } from '../runtime/components/ne-data-table-types'

interface Reading {
  time: string
  wind: number | null
  windMs: number | null
}

const columns: NeDataColumn<Reading>[] = [
  { key: 'time', label: 'Time' },
  { key: 'wind', label: 'Wind', unit: 'kt', numeric: true },
  { key: 'windMs', label: 'Wind', unit: 'm/s', csvOnly: true },
]
const rows: Reading[] = [
  { time: '2026-09-18T18:50:00Z', wind: 14, windMs: 7.2 },
  { time: '2026-09-18T17:50:00Z', wind: null, windMs: null },
  { time: '2026-09-18T16:50:00Z', wind: 10, windMs: 5.1 },
]
const preamble = ['Source: NOAA NDBC observations']
const text = toCsv(columns, rows, preamble)
</script>

<template>
  <section
    class="preview-card"
    data-design-card="ne-csv-download"
    data-name="CSV download"
    data-group="Shell"
  >
    <h2>CSV download</h2>
    <p>
      Downloads exactly the rows in view, raw values in the units shown plus any CSV-only SI
      columns, with the attribution line on top. Missing is an empty cell, never 0.
    </p>
    <div class="preview-row">
      <NeCsvDownload :columns="columns" :rows="rows" :preamble="preamble" filename="history" />
    </div>
    <div class="preview-row">
      <pre class="mono">{{ text }}</pre>
    </div>
  </section>
</template>
