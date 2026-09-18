<script setup lang="ts">
/*
 * NE Base design card for NeDataTable (narduk-libs#528), drawn with fixed
 * readings shaped like the buoys round-2 history board: column groups with
 * their unit once, a day row, right-aligned tabular numerals, a missing
 * reading as an em dash, and the sorted column's break row. A second table
 * shows the loading reading — the rows stay, dimmed, under a 2 px bar.
 */
import NeDataTable from '../runtime/components/NeDataTable.vue'

import type { NeDataColumn, NeDataColumnGroup } from '../runtime/components/ne-data-table-types'

interface Reading {
  day: string
  pressure: number | null
  time: string
  waves: number | null
  wind: number | null
  gust: number | null
}

const groups: NeDataColumnGroup[] = [
  { id: 'wind', label: 'Wind', unit: 'kt' },
  { id: 'waves', label: 'Waves', unit: 'ft' },
  { id: 'pressure', label: 'Pressure', unit: 'inHg' },
]

const columns: NeDataColumn<Reading>[] = [
  { key: 'time', label: 'Time', sticky: true },
  { key: 'wind', label: 'avg', group: 'wind', numeric: true, emphasis: true },
  { key: 'gust', label: 'gust', group: 'wind', numeric: true },
  { key: 'waves', label: 'height', group: 'waves', numeric: true, emphasis: true },
  { key: 'pressure', label: 'sea level', group: 'pressure', numeric: true },
]

const format = (value: unknown) => (typeof value === 'number' ? value.toFixed(2) : String(value))
const pressureColumns = columns.map((column) =>
  column.key === 'pressure' ? { ...column, format } : column,
)

const history: Reading[] = [
  { day: 'Fri, Sep 18', gust: 16, pressure: 30.08, time: '1:50 PM', waves: 3.0, wind: 14 },
  { day: 'Fri, Sep 18', gust: 12, pressure: 30.11, time: '12:50 PM', waves: 3.0, wind: 10 },
  { day: 'Thu, Sep 17', gust: null, pressure: 30.1, time: '6:50 PM', waves: 3.9, wind: null },
  { day: 'Thu, Sep 17', gust: 19, pressure: 30.09, time: '5:50 PM', waves: 3.9, wind: 16 },
]

interface Station {
  name: string
  wind: number | null
}

const stationColumns: NeDataColumn<Station>[] = [
  { key: 'name', label: 'Station', sticky: true },
  {
    key: 'wind',
    label: 'Wind',
    unit: 'kt',
    numeric: true,
    emphasis: true,
    sortKey: 'wind',
    firstDirection: 'desc',
  },
]
const stations: Station[] = [
  { name: 'Port Aransas', wind: 1 },
  { name: 'Port Isabel', wind: 1 },
  { name: 'Apk', wind: null },
  { name: 'Aransas Bay', wind: null },
]
</script>

<template>
  <section
    class="preview-card"
    data-design-card="ne-data-table"
    data-name="Data table"
    data-group="Shell"
  >
    <h2>Data table</h2>
    <p>
      <code>UTable</code> with the estate's reading: groups carry the unit once, numerals line up
      right, missing is “—” and never 0, and a day row opens each calendar day. On a phone a switch
      picks which group shows beside the sticky Time column.
    </p>
    <div class="preview-row">
      <NeDataTable
        :columns="pressureColumns"
        :groups="groups"
        :rows="history"
        :group-by="(row: Reading) => row.day"
        :sticky-header="false"
      />
    </div>
    <div class="preview-row">
      <NeDataTable
        :columns="stationColumns"
        :rows="stations"
        sort="wind:desc"
        :missing-count="142"
        :sticky-header="false"
      />
    </div>
    <div class="preview-row">
      <NeDataTable :columns="stationColumns" :rows="stations.slice(0, 2)" loading />
    </div>
  </section>
</template>
