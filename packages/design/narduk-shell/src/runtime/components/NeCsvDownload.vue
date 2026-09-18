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
 */
import UButton from '@nuxt/ui/components/Button.vue'

import { toCsv } from '../utils/data-table'

import type { NeCsvDownloadProps } from './ne-data-table-types'

const props = withDefaults(defineProps<NeCsvDownloadProps<TRow>>(), {
  filename: 'export.csv',
  label: 'CSV',
  preamble: () => [],
  size: 'sm',
})

const emit = defineEmits<{ download: [csv: string, filename: string] }>()

function download(): void {
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
  document.body.append(anchor)
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
    :aria-label="`Download ${rows.length === 1 ? '1 row' : `${rows.length} rows`} as CSV`"
    @click="download"
  />
</template>
