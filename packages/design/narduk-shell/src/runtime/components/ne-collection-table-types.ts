/**
 * Public shapes for `NeCollectionTable` and `useClientCollection()`
 * (narduk-libs#1400). A plain module with no SFC and no Vue value import, so
 * the package root can re-export the types without putting a component in its
 * value-import graph.
 */
import type { VNode } from 'vue'

import type { NeDataColumn } from './ne-data-table-types'

/** A column's sortable reading of one row. `null` is "no value": it sorts last both ways. */
export type NeSortValue = number | string | null

/**
 * One column of a `NeCollectionTable`. The fields it shares with
 * `NeDataColumn` mean the same thing there, so one column array can feed the
 * table, `NeCsvDownload` and `toCsv`.
 */
export interface NeCollectionColumn<TRow = Record<string, unknown>> extends Pick<
  NeDataColumn<TRow>,
  | 'csv'
  | 'csvLabel'
  | 'emphasis'
  | 'firstDirection'
  | 'format'
  | 'key'
  | 'label'
  | 'missingText'
  | 'numeric'
  | 'unit'
  | 'value'
  | 'width'
> {
  /** `'end'` right-aligns a column that is not `numeric` (a state word over a figure). */
  align?: 'start' | 'end'
  /**
   * The column holds free text that can run several lines (a reason, a note).
   * In the phone card it takes a line of its own, clamped to two.
   */
  freeText?: boolean
  /** `false` drops the column below the stack breakpoint, in both phone layouts. */
  phone?: boolean
  /** Text the search matches for this column. Default: the cell's own text, and its `format` output. */
  searchText?: (row: TRow) => string
  /** `false` keeps a column unsortable even when its cells hold strings or numbers. */
  sortable?: false
  /**
   * The value the column sorts by. Default: the cell (`value`, else
   * `row[key]`) when it is a string, a finite number or a valid `Date`.
   * Return `null` for a row with no value: it sorts last in both directions.
   */
  sortValue?: (row: TRow) => NeSortValue
}

/** One filter chip. The table adds "All" in front; one chip is active at a time. */
export interface NeCollectionFilter<TRow = Record<string, unknown>> {
  key: string
  label: string
  test: (row: TRow) => boolean
  title?: string
}

/** A group of rows under one heading row. A group left empty by the search or filter is dropped. */
export interface NeCollectionGroup<TRow = Record<string, unknown>> {
  /** Shown beside the label. Omit when the group has no count worth stating; never pass `0` for "not counted". */
  count?: number | string
  key: string
  label: string
  rows: readonly TRow[]
  /** Extra attributes on the group's heading cell (`data-testid` and similar). */
  attrs?: Record<string, string | undefined>
}

/** The bounded-read footer: the caller's sentence, and where the rest is, when it is somewhere. */
export interface NeCollectionMore {
  href?: string
  label: string
  linkLabel?: string
}

export type NeCollectionStackBreakpoint = 'sm' | 'md' | 'lg'

export interface NeCollectionTableProps<TRow = Record<string, unknown>> {
  /** Required. The table's accessible name: a visually hidden caption, and the scroll region's label. */
  caption: string
  columns: ReadonlyArray<NeCollectionColumn<TRow>>
  /** Flat rows. Ignored when `groups` is given. */
  rows?: readonly TRow[]
  groups?: ReadonlyArray<NeCollectionGroup<TRow>>
  /**
   * How a header sort meets `groups`. `'within'` (default) sorts each group's
   * rows and keeps the headings. `'across'` lets a sort other than the grouped
   * one set the headings aside and order every matched row as one run, with a
   * "Back to groups" control that returns to the grouped sort.
   */
  groupSort?: 'within' | 'across'
  /**
   * The sort under which `groupSort: 'across'` shows the groups. Default: the
   * `sort` prop. Pass it when you bind `v-model:sort`, since the prop then
   * follows every header click.
   */
  groupedSort?: string | null
  /** The label of the control that returns an `'across'` sort to the groups. Default "Back to groups". */
  groupResetLabel?: string
  rowKey?: (row: TRow, index: number) => string | number
  rowAttrs?: (row: TRow) => Record<string, string | undefined>
  /** The row leads somewhere: the primary cell becomes a link, and a click elsewhere on the row follows it. */
  rowHref?: (row: TRow) => string | null | undefined
  /** `undefined`: no selection. `null`: selectable, nothing picked. Otherwise the picked row's key. */
  selectedKey?: string | number | null
  /** The flexible lead column (link target, card headline). Default: the first column. */
  primaryColumn?: string
  /** Initial sort, `key:asc|desc`. `null`: the caller's order. Follows the prop when it changes. */
  sort?: string | null
  /** `false` turns header sorting off entirely. */
  sortable?: boolean
  /** Search, chips and count: `true` from `toolbarFrom` rows, a number from that many, `'always'`, or `false`. */
  toolbar?: boolean | number | 'always'
  filters?: ReadonlyArray<NeCollectionFilter<TRow>>
  /** The chip selected on first render. Default `'all'`. */
  defaultFilter?: string
  /** A search the table arrives with, and follows when it changes. */
  initialQuery?: string
  searchText?: (row: TRow) => string
  searchPlaceholder?: string
  /** `NeSearchInput`'s debounce, in ms. */
  searchDebounce?: number
  /** What the rows are called in the count ("12 products"). Default `row` / `rows`. */
  noun?: string
  /** Rows drawn before a "Show all N" button, counted after search, filter and sort. */
  limit?: number
  more?: NeCollectionMore
  /** What a missing cell reads. Unset: an em dash with "No value" for a screen reader. */
  missingText?: string
  /** Text when the table holds no rows at all. */
  empty?: string
  /** Text when the search and filter leave nothing. */
  noMatchText?: string
  /** Below this breakpoint the table takes its phone layout. */
  stackBelow?: NeCollectionStackBreakpoint
  /** The phone layout: rows reflow into cards, or the table keeps its columns (minus `phone: false`). */
  phoneLayout?: 'cards' | 'columns'
}

export interface NeCollectionCellSlotProps<TRow = Record<string, unknown>> {
  column: NeCollectionColumn<TRow>
  row: TRow
  value: unknown
}

export interface NeCollectionMissingSlotProps<TRow = Record<string, unknown>> {
  column: NeCollectionColumn<TRow>
  row: TRow
}

export interface NeCollectionGroupSlotProps<TRow = Record<string, unknown>> {
  group: NeCollectionGroup<TRow>
  rows: readonly TRow[]
}

export type NeCollectionTableSlots<TRow = Record<string, unknown>> = {
  group?: (props: NeCollectionGroupSlotProps<TRow>) => VNode[]
  missing?: (props: NeCollectionMissingSlotProps<TRow>) => VNode[]
  more?: (props: { more: NeCollectionMore | undefined }) => VNode[]
  toolbar?: (props: Record<string, never>) => VNode[]
} & {
  [name: `${string}-cell`]: ((props: NeCollectionCellSlotProps<TRow>) => VNode[]) | undefined
} & {
  [name: `${string}-header`]: ((props: { column: NeCollectionColumn<TRow> }) => VNode[]) | undefined
}

/** The engine's inputs: one reading of a set of rows. */
export interface NeClientCollectionQuery<TRow = Record<string, unknown>> {
  columns: ReadonlyArray<NeCollectionColumn<TRow>>
  filters?: ReadonlyArray<NeCollectionFilter<TRow>>
  filter?: string | null
  query?: string
  searchText?: (row: TRow) => string
  sort?: string | null
}

/** The filter row's item, as `NeFilterBar` takes it, with its count within the search. */
export interface NeCollectionFilterItem {
  count: number
  key: string
  label: string
  title?: string
}

export interface NeCollectionView<TRow = Record<string, unknown>> {
  /** "All" first, then each filter, each counted within the current search. Empty with no filters. */
  items: NeCollectionFilterItem[]
  /** Rows that survive search and filter, in sort order. */
  rows: TRow[]
}
