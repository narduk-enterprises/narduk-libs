/**
 * The data-table family's contracts: `NeDataTable`, `NeSortHeader` and
 * `NeCsvDownload` (narduk-libs#528).
 *
 * Kept in a plain module for the same reason as `ne-pager-types.ts`: the
 * package root re-exports these as type-only exports, and a plain `.ts` file
 * is what a non-Vue-aware tool can read a named interface out of.
 */

import type { VNode } from 'vue'

/** A sort direction as the list-query wire form spells it. */
export type NeSortDirection = 'asc' | 'desc'

/**
 * The slice of a TanStack column `NeSortHeader` needs to drive client-side
 * sorting inside a plain `UTable` — exactly what stonx's `SortableTableHeader`
 * took, so its call sites move over unchanged.
 */
export interface NeSortableColumn {
  getIsSorted: () => false | NeSortDirection
  toggleSorting: (desc?: boolean) => void
}

export interface NeSortHeaderProps {
  /** The header text. */
  label: string
  /** Shown once, muted, beside the label: `kt`, `°F`. */
  unit?: string
  /**
   * Which way the FIRST click sorts. Readings go strongest first (`'desc'`),
   * names A–Z (`'asc'`). The second click flips it; there is no third,
   * "unsorted" click — a Reset control outside the table does that.
   */
  firstDirection?: NeSortDirection
  /** `'end'` for a numeric column, so the arrow sits against the numbers. */
  align?: 'start' | 'end'
  /**
   * Server mode: the key this header sorts by, compared against `sort`.
   * Emits `update:sort` with `'<sortKey>:<asc|desc>'`, which is exactly what
   * `useCollection().setSort` takes.
   */
  sortKey?: string
  /** Server mode: the current sort in wire form (`useCollection().sort`). */
  sort?: string | null
  /** Client mode: a TanStack column from a `UTable` `#<id>-header` slot. */
  column?: NeSortableColumn
}

/** One column group, drawn as a header row above its columns. */
export interface NeDataColumnGroup {
  /** Matched by `NeDataColumn.group`. */
  id: string
  label: string
  /** The group's unit, drawn once under its label: `kt`, `ft`, `inHg`. */
  unit?: string
}

export interface NeDataColumn<TRow = Record<string, unknown>> {
  /** Column id, and the property read when `value` is not given. */
  key: string
  label: string
  /** Drawn in the header under the label; cells then carry numbers only. */
  unit?: string
  /** A `NeDataColumnGroup.id`. Ungrouped columns sit outside every group. */
  group?: string
  /** Right-aligned, tabular, monospaced numerals. */
  numeric?: boolean
  /** The group's headline value: drawn at the emphasis weight. */
  emphasis?: boolean
  /**
   * Pinned to the left edge while the table scrolls sideways, and never
   * hidden by the phone column-set switch. Put sticky columns first.
   */
  sticky?: boolean
  /**
   * The column's width as any CSS length (`'8rem'`, `'120px'`), set on its
   * header cell. Leave the column that should take the slack width-less.
   * Once any shown column declares a width, every width-less one is floored
   * at 200px through the table's own minimum width, and the table's scroll
   * box scrolls sideways rather than squeezing it (narduk-libs#684).
   */
  width?: string
  /** How to read the cell's value. Defaults to `row[key]`. */
  value?: (row: TRow) => unknown
  /** How to print a present value. Missing values never reach it. */
  format?: (value: unknown, row: TRow) => string
  /**
   * What a missing cell in this column reads, drawn as visible dimmed text:
   * `'unreported'`, `'unset'`, or per row. Overrides the table's
   * `missingText`.
   */
  missingText?: string | ((row: TRow) => string)
  /**
   * Makes the header a `NeSortHeader` for this wire key. The table never
   * reorders rows itself: it emits `update:sort` and draws what arrives.
   */
  sortKey?: string
  /** First-click direction for `sortKey`. Defaults to `'asc'`. */
  firstDirection?: NeSortDirection
  /**
   * CSV: `false` leaves the column out of `NeCsvDownload`; a function
   * supplies the raw value (unformatted, SI, whatever the file should carry).
   * Defaults to `value`.
   */
  csv?: false | ((row: TRow) => unknown)
  /** CSV header text. Defaults to `label (unit)`. */
  csvLabel?: string
  /** In the CSV only — e.g. the SI twin of a displayed column. */
  csvOnly?: boolean
}

export interface NeDataTableProps<TRow = Record<string, unknown>> {
  columns: readonly NeDataColumn<TRow>[]
  rows: readonly TRow[]
  groups?: readonly NeDataColumnGroup[]
  /** Stable row identity. Defaults to the row's index. */
  rowKey?: (row: TRow, index: number) => string
  /**
   * Opens a group row (a day row, say) whenever the returned key changes
   * between consecutive rows. Rows must already be in order.
   */
  groupBy?: (row: TRow) => string | null | undefined
  /** The group row's text. Defaults to the key. The `group` slot overrides it. */
  groupLabel?: (key: string, rows: readonly TRow[]) => string
  /** The current sort in wire form. Drives the arrow, `aria-sort` and the tint. */
  sort?: string | null
  /**
   * Draws a break row before the first row with no value in the sorted
   * column: "no value, sorted last". On by default.
   */
  missingLast?: boolean
  /** The whole set's count of rows with no value, for the break row's text. */
  missingCount?: number | null
  /** Replaces the break row's text entirely. */
  missingLabel?: string
  /**
   * What every missing cell reads, drawn as visible dimmed text instead of
   * the em dash (`'unreported'`, say). A column's own `missingText` wins.
   * Unset keeps the em dash with "No value" for a screen reader.
   */
  missingText?: string
  /** Dims the rows under a 2 px bar. The rows stay; nothing jumps. */
  loading?: boolean
  /** Drops a non-sticky column whose every row is missing. */
  dropEmptyColumns?: boolean
  /**
   * On a phone, which group shows beside the sticky and ungrouped columns.
   * `v-model:column-set`. Defaults to the first group.
   */
  columnSet?: string | null
  /** The phone column-set switch. Defaults to on when there are 2+ groups. */
  phoneColumnSets?: boolean
  /**
   * `true` (default): the header sticks inside the table's own scroll box,
   * which also scrolls sideways under the sticky first column. `'page'`: the
   * header sticks to the page under the site header (`--ui-header-height`);
   * the box no longer scrolls sideways, so pair it with the phone column-set
   * switch. `false`: no sticky header.
   */
  stickyHeader?: boolean | 'page'
  /** Text for a table with no rows. */
  empty?: string
  /** Screen-reader caption. */
  caption?: string
}

/** What a `<key>-cell` slot receives: the column, its row, and the value read from it. */
export interface NeDataTableCellSlotProps<TRow = Record<string, unknown>> {
  column: NeDataColumn<TRow>
  row: TRow
  /** `column.value(row)`, or `row[column.key]`. May be a missing value. */
  value: unknown
}

/** What the `group` slot receives for one group (day) row. */
export interface NeDataTableGroupSlotProps<TRow = Record<string, unknown>> {
  /** The `groupBy` key that opened this group. */
  key: string
  rows: TRow[]
}

/** What the `break` slot receives for the "no value, sorted last" row. */
export interface NeDataTableBreakSlotProps<TRow = Record<string, unknown>> {
  /** The sorted column. */
  column: NeDataColumn<TRow> | undefined
  /** Rows with no value in it: `missingCount` when given, else this page's count. */
  count: number
}

/**
 * `NeDataTable`'s slots (narduk-libs#780). A `<key>-cell` slot is keyed by a
 * template-literal pattern, so `#status-cell="{ row }"` type-checks and `row`
 * is the table's own row type. A wrapper that forwards the slots can declare
 * `defineSlots<NeDataTableSlots<T>>()` rather than re-deriving the shape.
 */
export type NeDataTableSlots<TRow = Record<string, unknown>> = {
  /** Replaces a group row's label. */
  group?: (props: NeDataTableGroupSlotProps<TRow>) => VNode[]
  /** Replaces the break row's text. */
  break?: (props: NeDataTableBreakSlotProps<TRow>) => VNode[]
} & {
  /** A custom cell for the column whose `key` precedes `-cell`. */
  [name: `${string}-cell`]: ((props: NeDataTableCellSlotProps<TRow>) => VNode[]) | undefined
}

export interface NeCsvDownloadProps<TRow = Record<string, unknown>> {
  columns: readonly NeDataColumn<TRow>[]
  rows: readonly TRow[]
  /** The saved file's name. `.csv` is appended when missing. */
  filename?: string
  /** Lines written above the header: an attribution, a unit note. */
  preamble?: readonly string[]
  /** The button's text. */
  label?: string
  /** Nuxt UI button size. */
  size?: 'xs' | 'sm' | 'md'
}
