/**
 * useClientCollection() — search, filter and sort over rows a page already
 * holds (narduk-libs#1400). The client-mode twin of `useCollection()`, which
 * stays the server-paged path: a set that fits in the page is read here, a set
 * that does not is read by the server through `useCollection().setSort`.
 *
 * `NeCollectionTable` runs on it. It also gives `NeDataTable` a client mode
 * without changing that table's contract ("it never reorders rows"): the
 * composable reorders them, and the table draws what it is handed.
 *
 * ```vue
 * const c = useClientCollection({ rows: () => readings, columns })
 * <NeDataTable :columns="columns" :rows="c.rows.value" :sort="c.sort.value" @update:sort="c.setSort" />
 * ```
 *
 * The rules are `collectRows` in `../utils/collection-engine`, whose header
 * states them.
 */
import { computed, ref, toValue, watch } from 'vue'

import { collectRows, isSortableColumn, NE_COLLECTION_ALL } from '../utils/collection-engine'

import type { ComputedRef, MaybeRefOrGetter, Ref } from 'vue'

import type {
  NeCollectionColumn,
  NeCollectionFilter,
  NeCollectionFilterItem,
} from '../components/ne-collection-table-types'

export interface NeClientCollectionOptions<TRow> {
  rows: MaybeRefOrGetter<readonly TRow[]>
  columns: MaybeRefOrGetter<ReadonlyArray<NeCollectionColumn<TRow>>>
  filters?: MaybeRefOrGetter<ReadonlyArray<NeCollectionFilter<TRow>> | undefined>
  /** Extra text a row is found by that no column shows (an owner, a repo). */
  searchText?: (row: TRow) => string
  /** The search to start with. A getter is followed when it changes. */
  query?: MaybeRefOrGetter<string | undefined>
  /** The chip to start with (`'all'` when unset). A getter is followed when it changes. */
  filter?: MaybeRefOrGetter<string | undefined>
  /** The sort to start with, `key:asc|desc`. A getter is followed when it changes. */
  sort?: MaybeRefOrGetter<string | null | undefined>
  /**
   * `false` ignores the search and the filter (a table whose toolbar is not
   * shown must not narrow its rows by a term nobody can see). The sort still
   * applies.
   */
  narrowing?: MaybeRefOrGetter<boolean>
}

export interface NeClientCollection<TRow> {
  /** The search term. Bind it to `NeSearchInput`. */
  query: Ref<string>
  /** The active chip's key. Bind it to `NeFilterBar`. */
  filter: Ref<string>
  /** The wire sort, or `null` for the caller's order. */
  sort: Ref<string | null>
  /** Every row that survives search and filter, in sort order. */
  rows: ComputedRef<TRow[]>
  /** `NeFilterBar`'s items: "All" first, each counted within the search. Empty with no filters. */
  items: ComputedRef<NeCollectionFilterItem[]>
  /** Rows held, before search and filter. */
  total: ComputedRef<number>
  /** Rows that survive search and filter. */
  matched: ComputedRef<number>
  /** The keys of the columns a header may sort by. */
  sortableKeys: ComputedRef<ReadonlySet<string>>
  /** A search or a filter is narrowing the rows. */
  narrowed: ComputedRef<boolean>
  /** The same reading over another set of rows (one group of a grouped table). */
  apply: (rows: readonly TRow[]) => TRow[]
  setSort: (sort: string | null) => void
  /** Clears the search and the filter. The sort stays. */
  reset: () => void
}

export function useClientCollection<TRow>(
  options: NeClientCollectionOptions<TRow>,
): NeClientCollection<TRow> {
  const query = ref('')
  const filter = ref(NE_COLLECTION_ALL)
  const sort = ref<string | null>(null)

  watch(
    () => toValue(options.query),
    (value) => {
      query.value = value ?? ''
    },
    { immediate: true },
  )
  watch(
    () => toValue(options.filter),
    (value) => {
      filter.value = value ?? NE_COLLECTION_ALL
    },
    { immediate: true },
  )
  watch(
    () => toValue(options.sort),
    (value) => {
      sort.value = value ?? null
    },
    { immediate: true },
  )

  const narrowing = () => toValue(options.narrowing) !== false
  const source = computed(() => toValue(options.rows))

  function read(rows: readonly TRow[]) {
    const on = narrowing()
    return collectRows(rows, {
      columns: toValue(options.columns),
      filter: filter.value,
      filters: on ? (toValue(options.filters) ?? []) : [],
      query: on ? query.value : '',
      searchText: options.searchText,
      sort: sort.value,
    })
  }

  const view = computed(() => read(source.value))
  const rows = computed(() => view.value.rows)
  const sortableKeys = computed<ReadonlySet<string>>(
    () =>
      new Set(
        toValue(options.columns)
          .filter((column) => isSortableColumn(column, source.value))
          .map((column) => column.key),
      ),
  )

  return {
    apply: (subset) => read(subset).rows,
    filter,
    items: computed(() => view.value.items),
    matched: computed(() => rows.value.length),
    narrowed: computed(
      () =>
        narrowing() &&
        (query.value.trim() !== '' ||
          (filter.value !== NE_COLLECTION_ALL &&
            (toValue(options.filters) ?? []).some((item) => item.key === filter.value))),
    ),
    query,
    reset: () => {
      query.value = ''
      filter.value = NE_COLLECTION_ALL
    },
    rows,
    setSort: (next) => {
      sort.value = next
    },
    sort,
    sortableKeys,
    total: computed(() => source.value.length),
  }
}
