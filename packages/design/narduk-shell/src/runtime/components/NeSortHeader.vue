<script setup lang="ts">
/**
 * NeSortHeader — a sortable column header (narduk-libs#528), promoted from
 * stonx's `SortableTableHeader.vue`, which took a TanStack `column` and a
 * label and toggled it. This keeps that call shape (`:column`) and adds what
 * the buoys round-2 board asks of every sortable table:
 *
 * - **First click picks the useful way.** `firstDirection` — readings go
 *   strongest first, names A–Z. The second click flips it. There is no third
 *   "unsorted" click; a Reset control outside the table does that.
 * - **Server mode.** `sortKey` + `sort` (wire form, `'wind:desc'`) emit
 *   `update:sort`, which is what `useCollection().setSort` takes. The header
 *   never reorders rows; the server does.
 * - **`aria-sort` on the `<th>`.** The attribute belongs to the column header
 *   cell, not to the button inside it, and `UTable` gives a header slot no way
 *   to set attributes on its `<th>`. So the header writes it onto its closest
 *   `<th>` after mount and removes it when the column stops being sorted —
 *   at rest a column carries no `aria-sort` at all.
 *
 * The column tint is the table's business, not the header's: `NeDataTable`
 * draws it down the sorted column.
 */
import UButton from '@nuxt/ui/components/Button.vue'
import { computed, onBeforeUnmount, shallowRef, watch } from 'vue'

import { nextSortDirection, parseSort } from '../utils/data-table'

import type { NeSortDirection, NeSortHeaderProps } from './ne-data-table-types'

const props = withDefaults(defineProps<NeSortHeaderProps>(), {
  align: 'start',
  column: undefined,
  firstDirection: 'asc',
  sort: null,
  sortKey: undefined,
  unit: undefined,
})

const emit = defineEmits<{ 'update:sort': [sort: string] }>()

const direction = computed<false | NeSortDirection>(() => {
  if (props.column) return props.column.getIsSorted()
  const parsed = parseSort(props.sort)
  return parsed && props.sortKey && parsed.key === props.sortKey ? parsed.direction : false
})

const icon = computed(() => {
  if (direction.value === 'asc') return 'i-lucide-arrow-up'
  if (direction.value === 'desc') return 'i-lucide-arrow-down'
  return undefined
})

const ariaSort = computed(() => {
  if (direction.value === 'asc') return 'ascending'
  if (direction.value === 'desc') return 'descending'
  return undefined
})

function toggle(): void {
  const next = nextSortDirection(direction.value, props.firstDirection)
  if (props.column) {
    props.column.toggleSorting(next === 'desc')
    return
  }
  if (props.sortKey) emit('update:sort', `${props.sortKey}:${next}`)
}

const root = shallowRef<HTMLElement | null>(null)

function cell(): HTMLTableCellElement | null {
  return root.value?.closest('th') ?? null
}

watch(
  [root, ariaSort],
  ([, value]) => {
    const th = cell()
    if (!th) return
    if (value) th.setAttribute('aria-sort', value)
    else th.removeAttribute('aria-sort')
  },
  { flush: 'post' },
)

onBeforeUnmount(() => cell()?.removeAttribute('aria-sort'))
</script>

<template>
  <span
    ref="root"
    data-ne-sort-header
    :data-ne-sort-direction="direction || undefined"
    class="inline-flex"
    :class="align === 'end' ? 'justify-end' : 'justify-start'"
  >
    <UButton
      color="neutral"
      variant="ghost"
      size="xs"
      class="-mx-2 gap-1 font-medium"
      :class="direction ? 'text-highlighted' : 'text-muted'"
      :trailing-icon="icon"
      @click="toggle"
    >
      <span>{{ label }}</span>
      <span v-if="unit" data-ne-unit class="font-normal text-dimmed">{{ unit }}</span>
    </UButton>
  </span>
</template>
