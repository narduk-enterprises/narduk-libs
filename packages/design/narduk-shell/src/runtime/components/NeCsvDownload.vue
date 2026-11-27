<script setup lang="ts" generic="TRow">
/**
 * NeCsvDownload — "CSV" for exactly the rows in view (narduk-libs#528).
 *
 * Hand it the same `columns` and `rows` the `NeDataTable` beside it draws and
 * it writes those rows, in that order — not the whole history, not the next
 * page. Columns with `csv: false` stay out; `csvOnly` columns (an SI twin of a
 * displayed column, say) go in. Values are written raw through each column's
 * `csv` accessor or `value`, never through `format`, so a spreadsheet gets
 * numbers rather than "12 kt". Missing values are empty cells, never 0.
 *
 * `preamble` lines go above the header — the place for an attribution line.
 * The text itself is `toCsv()`, exported from the package root, so a server
 * route can produce the identical file.
 *
 * Rendering is inert on the server: the button only builds the file when it
 * is clicked, in the browser.
 *
 * The accessible name says how many rows the file holds and always contains
 * the visible `label` (WCAG 2.5.3, axe `label-content-name-mismatch`): the
 * default "CSV" reads "Download 2 rows as CSV"; a label it does not already
 * contain leads, "Download sources CSV (2 rows)".
 */
import UButton from '@nuxt/ui/components/Button.vue'
import { computed } from 'vue'

import { toCsv } from '../utils/data-table'

import type { NeCsvDownloadProps } from './ne-data-table-types'

const props = withDefaults(defineProps<NeCsvDownloadProps<TRow>>(), {
  filename: 'export.csv',
  label: 'CSV',
  preamble: () => [],
  size: 'sm',
})

const emit = defineEmits<{ download: [csv: string, filename: string] }>()

const accessibleName = computed(() => {
  const count = props.rows.length === 1 ? '1 row' : `${props.rows.length} rows`
  const phrase = `Download ${count} as CSV`
  const visible = (props.label ?? '').replaceAll(/\s+/g, ' ').trim()
  if (!visible || phrase.toLowerCase().includes(visible.toLowerCase())) return phrase
  return `${visible} (${count})`
})

function download(): void {
  if (!import.meta.client) return
  const csv = toCsv(props.columns, props.rows, props.preamble)
  const filename = props.filename.toLowerCase().endsWith('.csv')
    ? props.filename
    : `${props.filename}.csv`
  emit('download', csv, filename)

  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}
</script>

<template>
  <UButton
    data-ne-csv-download
    color="neutral"
    variant="outline"
    icon="i-lucide-download"
    :size="size"
    :label="label"
    :aria-label="accessibleName"
    @click="download"
  />
</template>
