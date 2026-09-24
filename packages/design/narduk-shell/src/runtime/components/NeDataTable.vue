<script setup lang="ts" generic="T">
/**
 * NeDataTable — the estate's data-table preset on Nuxt UI's `UTable`
 * (narduk-libs#528; components-library-plan.md §7, "Wrap Nuxt UI UTable").
 *
 * The eslint pack already forces `UTable`; this is the reading every history
 * and list table in the estate re-derived by hand: a sticky header, column
 * groups with their unit drawn once, right-aligned tabular numerals, one
 * missing-value style, day (group) rows, a sticky first column, a phone
 * column-set switch, the "no value, sorted last" break row, and a loading
 * reading that keeps the rows on screen.
 *
 * ## It never reorders rows
 *
 * Sorting belongs to whoever owns the set — the server, through
 * `useCollection().setSort`. The table draws the arrow, `aria-sort` and the
 * column tint for `sort`, emits `update:sort` on a header click, and renders
 * `rows` in the order they arrived. A table that sorted the 25 rows it holds
 * is exactly the "Wind ↓ sorts one page" bug the round-2 board opens with.
 *
 * ## Group and break rows are rows
 *
 * `UTable` has no full-width row. Day rows and the break row are extra
 * entries in the data handed to it: their first cell spans every column and
 * the remaining cells are `hidden`, so the markup stays one `<tr>` per line and
 * TanStack still owns the body.
 *
 * ## It owns its sideways overflow
 *
 * `UTable`'s root is the table's scroll box (`data-ne-data-table-scroll`), and
 * both it and the outer wrapper carry `min-w-0 max-w-full`, so one long
 * unbreakable string (a hostname, a SHA) scrolls the box, never the page —
 * including inside a flex or grid parent, whose item would otherwise grow to
 * the table's width. `stickyHeader: 'page'` gives the box up (a scroll box
 * would pin the header to itself), and with it the column floor below.
 *
 * ## The column floor is on the table, not the cell
 *
 * A cell ignores `min-width`, so a width-less column beside fixed-width ones
 * gets only what they leave over. Once any column declares a `width`, the
 * `<table>` takes `min-width: max(100%, var(--ne-data-table-min))`, where the
 * custom property is `calc(<each width, or 200px> + …)` set inline on the
 * scroll box (`dataTableMinWidth`, narduk-libs#684). It applies from `sm` up
 * only: on a phone the column-set switch hides groups the sum still counts,
 * so the floor would force a sideways scroll the switch exists to avoid.
 *
 * ## Styling
 *
 * Tokens only (see the README's styling contract). Numerals are
 * `font-mono tabular-nums`, the headline column is `font-medium`, missing is
 * an em dash in `text-dimmed` with "No value" for a screen reader, and the
 * sorted column carries `bg-elevated/50`.
 */
import UTable from '@nuxt/ui/components/Table.vue'
import UTabs from '@nuxt/ui/components/Tabs.vue'
import { computed, h, shallowRef, type VNodeChild } from 'vue'

import { formatNumber } from '../../format'
import { dataTableMinWidth, isMissingValue, parseSort, readColumnValue } from '../utils/data-table'
import NeSortHeader from './NeSortHeader.vue'

import type {
  NeDataColumn,
  NeDataColumnGroup,
  NeDataTableProps,
  NeDataTableSlots,
} from './ne-data-table-types'

const props = withDefaults(defineProps<NeDataTableProps<T>>(), {
  caption: undefined,
  columnSet: undefined,
  dropEmptyColumns: false,
  empty: 'No rows',
  groupBy: undefined,
  groupLabel: undefined,
  groups: () => [],
  loading: false,
  missingCount: null,
  missingLabel: undefined,
  missingLast: true,
  phoneColumnSets: undefined,
  rowKey: undefined,
  sort: null,
  stickyHeader: true,
})

const emit = defineEmits<{
  'update:sort': [sort: string]
  'update:columnSet': [id: string]
}>()

const slots = defineSlots<NeDataTableSlots<T>>()

type Entry =
  | { id: string; index: number; kind: 'row'; row: T }
  | { id: string; key: string; kind: 'group'; rows: T[] }
  | { count: number; id: string; kind: 'break' }

/** Columns the table draws: never `csvOnly`, and optionally never all-empty. */
const shownColumns = computed<NeDataColumn<T>[]>(() =>
  props.columns.filter((column) => {
    if (column.csvOnly) return false
    if (!props.dropEmptyColumns || column.sticky || props.rows.length === 0) return true
    return props.rows.some((row) => !isMissingValue(readColumnValue(column, row)))
  }),
)

const groupsById = computed(() => new Map(props.groups.map((group) => [group.id, group])))

/** Groups that actually have a shown column, in column order. */
const usedGroups = computed<NeDataColumnGroup[]>(() => {
  const seen = new Set<string>()
  const used: NeDataColumnGroup[] = []
  for (const column of shownColumns.value) {
    const group = column.group ? groupsById.value.get(column.group) : undefined
    if (group && !seen.has(group.id)) {
      seen.add(group.id)
      used.push(group)
    }
  }
  return used
})

const phoneSets = computed(() => props.phoneColumnSets ?? usedGroups.value.length > 1)

/** Uncontrolled fallback, so the switch works without `v-model:column-set`. */
const localSet = shallowRef<string | undefined>()

const activeSet = computed<string | undefined>({
  get: () => {
    const wanted = props.columnSet ?? localSet.value
    return usedGroups.value.find((group) => group.id === wanted)?.id ?? usedGroups.value[0]?.id
  },
  set: (id) => {
    if (id === undefined) return
    localSet.value = String(id)
    emit('update:columnSet', String(id))
  },
})

function phoneHidden(column: NeDataColumn<T>): boolean {
  return (
    phoneSets.value &&
    !column.sticky &&
    !!column.group &&
    groupsById.value.has(column.group) &&
    column.group !== activeSet.value
  )
}

const sortState = computed(() => parseSort(props.sort))

const sortedColumn = computed(() => {
  const key = sortState.value?.key
  return key ? shownColumns.value.find((column) => column.sortKey === key) : undefined
})

const entries = computed<Entry[]>(() => {
  const out: Entry[] = []
  const sorted = props.missingLast ? sortedColumn.value : undefined
  const missing = sorted
    ? props.rows.filter((row) => isMissingValue(readColumnValue(sorted, row))).length
    : 0
  let breakPlaced = false
  let openGroup: Extract<Entry, { kind: 'group' }> | null = null

  props.rows.forEach((row, index) => {
    if (sorted && !breakPlaced && isMissingValue(readColumnValue(sorted, row))) {
      breakPlaced = true
      out.push({ count: props.missingCount ?? missing, id: '__ne-break', kind: 'break' })
    }
    if (props.groupBy) {
      const key = props.groupBy(row) ?? null
      if (key === null) openGroup = null
      else if (openGroup?.key !== key) {
        openGroup = { id: `__ne-group-${index}-${key}`, key, kind: 'group', rows: [] }
        out.push(openGroup)
      }
      openGroup?.rows.push(row)
    }
    out.push({
      id: props.rowKey ? props.rowKey(row, index) : String(index),
      index,
      kind: 'row',
      row,
    })
  })
  return out
})

const missingNode = (): VNodeChild =>
  h('span', { 'data-ne-missing': '', class: 'text-dimmed' }, [
    h('span', { 'aria-hidden': 'true' }, '—'),
    h('span', { class: 'sr-only' }, 'No value'),
  ])

function unitNode(unit: string | undefined): VNodeChild {
  return unit ? h('span', { 'data-ne-unit': '', class: 'font-normal text-dimmed' }, unit) : null
}

function headerNode(column: NeDataColumn<T>): VNodeChild {
  if (column.sortKey) {
    return h(NeSortHeader, {
      align: column.numeric ? 'end' : 'start',
      firstDirection: column.firstDirection ?? 'asc',
      label: column.label,
      'onUpdate:sort': (next: string) => emit('update:sort', next),
      sort: props.sort,
      sortKey: column.sortKey,
      unit: column.unit,
    })
  }
  return h('span', { class: 'inline-flex gap-1' }, [h('span', column.label), unitNode(column.unit)])
}

function breakText(count: number): string {
  if (props.missingLabel) return props.missingLabel
  const label = sortedColumn.value?.label ?? 'this column'
  const rows = count === 1 ? '1 row has' : `${formatNumber(count)} rows have`
  return `${rows} no ${label} value · sorted last`
}

function cellNode(column: NeDataColumn<T>, entry: Entry, leaf: number): VNodeChild {
  if (entry.kind === 'group') {
    if (leaf !== 0) return null
    const content =
      slots.group?.({ key: entry.key, rows: entry.rows }) ??
      (props.groupLabel ? props.groupLabel(entry.key, entry.rows) : entry.key)
    return h('span', { 'data-ne-group-row': entry.key }, content)
  }
  if (entry.kind === 'break') {
    if (leaf !== 0) return null
    const content =
      slots.break?.({ column: sortedColumn.value, count: entry.count }) ?? breakText(entry.count)
    return h('span', { 'data-ne-break-row': '' }, content)
  }
  const value = readColumnValue(column, entry.row)
  const custom = slots[`${column.key}-cell`]
  if (custom) return custom({ column, row: entry.row, value })
  if (isMissingValue(value)) return missingNode()
  return column.format ? column.format(value, entry.row) : String(value)
}

function thClass(column: NeDataColumn<T>): string {
  return [
    column.numeric ? 'text-end' : '',
    sortedColumn.value === column ? 'bg-elevated/50' : '',
    phoneHidden(column) ? 'max-sm:hidden' : '',
  ].join(' ')
}

function tdClass(column: NeDataColumn<T>, entry: Entry, leaf: number): string {
  if (entry.kind !== 'row') {
    if (leaf !== 0) return 'hidden'
    return entry.kind === 'group'
      ? 'bg-muted py-1.5 text-xs font-medium text-highlighted'
      : 'py-1.5 text-xs text-muted'
  }
  return [
    column.numeric ? 'text-end font-mono tabular-nums' : '',
    column.emphasis ? 'font-medium text-highlighted' : 'text-default',
    sortedColumn.value === column ? 'bg-elevated/50' : '',
    phoneHidden(column) ? 'max-sm:hidden' : '',
  ].join(' ')
}

interface CellContext {
  row: { original: Entry }
}

/** Leaf column definitions, with TanStack's contiguous column groups on top. */
const tableColumns = computed(() => {
  const leafCount = shownColumns.value.length
  const leaf = (column: NeDataColumn<T>, index: number) => ({
    accessorFn: (entry: Entry) =>
      entry.kind === 'row' ? readColumnValue(column, entry.row) : undefined,
    cell: ({ row }: CellContext) => cellNode(column, row.original, index),
    header: () => headerNode(column),
    id: column.key,
    meta: {
      class: {
        td: (cell: CellContext) => tdClass(column, cell.row.original, index),
        th: () => thClass(column),
      },
      colspan: {
        td: (cell: CellContext) =>
          index === 0 && cell.row.original.kind !== 'row' ? leafCount : undefined,
      },
      style: { th: column.width ? { width: column.width } : undefined },
    },
  })

  type Leaf = ReturnType<typeof leaf>
  type Group = { columns: Leaf[]; group: NeDataColumnGroup }
  const top: Array<Leaf | Group> = []
  shownColumns.value.forEach((column, index) => {
    const group = column.group ? groupsById.value.get(column.group) : undefined
    const last = top.at(-1)
    if (!group) top.push(leaf(column, index))
    else if (last && 'group' in last && last.group.id === group.id)
      last.columns.push(leaf(column, index))
    else top.push({ columns: [leaf(column, index)], group })
  })

  return top.map((item) => {
    if (!('group' in item)) return item
    const { group } = item
    return {
      columns: item.columns,
      header: () =>
        h('span', { class: 'flex flex-col', 'data-ne-column-group': group.id }, [
          h('span', group.label),
          unitNode(group.unit),
        ]),
      id: `__ne-group-${group.id}`,
      meta: {
        class: {
          th: () =>
            [
              'border-b border-default',
              phoneSets.value && group.id !== activeSet.value ? 'max-sm:hidden' : '',
            ].join(' '),
        },
      },
    }
  })
})

const columnPinning = computed(() => ({
  left: shownColumns.value.filter((column) => column.sticky).map((column) => column.key),
  right: [],
}))

const tableMeta = {
  class: {
    tr: (row: { original: Entry }) =>
      row.original.kind === 'row' ? 'hover:bg-elevated/50' : undefined,
  },
}

const pageSticky = computed(() => props.stickyHeader === 'page')

/**
 * The table-level column floor, or `undefined`. Never under a page-sticky
 * header: without the scroll box a floor would scroll the page sideways.
 */
const tableMinWidth = computed(() =>
  pageSticky.value ? undefined : dataTableMinWidth(shownColumns.value),
)

const scrollStyle = computed(() =>
  tableMinWidth.value ? { '--ne-data-table-min': tableMinWidth.value } : undefined,
)

const ui = computed(() => ({
  root: ['min-w-0 max-w-full', pageSticky.value ? 'overflow-visible' : 'overflow-auto'].join(' '),
  // `min-w-full` from the theme still holds below `sm`; see "column floor" above.
  base: tableMinWidth.value ? 'sm:min-w-[max(100%,var(--ne-data-table-min,0px))]' : undefined,
  thead: [
    pageSticky.value ? 'top-(--ui-header-height)' : '',
    props.loading ? 'after:h-0.5' : '',
  ].join(' '),
  tbody: ['transition-opacity', props.loading ? 'opacity-50' : ''].join(' '),
  th: 'px-3 py-2 text-xs font-medium text-muted whitespace-nowrap',
  td: 'px-3 py-2 text-sm whitespace-nowrap',
}))

const tabItems = computed(() =>
  usedGroups.value.map((group) => ({ label: group.label, value: group.id })),
)
</script>

<template>
  <div data-ne-data-table class="min-w-0 max-w-full" :aria-busy="loading ? 'true' : undefined">
    <UTabs
      v-if="phoneSets"
      v-model="activeSet"
      data-ne-column-sets
      class="mb-2 sm:hidden"
      :content="false"
      :items="tabItems"
      size="xs"
      aria-label="Columns shown"
    />
    <UTable
      :data-ne-data-table-scroll="pageSticky ? undefined : ''"
      :style="scrollStyle"
      :caption="caption"
      :column-pinning="columnPinning"
      :columns="tableColumns as never"
      :data="entries"
      :empty="empty"
      :get-row-id="(entry: Entry) => entry.id"
      :loading="loading"
      :meta="tableMeta as never"
      :sticky="stickyHeader ? 'header' : false"
      :ui="ui"
    />
  </div>
</template>
