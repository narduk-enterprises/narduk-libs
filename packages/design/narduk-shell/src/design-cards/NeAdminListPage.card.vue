<script setup lang="ts">
/*
 * NE Base design card for NeAdminListPage — components backlog item 20
 * (narduk-libs#267): header, search, filters, table and pager on one
 * collection. The card server-renders with no router and no fetch, so the
 * collection here is a static snapshot in `useCollection()`'s own shape
 * rather than a live one; the page reads it exactly the same way. No `:to`
 * on the pager, the same constraint NePager.card.vue has.
 */
import UButton from '@nuxt/ui/components/Button.vue'
import { reactive } from 'vue'

import NeAdminListPage from '../runtime/components/NeAdminListPage.vue'
import NeStatusBadge from '../runtime/components/NeStatusBadge.vue'

import type { NeDataColumn } from '../runtime/components/ne-data-table-types'
import type { NeCollection, NeCollectionState } from '../runtime/composables/use-collection'

interface Runner {
  id: string
  jobs: number
  name: string
  state: string
}

const columns: Array<NeDataColumn<Runner>> = [
  { key: 'name', label: 'Name', sortKey: 'name' },
  { key: 'state', label: 'State' },
  { key: 'jobs', label: 'Jobs', numeric: true, sortKey: 'jobs', firstDirection: 'desc' },
]

function snapshot(over: Partial<NeCollectionState<Runner>> = {}): NeCollection<Runner> {
  const state: NeCollectionState<Runner> = {
    error: null,
    filters: {},
    hasNext: true,
    hasPrevious: false,
    items: [
      { id: 'r1', jobs: 1204, name: 'runner-01', state: 'online' },
      { id: 'r2', jobs: 877, name: 'runner-02', state: 'offline' },
      { id: 'r3', jobs: 64, name: 'runner-03', state: 'online' },
    ],
    limit: 3,
    offset: 0,
    page: 1,
    pageCount: 4,
    pending: false,
    q: '',
    sort: 'name:asc',
    total: 12,
    ...over,
  }
  return reactive({
    canNext: state.hasNext,
    canPrevious: state.hasPrevious,
    error: state.error,
    items: state.items,
    page: state.page,
    pageCount: state.pageCount,
    pending: state.pending,
    q: state.q,
    refresh: async () => {},
    setLimit: () => {},
    setPage: () => {},
    setSort: () => {},
    sort: state.sort,
    state,
    total: state.total,
  }) as NeCollection<Runner>
}

const populated = snapshot()
const empty = snapshot({ hasNext: false, items: [], pageCount: 1, total: 0 })
</script>

<template>
  <section
    class="preview-card"
    data-design-card="ne-admin-list-page"
    data-name="Admin list page"
    data-group="Shell"
  >
    <h2>Admin list page</h2>
    <p>
      <code>NePageHeader</code>, <code>NeSearchInput</code> and filters,
      <code>NeDataTable</code> and <code>NePager</code>, all reading one
      <code>useCollection()</code>.
    </p>

    <div class="preview-row">
      <NeAdminListPage
        title="Runners"
        eyebrow="Admin"
        description="Every self-hosted runner, newest first."
        :collection="populated"
        :columns="columns"
        :row-key="(row: Runner) => row.id"
        noun="runners"
        search-label="Search runners"
        search-placeholder="Search runners"
      >
        <template #actions>
          <UButton label="New runner" />
        </template>
        <template #state-cell="{ row }">
          <NeStatusBadge :label="row.state" :tone="row.state === 'online' ? 'ok' : 'neutral'" />
        </template>
      </NeAdminListPage>
      <p class="mono">populated · sorted by name, page 1 of 4</p>
    </div>

    <div class="preview-row">
      <NeAdminListPage
        title="Runners"
        :collection="empty"
        :columns="columns"
        noun="runners"
        empty-title="No runners"
        empty-message="Register one to start taking jobs."
      />
      <p class="mono">empty · NeStatePanel, not an empty table</p>
    </div>
  </section>
</template>
