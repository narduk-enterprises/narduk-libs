<script setup lang="ts" generic="T">
/**
 * NeAdminListPage — an admin list screen on ONE `useCollection()`
 * (components backlog item 20, narduk-libs#267).
 *
 * `NePageHeader` on top, a toolbar (`NeSearchInput` bound to `c.q` plus the
 * page's own filters), `NeDataTable` for the rows and `NePager` under it.
 * This is composition, not new behaviour: every control writes back through
 * the collection's own mutators — the sort header through `setSort`, the
 * search through `c.q`, the pager through `state` (page only) and
 * `setLimit` — so the page reset, the single-flight fetch and the clamp that
 * `useCollection` guarantees hold for the whole screen without the page
 * wiring any of them.
 *
 * Filters are a slot, not a prop. A filter's value belongs to the page (it is
 * the `filters` getter the page handed `useCollection`), so the page renders
 * its own `NeFilterBar` against that ref and the collection refetches from
 * page one when it changes. A filter prop here would be a second owner.
 *
 * Empty, loading and error follow `NeCardList`'s rule: a panel only when
 * there is no row to show. A refetch or a later error keeps the last good
 * page on screen, and the table's own loading bar says a fetch is in flight.
 * The pager is a sibling of the panel for the same reason it is on the card
 * list: `NeStatePanel` drops its default slot while it shows a reading.
 */
import { computed, useSlots } from 'vue'

import NeDataTable from './NeDataTable.vue'
import NePageHeader from './NePageHeader.vue'
import NePager from './NePager.vue'
import NeSearchInput from './NeSearchInput.vue'
import NeStatePanel from './NeStatePanel.vue'

import type { NeCollectionState } from '../composables/use-collection'
import type { NeStateValue } from '../types'
import type { NeAdminListPageProps } from './ne-admin-page-types'
import type {
  NeDataTableBreakSlotProps,
  NeDataTableCellSlotProps,
  NeDataTableGroupSlotProps,
  NeDataTableSlots,
} from './ne-data-table-types'

const props = withDefaults(defineProps<NeAdminListPageProps<T>>(), {
  breadcrumbs: undefined,
  caption: undefined,
  description: undefined,
  emptyMessage: '',
  emptyTitle: '',
  errorMessage: '',
  errorTitle: '',
  eyebrow: undefined,
  loadingMessage: '',
  loadingTitle: '',
  noun: 'results',
  pageSizes: undefined,
  rowKey: undefined,
  searchLabel: undefined,
  searchPlaceholder: undefined,
  to: undefined,
})

defineSlots<
  {
    /** Right-aligned actions next to the title — "New runner". */
    actions?(): unknown
    /** Replaces the empty panel entirely — a first-run call to action. */
    empty?(): unknown
    /** The page's own filter controls, in the toolbar beside the search. */
    filters?(): unknown
  } & NeDataTableSlots<T>
>()

const slots = useSlots()

/** The page's own slots; everything else is a table slot and is forwarded. */
const PAGE_SLOTS = new Set(['actions', 'empty', 'filters'])

/**
 * A forwarded slot's scope. The name is only known at runtime, so the
 * template cannot narrow which of the table's three scopes it holds; each
 * one is handed through untouched to the slot of the same name.
 */
type TableSlotScope = NeDataTableCellSlotProps<T> &
  NeDataTableGroupSlotProps<T> &
  NeDataTableBreakSlotProps<T>

const tableSlotNames = computed(
  () =>
    Object.keys(slots).filter((name) => !PAGE_SLOTS.has(name)) as Array<
      keyof NeDataTableSlots<T> & string
    >,
)

/**
 * The pager's `v-model:state`. Writing it assigns `collection.state`, whose
 * setter applies the page and nothing else (see `useCollection`).
 */
const reading = computed<NeCollectionState<T>>({
  get: () => props.collection.state,
  set: (next) => {
    props.collection.state = next
  },
})

const rows = computed(() => reading.value.items)

const panelState = computed<NeStateValue | undefined>(() => {
  if (reading.value.items.length > 0) return
  if (reading.value.pending) return 'loading'
  if (reading.value.error) return 'error'
  return 'empty'
})

const panelTitle = computed(() => {
  if (panelState.value === 'loading') return props.loadingTitle
  if (panelState.value === 'error') return props.errorTitle
  return props.emptyTitle
})

const panelMessage = computed(() => {
  if (panelState.value === 'loading') return props.loadingMessage
  if (panelState.value === 'error') return props.errorMessage
  return props.emptyMessage
})

const search = computed<string>({
  get: () => props.collection.q,
  set: (next) => {
    props.collection.q = next
  },
})

const hasToolbar = computed(() => Boolean(props.searchLabel) || Boolean(slots.filters))
</script>

<template>
  <div data-ne-admin-list-page class="ne-admin-list-page min-w-0 space-y-6">
    <NePageHeader
      :title="title"
      :description="description"
      :eyebrow="eyebrow"
      :breadcrumbs="breadcrumbs"
    >
      <template v-if="$slots.actions" #actions>
        <slot name="actions" />
      </template>
    </NePageHeader>

    <div
      v-if="hasToolbar"
      data-ne-admin-list-toolbar
      class="ne-admin-list-page__toolbar flex flex-wrap items-start gap-3"
    >
      <NeSearchInput
        v-if="searchLabel"
        v-model="search"
        class="min-w-0 flex-1 basis-64"
        :debounce="0"
        :label="searchLabel"
        :pending="collection.pending"
        :placeholder="searchPlaceholder"
      />
      <slot name="filters" />
    </div>

    <slot v-if="panelState === 'empty' && $slots.empty" name="empty" />
    <NeStatePanel v-else :state="panelState" :title="panelTitle" :message="panelMessage">
      <NeDataTable
        :caption="caption"
        :columns="columns"
        :loading="collection.pending"
        :row-key="rowKey"
        :rows="rows"
        :sort="collection.sort"
        @update:sort="collection.setSort"
      >
        <template v-for="name in tableSlotNames" :key="name" #[name]="scope">
          <slot :name="name" v-bind="scope as TableSlotScope" />
        </template>
      </NeDataTable>
    </NeStatePanel>

    <NePager
      v-model:state="reading"
      class="ne-admin-list-page__pager"
      :noun="noun"
      :page-sizes="pageSizes"
      :to="to"
      @update:limit="collection.setLimit"
    />
  </div>
</template>
