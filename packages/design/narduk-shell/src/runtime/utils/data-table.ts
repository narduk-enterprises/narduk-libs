/**
 * Pure helpers behind `NeDataTable`, `NeSortHeader` and `NeCsvDownload`
 * (narduk-libs#528). No Vue, no DOM: the package root re-exports `toCsv` and
 * `parseSort` as values, and they must stay safe to import anywhere.
 */
import type { NeDataColumn, NeSortDirection } from '../components/ne-data-table-types'

/** Reads a cell's value: `column.value(row)`, else `row[column.key]`. */
export function readColumnValue<TRow>(column: NeDataColumn<TRow>, row: TRow): unknown {
  if (column.value) return column.value(row)
  if (row !== null && typeof row === 'object') {
    return (row as Record<string, unknown>)[column.key]
  }
  return undefined
}

/**
 * The one definition of "no value" the table family uses. `0` and `false`
 * are values; `null`, `undefined`, `''` and a non-finite number are not.
 */
export function isMissingValue(value: unknown): boolean {
  if (value === null || value === undefined || value === '') return true
  if (typeof value === 'number') return !Number.isFinite(value)
  if (value instanceof Date) return Number.isNaN(value.getTime())
  return false
}

/** `'wind:desc'` → `{ key: 'wind', direction: 'desc' }`; anything else → null. */
export function parseSort(
  sort: string | null | undefined,
): { direction: NeSortDirection; key: string } | null {
  if (typeof sort !== 'string') return null
  const parts = sort.trim().split(':')
  if (parts.length !== 2) return null
  const [key, direction] = parts
  if (!key || (direction !== 'asc' && direction !== 'desc')) return null
  return { direction, key }
}

/** `NeSortHeader`'s click rule: unsorted → first direction; sorted → flip. */
export function nextSortDirection(
  current: false | NeSortDirection,
  first: NeSortDirection,
): NeSortDirection {
  if (current === false) return first
  return current === 'asc' ? 'desc' : 'asc'
}

/** Characters a spreadsheet treats as the start of a formula. */
const FORMULA_LEAD = /^[=+\-@\t\r]/u

function csvCell(value: unknown): string {
  if (isMissingValue(value)) return ''
  let text: string
  if (value instanceof Date) text = value.toISOString()
  else if (typeof value === 'number' || typeof value === 'boolean') text = String(value)
  else if (typeof value === 'string') {
    // A text cell that opens with `=`, `+`, `-` or `@` runs as a formula in
    // a spreadsheet (CSV injection). Numbers are written as numbers above, so
    // a negative reading is never prefixed; only text is neutralised.
    text = FORMULA_LEAD.test(value) ? `'${value}` : value
  } else text = JSON.stringify(value) ?? ''
  return /[",\n\r]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

/** The CSV header for a column: `csvLabel`, else `label (unit)`. */
export function csvHeader<TRow>(column: NeDataColumn<TRow>): string {
  if (column.csvLabel) return column.csvLabel
  return column.unit ? `${column.label} (${column.unit})` : column.label
}

/**
 * RFC 4180 text for exactly `rows`, in order: optional preamble lines, one
 * header line, one line per row, CRLF line ends. Columns with `csv: false`
 * are left out; `csvOnly` columns are included. Missing values are empty
 * cells, never `0`.
 */
export function toCsv<TRow>(
  columns: readonly NeDataColumn<TRow>[],
  rows: readonly TRow[],
  preamble: readonly string[] = [],
): string {
  const included = columns.filter((column) => column.csv !== false)
  const lines = preamble.map((line) => csvCell(line))
  lines.push(included.map((column) => csvCell(csvHeader(column))).join(','))
  for (const row of rows) {
    lines.push(
      included
        .map((column) =>
          csvCell(typeof column.csv === 'function' ? column.csv(row) : readColumnValue(column, row)),
        )
        .join(','),
    )
  }
  return `${lines.join('\r\n')}\r\n`
}
