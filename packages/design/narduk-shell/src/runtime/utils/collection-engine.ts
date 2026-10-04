/**
 * The client-side collection engine behind `useClientCollection()` and
 * `NeCollectionTable` (narduk-libs#1400), upstreamed from operator-portal's
 * `app/utils/collection.ts`. No Vue, no DOM: the package root re-exports these
 * as values, so a server route or a unit test can read a set of rows exactly
 * the way the table does.
 *
 * - SEARCH matches every column's text (its `searchText`, else the cell and
 *   its `format` output) plus the caller's row-level `searchText`,
 *   case-insensitively.
 * - FILTER is one chip at a time, "All" plus the caller's chips, and each
 *   chip's count is taken within the current search, so a chip never promises
 *   rows the search has already hidden.
 * - SORT is one column in wire form, `key:asc|desc`. A row with no value for
 *   that column sorts last in both directions: missing is never ranked as a
 *   zero. The sort is stable, so equal rows keep the caller's order.
 *
 * Every count is the length of the array it describes.
 */
import { isMissingValue, parseSort, readColumnValue } from './data-table'

import type {
  NeCollectionColumn,
  NeCollectionFilterItem,
  NeClientCollectionQuery,
  NeCollectionView,
  NeSortValue,
} from '../components/ne-collection-table-types'
import type { NeSortDirection } from '../components/ne-data-table-types'

/** The key of the "All" chip the engine puts in front of the caller's filters. */
export const NE_COLLECTION_ALL = 'all'

/** The row count from which a `toolbar: true` table shows its search, chips and count. */
export const NE_COLLECTION_TOOLBAR_FROM = 25

/** A column's sortable value for one row: its `sortValue`, else the cell when it is a string, number or date. */
export function sortValueOf<TRow>(column: NeCollectionColumn<TRow>, row: TRow): NeSortValue {
  const value = column.sortValue ? column.sortValue(row) : readColumnValue(column, row)
  if (isMissingValue(value)) return null
  if (typeof value === 'number' || typeof value === 'string') return value
  if (value instanceof Date) return value.getTime()
  return null
}

/** A column sorts when it declares `sortValue`, or when some row holds a value in it; `sortable: false` opts out. */
export function isSortableColumn<TRow>(
  column: NeCollectionColumn<TRow>,
  rows: readonly TRow[],
): boolean {
  if (column.sortable === false) return false
  if (column.sortValue) return true
  return rows.some((row) => sortValueOf(column, row) !== null)
}

/** The direction a column's first header click takes: `firstDirection`, else `desc` for a figure, `asc` for text. */
export function firstDirectionOf<TRow>(column: NeCollectionColumn<TRow>): NeSortDirection {
  if (column.firstDirection) return column.firstDirection
  return column.numeric || column.align === 'end' ? 'desc' : 'asc'
}

function textOf(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (Array.isArray(value)) return value.map(textOf).join(' ')
  return ''
}

function columnText<TRow>(column: NeCollectionColumn<TRow>, row: TRow): string {
  if (column.searchText) return column.searchText(row)
  const value = readColumnValue(column, row)
  const raw = textOf(value)
  if (!column.format || isMissingValue(value)) return raw
  return `${raw} ${column.format(value, row)}`
}

/** Does `row` contain `query` (already trimmed and lower-cased) in any column, or in the row's own search text? */
export function rowMatches<TRow>(
  row: TRow,
  query: string,
  columns: ReadonlyArray<NeCollectionColumn<TRow>>,
  searchText?: (row: TRow) => string,
): boolean {
  if (!query) return true
  const cells = columns.map((column) => columnText(column, row))
  if (searchText) cells.push(searchText(row))
  return cells.join(' ').toLowerCase().includes(query)
}

function compare(a: Exclude<NeSortValue, null>, b: Exclude<NeSortValue, null>): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  if (typeof a === 'number') return -1
  if (typeof b === 'number') return 1
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
}

/** `rows` in the order `sort` names, missing values last both ways. An unknown column or no sort keeps the order. */
export function sortRows<TRow>(
  rows: readonly TRow[],
  columns: ReadonlyArray<NeCollectionColumn<TRow>>,
  sort: string | null | undefined,
): TRow[] {
  const parsed = parseSort(sort)
  const column = parsed ? columns.find((candidate) => candidate.key === parsed.key) : undefined
  if (!parsed || !column) return [...rows]
  const sign = parsed.direction === 'desc' ? -1 : 1
  const keyed = rows.map((row) => ({ row, value: sortValueOf(column, row) }))
  keyed.sort((left, right) => {
    if (left.value === null || right.value === null) {
      if (left.value === right.value) return 0
      return left.value === null ? 1 : -1
    }
    return sign * compare(left.value, right.value)
  })
  return keyed.map((entry) => entry.row)
}

/** One reading of `rows`: searched, filtered and sorted, and the filter row's counts within the search. */
export function collectRows<TRow>(
  rows: readonly TRow[],
  options: NeClientCollectionQuery<TRow>,
): NeCollectionView<TRow> {
  const query = (options.query ?? '').trim().toLowerCase()
  const searched = query
    ? rows.filter((row) => rowMatches(row, query, options.columns, options.searchText))
    : [...rows]
  const filters = options.filters ?? []
  const active = filters.find((candidate) => candidate.key === options.filter)
  const kept = active ? searched.filter((row) => active.test(row)) : searched
  const items: NeCollectionFilterItem[] = filters.length
    ? [
        { count: searched.length, key: NE_COLLECTION_ALL, label: 'All' },
        ...filters.map((candidate) => ({
          count: searched.filter((row) => candidate.test(row)).length,
          key: candidate.key,
          label: candidate.label,
          ...(candidate.title ? { title: candidate.title } : {}),
        })),
      ]
    : []
  return { items, rows: sortRows(kept, options.columns, options.sort) }
}
