<script setup lang="ts" generic="T">
/**
 * NeCardList — the card reading of the same collection a table draws
 * (components backlog item 17, narduk-libs#264).
 *
 * Bind `v-model:state` or `:collection`. Both are the `useCollection()`
 * snapshot `NePager` already takes, so one page toggles cards and table
 * without a second fetch. `NeStatePanel` and `NePager` are built in: empty,
 * loading and error are the panel's five-reading contract, and the only
 * thing the pager can write back is the page number.
 *
 * `columns` picks the Tailwind `grid-cols-*` utility per breakpoint the
 * same way `NeKpiBand` does. The lookup is a closed, fully written-out
 * table rather than a computed `` `grid-cols-${n}` `` string, because
 * Tailwind's scanner only ships a utility whose class name it can see
 * literally in source.
 */
import { computed } from 'vue'

import NePager from './NePager.vue'
import NeStatePanel from './NeStatePanel.vue'

import type { NeCollectionState } from '../composables/use-collection'
import type { NeStateValue } from '../types'
import type {
  NeCardListBreakpoint,
  NeCardListColumnCount,
  NeCardListProps,
} from './ne-card-list-types'

const props = withDefaults(defineProps<NeCardListProps<T>>(), {
  card: undefined,
  collection: undefined,
  columns: () => ({ base: 1, md: 2, xl: 3 }),
  density: 'default',
  emptyMessage: '',
  emptyTitle: '',
  errorMessage: '',
  errorTitle: '',
  loadingMessage: '',
  loadingTitle: '',
  maxLimit: undefined,
  mode: 'pages',
  noun: 'results',
  pageSizes: undefined,
  rowKey: undefined,
  to: undefined,
})

/**
 * Assigning to this model applies `page` only when the parent is
 * `useCollection` — the composable's setter ignores every other field.
 * A page that binds `:collection` instead writes through `collection.state`.
 */
const emit = defineEmits<{ 'update:limit': [limit: number] }>()

defineSlots<{
  /** One card. Preferred over `:card` when the card needs more than `item`. */
  card?(props: { index: number; item: T }): unknown
}>()

const state = defineModel<NeCollectionState<T>>('state')

const BREAKPOINTS: readonly NeCardListBreakpoint[] = ['base', 'sm', 'md', 'lg', 'xl']

/** Literal so Tailwind's scanner sees every class it will ever need to emit. */
const GRID_COLUMN_CLASS: Readonly<
  Record<NeCardListBreakpoint, Record<NeCardListColumnCount, string>>
> = {
  base: {
    1: 'grid-cols-1',
    2: 'grid-cols-2',
    3: 'grid-cols-3',
    4: 'grid-cols-4',
    5: 'grid-cols-5',
    6: 'grid-cols-6',
  },
  sm: {
    1: 'sm:grid-cols-1',
    2: 'sm:grid-cols-2',
    3: 'sm:grid-cols-3',
    4: 'sm:grid-cols-4',
    5: 'sm:grid-cols-5',
    6: 'sm:grid-cols-6',
  },
  md: {
    1: 'md:grid-cols-1',
    2: 'md:grid-cols-2',
    3: 'md:grid-cols-3',
    4: 'md:grid-cols-4',
    5: 'md:grid-cols-5',
    6: 'md:grid-cols-6',
  },
  lg: {
    1: 'lg:grid-cols-1',
    2: 'lg:grid-cols-2',
    3: 'lg:grid-cols-3',
    4: 'lg:grid-cols-4',
    5: 'lg:grid-cols-5',
    6: 'lg:grid-cols-6',
  },
  xl: {
    1: 'xl:grid-cols-1',
    2: 'xl:grid-cols-2',
    3: 'xl:grid-cols-3',
    4: 'xl:grid-cols-4',
    5: 'xl:grid-cols-5',
    6: 'xl:grid-cols-6',
  },
}

const EMPTY_STATE: NeCollectionState<T> = {
  error: null,
  filters: {},
  hasNext: false,
  hasPrevious: false,
  items: [],
  limit: 25,
  offset: 0,
  page: 1,
  pageCount: 1,
  pending: false,
  q: '',
  sort: null,
  total: 0,
}

const reading = computed<NeCollectionState<T>>({
  get: () => props.collection?.state ?? state.value ?? EMPTY_STATE,
  set: (next) => {
    if (props.collection) {
      props.collection.state = next
      return
    }
    state.value = next
  },
})

const gridClasses = computed(() =>
  BREAKPOINTS.map((breakpoint) => {
    const count = props.columns[breakpoint]
    return count ? GRID_COLUMN_CLASS[breakpoint][count] : undefined
  }).filter((value): value is string => Boolean(value)),
)

/**
 * Empty / loading / error only when there is nothing to show. A collection
 * keeps the last good page on a later error or a refetch; drawing a panel
 * over those cards would hide the rows the reader already has.
 */
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

function itemKey(item: T, index: number): string {
  return props.rowKey ? props.rowKey(item, index) : String(index)
}

function grow(limit: number): void {
  if (props.collection) {
    props.collection.setLimit(limit)
    return
  }
  emit('update:limit', limit)
}
</script>

<template>
  <div data-ne-card-list data-testid="ne-card-list" class="ne-card-list space-y-4">
    <NeStatePanel :state="panelState" :title="panelTitle" :message="panelMessage">
      <ul class="ne-card-list__grid grid gap-4" :class="gridClasses" role="list">
        <li v-for="(item, index) in reading.items" :key="itemKey(item, index)">
          <slot name="card" :item="item" :index="index">
            <component :is="card" :item="item" />
          </slot>
        </li>
      </ul>
      <NePager
        v-model:state="reading"
        class="ne-card-list__pager mt-4"
        :density="density"
        :max-limit="maxLimit"
        :mode="mode"
        :noun="noun"
        :page-sizes="pageSizes"
        :to="to"
        @update:limit="grow"
      />
    </NeStatePanel>
  </div>
</template>
