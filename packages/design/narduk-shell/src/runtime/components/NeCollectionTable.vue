<script setup lang="ts" generic="T">
/**
 * NeCollectionTable — one sortable, searchable, filterable table over rows the
 * page already holds (narduk-libs#1400). It merges operator-portal's two
 * hand-rolled tables: `KitTable` (header sort, a grid look, `phone: false`
 * columns) and `CollectionTable` (groups, row links, selection, a row limit
 * with "Show all", the bounded-read footer, a phone card reflow), and runs
 * both through one engine, `useClientCollection()`.
 *
 * ## Why a second table and not a `NeDataTable` mode
 *
 * `NeDataTable` is `UTable`, and its contract is that it never reorders rows:
 * the server sorts. What this table needs is markup `UTable` does not let a
 * caller reach: one `<tbody>` per group under a `rowgroup` heading, a
 * `<tfoot>`, attributes and click handling on each `<tr>`, and rows that
 * reflow into cards on a phone. Client mode for `NeDataTable` is the
 * composable on its own, which reorders the rows before the table sees them,
 * so both tables share one engine and neither contract bends.
 *
 * ## Roles are explicit
 *
 * Every element carries its table role (`table`, `rowgroup`, `row`,
 * `columnheader`, `cell`), because the phone card changes `display` away from
 * the table values, and some engines drop the implicit semantics when that
 * happens. `aria-sort` is bound on the `<th>` itself, so the server's first
 * paint already says which column is sorted.
 *
 * ## The phone
 *
 * Below `stackBelow` (`md` by default) the layout is CSS, so the server and the
 * first client render agree: `cards` keeps the same cells in the same DOM
 * order and drops only the visual header (the header stays for a screen
 * reader), `columns` keeps the table and drops `phone: false` columns, their
 * `<col>` with their cells: a cell that is gone while its `<col>` stays slides
 * the next cell into that column's width. The layout stays `table-fixed`, so a
 * truncating cell (`white-space: nowrap` with an ellipsis) shrinks to the
 * width left over instead of widening the table past the screen. In the
 * card layout the header's sort buttons are swapped for plain labels after
 * mount (a button clipped to one pixel would still take focus), and a sort
 * select in the toolbar takes their place. Every control in the toolbar, the
 * "Show all" button and a linked or selectable row hold a 44px tap floor
 * there.
 *
 * ## Missing values
 *
 * `null`, `undefined`, `''` and a non-finite number are missing (the same
 * test as `NeDataTable`). A missing cell reads the column's `missingText`,
 * else the table's, else the `missing` slot, else an em dash with "No value"
 * for a screen reader. No app is forced into the dash.
 *
 * Tokens only, as the README's styling contract requires.
 */
import UButton from '@nuxt/ui/components/Button.vue'
import ULink from '@nuxt/ui/components/Link.vue'
import USelect from '@nuxt/ui/components/Select.vue'
import { computed, onBeforeUnmount, onMounted, ref, useSlots } from 'vue'

import { formatNumber } from '../../format'
import { useClientCollection } from '../composables/use-client-collection'
import {
  firstDirectionOf,
  NE_COLLECTION_ALL,
  NE_COLLECTION_TOOLBAR_FROM,
} from '../utils/collection-engine'
import { dataTableMinWidth, isMissingValue, parseSort, readColumnValue } from '../utils/data-table'

import { NE_SEARCH_DEBOUNCE_MS } from './ne-search-input-types'
import NeFilterBar from './NeFilterBar.vue'
import NeSearchInput from './NeSearchInput.vue'
import NeSortHeader from './NeSortHeader.vue'

import type {
  NeCollectionColumn,
  NeCollectionGroup,
  NeCollectionStackBreakpoint,
  NeCollectionTableProps,
  NeCollectionTableSlots,
} from './ne-collection-table-types'

const props = withDefaults(defineProps<NeCollectionTableProps<T>>(), {
  defaultFilter: undefined,
  empty: 'No rows',
  filters: undefined,
  groupResetLabel: 'Back to groups',
  groupSort: 'within',
  groupedSort: undefined,
  groups: undefined,
  initialQuery: undefined,
  limit: undefined,
  missingText: undefined,
  more: undefined,
  noMatchText: 'Nothing matches that search and filter.',
  noun: undefined,
  phoneLayout: 'cards',
  primaryColumn: undefined,
  rowAttrs: undefined,
  rowHref: undefined,
  rowKey: undefined,
  rows: undefined,
  searchDebounce: NE_SEARCH_DEBOUNCE_MS,
  searchPlaceholder: 'Search',
  searchText: undefined,
  selectedKey: undefined,
  sort: undefined,
  sortable: true,
  stackBelow: 'md',
  toolbar: true,
})

const emit = defineEmits<{
  /** A row was picked. Only emitted when `selectedKey` is given. */
  select: [key: string | number, row: T]
  /** The sort changed, from a header or the phone sort select. */
  'update:sort': [sort: string | null]
}>()

defineSlots<NeCollectionTableSlots<T>>()
const slots = useSlots()

/**
 * Every class that differs below the stack breakpoint, written out per
 * breakpoint so Tailwind finds each one as a literal in this file.
 */
type StackClass =
  | 'block'
  | 'card'
  | 'cell'
  | 'controls'
  | 'floor'
  | 'free'
  | 'head'
  | 'hide'
  | 'phoneOnly'
  | 'primary'
  | 'tap'
  | 'thTap'

const STACK: Record<NeCollectionStackBreakpoint, Record<StackClass, string>> = {
  sm: {
    block: 'max-sm:block',
    card: 'max-sm:flex max-sm:flex-wrap max-sm:items-baseline max-sm:gap-x-3 max-sm:gap-y-1 max-sm:px-3 max-sm:py-2.5 max-sm:border-b max-sm:border-default',
    cell: 'max-sm:p-0 max-sm:border-0 max-sm:text-start',
    controls:
      'max-sm:[&_input]:min-h-11 max-sm:[&_button]:min-h-11 max-sm:[&_[data-ne-filter-control]]:min-h-11',
    floor: 'sm:min-w-[max(100%,var(--ne-collection-min,0px))]',
    free: 'max-sm:basis-full max-sm:line-clamp-2',
    head: 'max-sm:sr-only',
    hide: 'max-sm:hidden',
    phoneOnly: 'hidden max-sm:inline-flex',
    primary: 'max-sm:basis-full',
    tap: 'max-sm:min-h-11',
    thTap: 'max-sm:[&_button]:min-h-11',
  },
  md: {
    block: 'max-md:block',
    card: 'max-md:flex max-md:flex-wrap max-md:items-baseline max-md:gap-x-3 max-md:gap-y-1 max-md:px-3 max-md:py-2.5 max-md:border-b max-md:border-default',
    cell: 'max-md:p-0 max-md:border-0 max-md:text-start',
    controls:
      'max-md:[&_input]:min-h-11 max-md:[&_button]:min-h-11 max-md:[&_[data-ne-filter-control]]:min-h-11',
    floor: 'md:min-w-[max(100%,var(--ne-collection-min,0px))]',
    free: 'max-md:basis-full max-md:line-clamp-2',
    head: 'max-md:sr-only',
    hide: 'max-md:hidden',
    phoneOnly: 'hidden max-md:inline-flex',
    primary: 'max-md:basis-full',
    tap: 'max-md:min-h-11',
    thTap: 'max-md:[&_button]:min-h-11',
  },
  lg: {
    block: 'max-lg:block',
    card: 'max-lg:flex max-lg:flex-wrap max-lg:items-baseline max-lg:gap-x-3 max-lg:gap-y-1 max-lg:px-3 max-lg:py-2.5 max-lg:border-b max-lg:border-default',
    cell: 'max-lg:p-0 max-lg:border-0 max-lg:text-start',
    controls:
      'max-lg:[&_input]:min-h-11 max-lg:[&_button]:min-h-11 max-lg:[&_[data-ne-filter-control]]:min-h-11',
    floor: 'lg:min-w-[max(100%,var(--ne-collection-min,0px))]',
    free: 'max-lg:basis-full max-lg:line-clamp-2',
    head: 'max-lg:sr-only',
    hide: 'max-lg:hidden',
    phoneOnly: 'hidden max-lg:inline-flex',
    primary: 'max-lg:basis-full',
    tap: 'max-lg:min-h-11',
    thTap: 'max-lg:[&_button]:min-h-11',
  },
}

/** The same lines as media queries, for the one thing CSS cannot do: swap the header's buttons for labels. */
const STACK_QUERY: Record<NeCollectionStackBreakpoint, string> = {
  lg: '(width < 64rem)',
  md: '(width < 48rem)',
  sm: '(width < 40rem)',
}

const stack = computed(() => STACK[props.stackBelow])
const cards = computed(() => props.phoneLayout === 'cards')

interface RenderGroup {
  group?: NeCollectionGroup<T>
  grouped: boolean
  key: string
  rows: T[]
}

const allRows = computed<readonly T[]>(() =>
  props.groups ? props.groups.flatMap((group) => [...group.rows]) : (props.rows ?? []),
)

const toolbarOn = computed(() => {
  const { toolbar } = props
  if (toolbar === false) return false
  if (toolbar === 'always') return true
  const from = typeof toolbar === 'number' ? toolbar : NE_COLLECTION_TOOLBAR_FROM
  return allRows.value.length >= from
})

const collection = useClientCollection<T>({
  columns: () => props.columns,
  filter: () => props.defaultFilter,
  filters: () => props.filters,
  narrowing: toolbarOn,
  query: () => props.initialQuery,
  rows: allRows,
  searchText: (row) => props.searchText?.(row) ?? '',
  sort: () => props.sort,
})

const sortOn = computed(() => props.sortable !== false)
const sortableKeys = computed(() => (sortOn.value ? collection.sortableKeys.value : new Set()))
const sortState = computed(() => parseSort(collection.sort.value))

function setSort(next: string | null) {
  collection.setSort(next)
  emit('update:sort', next)
}

/** The sort under which `groupSort: 'across'` shows the groups. */
const groupedSortValue = computed(() =>
  props.groupedSort === undefined ? (props.sort ?? null) : props.groupedSort,
)

/** An `'across'` table whose sort has set the group headings aside. */
const sortedAcross = computed(
  () =>
    props.groupSort === 'across' &&
    props.groups !== undefined &&
    collection.sort.value !== null &&
    collection.sort.value !== groupedSortValue.value,
)

function backToGroups() {
  setSort(groupedSortValue.value)
}

/** Every row search and filter keep, grouped, before `limit` cuts it. Empty groups are dropped. */
const matchedGroups = computed<RenderGroup[]>(() => {
  if (!props.groups || sortedAcross.value) {
    return [
      {
        grouped: false,
        key: sortedAcross.value ? '__ne-across' : '__ne-rows',
        rows: collection.rows.value,
      },
    ]
  }
  return props.groups
    .map((group) => ({
      group,
      grouped: true,
      key: group.key,
      rows: collection.apply(group.rows),
    }))
    .filter((group) => group.rows.length > 0)
})

const matchedCount = computed(() =>
  matchedGroups.value.reduce((sum, group) => sum + group.rows.length, 0),
)

const expanded = ref(false)
const limited = computed(
  () => !expanded.value && props.limit !== undefined && matchedCount.value > props.limit,
)

const renderGroups = computed<RenderGroup[]>(() => {
  if (!limited.value || props.limit === undefined) return matchedGroups.value
  let budget = props.limit
  return matchedGroups.value
    .map((group) => {
      const rows = group.rows.slice(0, Math.max(budget, 0))
      budget -= rows.length
      return { ...group, rows }
    })
    .filter((group) => group.rows.length > 0)
})

const countLabel = computed(() => {
  const total = allRows.value.length
  const noun = props.noun ?? (total === 1 ? 'row' : 'rows')
  const shown = matchedCount.value
  return `${shown === total ? formatNumber(total) : `${formatNumber(shown)} of ${formatNumber(total)}`} ${noun}`
})

const nothingMatches = computed(() => allRows.value.length > 0 && matchedCount.value === 0)
const isEmpty = computed(() => allRows.value.length === 0)

/* ---- the stacked form ------------------------------------------------ */

const stacked = ref(false)
let stopStacked: (() => void) | undefined
onMounted(() => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
  const media = window.matchMedia(STACK_QUERY[props.stackBelow])
  stacked.value = media.matches
  const follow = (event: MediaQueryListEvent) => {
    stacked.value = event.matches
  }
  media.addEventListener('change', follow)
  stopStacked = () => media.removeEventListener('change', follow)
})
onBeforeUnmount(() => stopStacked?.())

/** The header draws plain labels where the card layout has hidden it. */
const headerButtons = computed(() => !(cards.value && stacked.value))

/**
 * What a full-width cell (a group heading, the empty row, the footer) spans.
 * In the stacked `columns` layout the `phone: false` columns are gone, and a
 * span over them makes the browser invent that many anonymous columns, which
 * then split the free width with the primary column and starve it (measured in
 * operator-portal's grouped /projects at 375px: four phantom columns left the
 * name 22px, #1425; and until hydration, 34px, #1432).
 *
 * So the `columns` layout spans the kept columns only, and pads the row with
 * one filler cell per dropped column, hidden below the breakpoint with those
 * columns. Above it the span plus the fillers cover every column; below it
 * only the span is left, over exactly the columns that are left. Both are
 * CSS, so the server's markup is already right at either width, with no
 * viewport to measure and no count to settle on mount.
 */
const fullSpan = computed(() =>
  cards.value
    ? props.columns.length
    : Math.max(1, props.columns.filter((column) => column.phone !== false).length),
)

/** How many filler cells pad a full-width row out to every column above the breakpoint. */
const spanFill = computed(() => Math.max(0, props.columns.length - fullSpan.value))

/** The phone sort select, for the card layout, whose header is hidden. */
const DEFAULT_SORT = '__ne-default'
const sortColumns = computed(() =>
  props.columns.filter((column) => sortableKeys.value.has(column.key)),
)
const phoneSortOn = computed(() => cards.value && sortColumns.value.length > 0)
const sortItems = computed(() => [
  { label: 'Default order', value: DEFAULT_SORT },
  ...sortColumns.value.map((column) => ({ label: column.label, value: column.key })),
])

function chooseSort(value: unknown) {
  const key = typeof value === 'string' && value !== DEFAULT_SORT ? value : null
  const column = key ? props.columns.find((candidate) => candidate.key === key) : undefined
  setSort(column ? `${column.key}:${firstDirectionOf(column)}` : null)
}

function flipSort() {
  const current = sortState.value
  if (current) setSort(`${current.key}:${current.direction === 'asc' ? 'desc' : 'asc'}`)
}

/* ---- cells ----------------------------------------------------------- */

const primaryKey = computed(() => props.primaryColumn ?? props.columns[0]?.key)

const tableMinWidth = computed(() => dataTableMinWidth(props.columns))

function isEnd(column: NeCollectionColumn<T>): boolean {
  return column.numeric === true || column.align === 'end'
}

function ariaSort(column: NeCollectionColumn<T>): 'ascending' | 'descending' | undefined {
  const state = sortState.value
  if (!state || state.key !== column.key || !sortableKeys.value.has(column.key)) return
  return state.direction === 'asc' ? 'ascending' : 'descending'
}

function thClass(column: NeCollectionColumn<T>): string {
  return [
    'px-3 py-2 text-xs font-medium text-muted whitespace-nowrap border-b border-default bg-elevated/50',
    isEnd(column) ? 'text-end' : 'text-start',
    column.phone === false ? stack.value.hide : '',
    cards.value ? '' : stack.value.thTap,
  ].join(' ')
}

function tdClass(column: NeCollectionColumn<T>): string {
  const primary = column.key === primaryKey.value
  const dropped = column.phone === false
  const classes = [
    'px-3 py-2 text-sm align-top border-b border-default [overflow-wrap:anywhere]',
    isEnd(column) ? 'text-end' : 'text-start',
    column.numeric ? 'font-mono tabular-nums' : '',
    primary || column.emphasis ? 'font-medium text-highlighted' : 'text-default',
    sortState.value?.key === column.key ? 'bg-elevated/50' : '',
  ]
  if (dropped) classes.push(stack.value.hide)
  else if (cards.value) {
    classes.push(stack.value.cell)
    if (column.freeText) classes.push(stack.value.free)
    else classes.push(stack.value.block, primary ? stack.value.primary : '')
  }
  return classes.join(' ')
}

function rowClass(row: T): string {
  const linked = hrefOf(row) !== null
  return [
    selectable.value || linked ? 'cursor-pointer hover:bg-elevated/50' : '',
    isSelected(row) ? 'bg-elevated' : '',
    cards.value ? stack.value.card : '',
    cards.value && (selectable.value || linked) ? stack.value.tap : '',
    'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary',
  ].join(' ')
}

function plainText(column: NeCollectionColumn<T>, row: T, value: unknown): string | null {
  if (isMissingValue(value)) return null
  if (column.format) return column.format(value, row)
  if (typeof value === 'number') return formatNumber(value)
  if (typeof value === 'string') return value
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) {
    const parts = value.filter((part) => typeof part === 'string' || typeof part === 'number')
    return parts.length > 0 ? parts.join(', ') : null
  }
  return null
}

/** A slotless cell's text, or `null` when the value is missing. */
function cellText(column: NeCollectionColumn<T>, row: T): string | null {
  return plainText(column, row, readColumnValue(column, row))
}

/** A link's text must not be empty, so a missing primary reads its word, else the dash. */
function linkText(column: NeCollectionColumn<T>, row: T): string {
  return cellText(column, row) ?? missingWord(column, row) ?? '—'
}

function missingWord(column: NeCollectionColumn<T>, row: T): string | undefined {
  const own =
    typeof column.missingText === 'function' ? column.missingText(row) : column.missingText
  return own ?? props.missingText
}

function hasSlot(name: string): boolean {
  return slots[name] !== undefined
}

/* ---- rows: links and selection --------------------------------------- */

function hrefOf(row: T): string | null {
  return props.rowHref?.(row) ?? null
}

/** Each row's position in the caller's set, so a default key does not move when the rows are sorted. */
const sourceIndex = computed(() => new Map(allRows.value.map((row, index) => [row, index])))

function keyOf(row: T): string | number {
  const index = sourceIndex.value.get(row) ?? 0
  if (props.rowKey) return props.rowKey(row, index)
  if (row !== null && typeof row === 'object') {
    const record = row as Record<string, unknown>
    const candidate = record.id ?? record.key
    if (typeof candidate === 'string' || typeof candidate === 'number') return candidate
  }
  return index
}

const selectable = computed(() => props.selectedKey !== undefined)

function isSelected(row: T): boolean {
  if (!selectable.value || props.selectedKey === null) return false
  return keyOf(row) === props.selectedKey
}

function pick(row: T) {
  if (selectable.value) emit('select', keyOf(row), row)
}

const INTERACTIVE = 'a, button, input, select, textarea, summary, [role="button"], [role="option"]'

/** A click on a row's own link or control is that control's; anywhere else picks the row and follows its link. */
function onRowClick(event: MouseEvent, row: T) {
  const target = event.target as HTMLElement | null
  if (target?.closest(INTERACTIVE)) return
  pick(row)
  if (!hrefOf(row) || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return
  const link = (event.currentTarget as HTMLElement).querySelector<HTMLElement>('[data-ne-row-link]')
  link?.click()
}

/** Enter or Space on a focused row picks it; a key pressed inside a control is that control's. */
function onRowKey(event: KeyboardEvent, row: T) {
  if (!selectable.value || event.target !== event.currentTarget) return
  event.preventDefault()
  pick(row)
}

function rowAttrsOf(row: T): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [name, value] of Object.entries(props.rowAttrs?.(row) ?? {})) {
    if (value !== undefined) out[name] = value
  }
  return out
}

function groupAttrs(group: NeCollectionGroup<T> | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [name, value] of Object.entries(group?.attrs ?? {})) {
    if (value !== undefined) out[name] = value
  }
  return out
}

const filterModel = computed({
  get: () => collection.filter.value,
  set: (value: string | null) => {
    collection.filter.value = value ?? NE_COLLECTION_ALL
  },
})
</script>

<template>
  <div
    data-ne-collection-table
    :data-ne-phone-layout="phoneLayout"
    :data-ne-sorted-across="sortedAcross ? '' : undefined"
    :data-ne-stack-below="stackBelow"
    class="min-w-0 max-w-full"
  >
    <div
      v-if="toolbarOn || sortedAcross || $slots.toolbar"
      data-ne-collection-toolbar
      class="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2"
      :class="stack.controls"
    >
      <NeSearchInput
        v-if="toolbarOn"
        v-model="collection.query.value"
        class="min-w-0 flex-[0_1_20rem] max-sm:basis-full"
        :debounce="searchDebounce"
        :label="`Search ${caption}`"
        :placeholder="searchPlaceholder"
      />
      <NeFilterBar
        v-if="toolbarOn && collection.items.value.length > 0"
        v-model="filterModel"
        flush
        :items="collection.items.value"
        :label="`Filter ${caption}`"
      />
      <div class="flex basis-full flex-wrap items-center gap-x-4 gap-y-1.5">
        <span
          v-if="toolbarOn"
          data-ne-collection-count
          class="text-sm text-muted tabular-nums"
          aria-live="polite"
          >{{ countLabel }}</span
        >
        <span
          v-if="phoneSortOn"
          data-ne-collection-phone-sort
          class="items-center gap-1.5"
          :class="stack.phoneOnly"
        >
          <USelect
            :model-value="sortState?.key ?? DEFAULT_SORT"
            :items="sortItems"
            size="sm"
            aria-label="Sort"
            @update:model-value="chooseSort"
          />
          <UButton
            v-if="sortState"
            color="neutral"
            variant="outline"
            size="sm"
            :icon="sortState.direction === 'asc' ? 'i-lucide-arrow-up' : 'i-lucide-arrow-down'"
            :aria-label="`Sorted ${sortState.direction === 'asc' ? 'ascending' : 'descending'}; reverse`"
            @click="flipSort"
          />
        </span>
        <UButton
          v-if="sortedAcross"
          data-ne-collection-group-reset
          color="neutral"
          variant="outline"
          size="sm"
          icon="i-lucide-list-tree"
          :class="stack.tap"
          :label="groupResetLabel"
          @click="backToGroups"
        />
        <slot name="toolbar" />
      </div>
    </div>

    <div
      v-if="nothingMatches"
      data-ne-collection-none
      role="status"
      class="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-(--ne-radius-panel) border border-dashed border-default px-3.5 py-2.5 text-sm text-muted"
    >
      <span>{{ noMatchText }}</span>
      <UButton
        variant="link"
        size="sm"
        class="p-0"
        :class="stack.tap"
        label="Show all"
        @click="collection.reset"
      />
    </div>

    <div
      data-ne-collection-scroll
      class="min-w-0 max-w-full overflow-x-auto rounded-(--ne-radius-panel) border border-default focus-visible:outline-2 focus-visible:outline-primary"
      role="group"
      tabindex="0"
      :aria-label="caption"
      :style="tableMinWidth ? { '--ne-collection-min': tableMinWidth } : undefined"
    >
      <table
        role="table"
        class="w-full table-fixed border-separate border-spacing-0 bg-default"
        :class="[tableMinWidth ? stack.floor : '', cards ? stack.block : '']"
      >
        <caption class="sr-only">
          {{
            caption
          }}
        </caption>
        <colgroup>
          <col
            v-for="column in columns"
            :key="column.key"
            :class="column.phone === false ? stack.hide : ''"
            :style="column.width ? { width: column.width } : undefined"
          />
        </colgroup>
        <thead role="rowgroup" :class="cards ? stack.head : ''">
          <tr role="row">
            <th
              v-for="column in columns"
              :key="`${column.key}:${headerButtons ? 'sort' : 'label'}`"
              scope="col"
              role="columnheader"
              :class="thClass(column)"
              :aria-sort="ariaSort(column)"
              :data-ne-column="column.key"
            >
              <slot
                v-if="hasSlot(`${column.key}-header`)"
                :name="`${column.key}-header`"
                :column="column"
              />
              <NeSortHeader
                v-else-if="sortableKeys.has(column.key) && headerButtons"
                :label="column.label"
                :unit="column.unit"
                :sort-key="column.key"
                :sort="collection.sort.value"
                :align="isEnd(column) ? 'end' : 'start'"
                :first-direction="firstDirectionOf(column)"
                @update:sort="setSort"
              />
              <span v-else class="inline-flex gap-1">
                <span>{{ column.label }}</span>
                <span v-if="column.unit" data-ne-unit class="font-normal text-dimmed">{{
                  column.unit
                }}</span>
              </span>
            </th>
          </tr>
        </thead>
        <tbody v-if="isEmpty" role="rowgroup" :class="cards ? stack.block : ''">
          <tr role="row" :class="cards ? stack.block : ''">
            <td
              role="cell"
              data-ne-collection-empty
              :colspan="fullSpan"
              class="px-3 py-6 text-center text-sm text-muted"
              :class="cards ? stack.block : ''"
            >
              {{ empty }}
            </td>
            <td
              v-for="n in spanFill"
              :key="`fill-${n}`"
              aria-hidden="true"
              data-ne-collection-fill
              class="px-0 py-6"
              :class="stack.hide"
            />
          </tr>
        </tbody>
        <tbody
          v-for="group in renderGroups"
          :key="group.key"
          role="rowgroup"
          :class="cards ? stack.block : ''"
        >
          <tr v-if="group.grouped" role="row" :class="cards ? stack.block : ''">
            <th
              scope="rowgroup"
              role="rowheader"
              data-ne-collection-group
              :colspan="fullSpan"
              class="border-b border-default bg-muted px-3 pt-3 pb-1.5 text-start text-sm font-medium text-highlighted"
              :class="cards ? stack.block : ''"
              v-bind="groupAttrs(group.group)"
            >
              <slot
                v-if="$slots.group && group.group"
                name="group"
                :group="group.group"
                :rows="group.rows"
              />
              <template v-else>
                <span>{{ group.group?.label }}</span>
                <span
                  v-if="group.group?.count !== undefined"
                  data-ne-collection-group-count
                  class="ms-1.5 font-normal text-muted tabular-nums"
                  >{{ group.group.count }}</span
                >
              </template>
            </th>
            <td
              v-for="n in spanFill"
              :key="`fill-${n}`"
              aria-hidden="true"
              data-ne-collection-fill
              class="border-b border-default bg-muted p-0"
              :class="stack.hide"
            />
          </tr>
          <tr
            v-for="row in group.rows"
            :key="keyOf(row)"
            role="row"
            data-ne-collection-row
            v-bind="rowAttrsOf(row)"
            :class="rowClass(row)"
            :aria-current="isSelected(row) ? 'true' : undefined"
            :tabindex="selectable ? 0 : undefined"
            @click="onRowClick($event, row)"
            @keydown.enter="onRowKey($event, row)"
            @keydown.space="onRowKey($event, row)"
          >
            <td
              v-for="column in columns"
              :key="column.key"
              role="cell"
              :class="tdClass(column)"
              :data-ne-column="column.key"
            >
              <ULink
                v-if="column.key === primaryKey && hrefOf(row) !== null"
                data-ne-row-link
                :to="hrefOf(row) ?? undefined"
                class="text-inherit hover:underline focus-visible:underline"
                raw
              >
                <slot
                  v-if="hasSlot(`${column.key}-cell`)"
                  :name="`${column.key}-cell`"
                  :column="column"
                  :row="row"
                  :value="readColumnValue(column, row)"
                />
                <template v-else>{{ linkText(column, row) }}</template>
              </ULink>
              <slot
                v-else-if="hasSlot(`${column.key}-cell`)"
                :name="`${column.key}-cell`"
                :column="column"
                :row="row"
                :value="readColumnValue(column, row)"
              />
              <template v-else-if="cellText(column, row) !== null">{{
                cellText(column, row)
              }}</template>
              <span
                v-else-if="missingWord(column, row) !== undefined"
                data-ne-missing
                class="text-dimmed"
                >{{ missingWord(column, row) }}</span
              >
              <span v-else-if="$slots.missing" data-ne-missing>
                <slot name="missing" :column="column" :row="row" />
              </span>
              <span v-else data-ne-missing class="text-dimmed"
                ><span aria-hidden="true">—</span><span class="sr-only">No value</span></span
              >
            </td>
          </tr>
        </tbody>
        <tfoot v-if="more || $slots.more" role="rowgroup" :class="cards ? stack.block : ''">
          <tr role="row" :class="cards ? stack.block : ''">
            <td
              role="cell"
              data-ne-collection-more
              :colspan="fullSpan"
              class="bg-muted px-3 py-2.5 font-mono text-xs text-muted"
              :class="cards ? stack.block : ''"
            >
              <slot name="more" :more="more">
                {{ more?.label
                }}<template v-if="more?.href">
                  ·
                  <ULink :to="more.href" class="text-default underline underline-offset-2">{{
                    more.linkLabel ?? 'see all'
                  }}</ULink></template
                >
              </slot>
            </td>
            <td
              v-for="n in spanFill"
              :key="`fill-${n}`"
              aria-hidden="true"
              data-ne-collection-fill
              class="bg-muted p-0"
              :class="stack.hide"
            />
          </tr>
        </tfoot>
      </table>
    </div>

    <UButton
      v-if="limited"
      data-ne-collection-show-all
      class="mt-3 justify-center"
      :class="stack.tap"
      color="neutral"
      variant="outline"
      block
      :label="`Show all ${formatNumber(matchedCount)}`"
      @click="expanded = true"
    />
  </div>
</template>
