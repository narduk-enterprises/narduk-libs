<script setup lang="ts">
import type { NeDataColumn } from '@narduk-enterprises/narduk-shell'

interface Runner {
  id: string
  name: string
  state: 'online' | 'offline'
  jobs: number
}

// Stands in for your admin list endpoint (`listResponse` shape).
const RUNNERS: Runner[] = Array.from({ length: 12 }, (_, index) => ({
  id: `r${index + 1}`,
  name: `runner-${String(index + 1).padStart(2, '0')}`,
  state: index % 3 === 0 ? 'offline' : 'online',
  jobs: 1300 - index * 97,
}))

const stateFilter = ref<string | null>(null)

const collection = useCollection<Runner>({
  fetch: (query) => {
    let items = RUNNERS.filter((row) => !query.state || row.state === query.state)
    if (query.q) items = items.filter((row) => row.name.includes(query.q!))
    if (query.sort === 'name:desc') items = [...items].reverse()
    return {
      items: items.slice(query.offset, query.offset + query.limit),
      total: items.length,
      limit: query.limit,
      offset: query.offset,
      q: query.q ?? null,
      sort: query.sort ?? null,
    }
  },
  filters: () => (stateFilter.value ? { state: stateFilter.value } : {}),
  limit: 5,
  sortable: ['name'],
})

const columns: Array<NeDataColumn<Runner>> = [
  { key: 'name', label: 'Name', sortKey: 'name' },
  { key: 'state', label: 'State' },
  { key: 'jobs', label: 'Jobs', numeric: true },
]
</script>

<template>
  <NeAdminListPage
    title="Runners"
    eyebrow="Admin"
    :collection="collection"
    :columns="columns"
    :row-key="(row: Runner) => row.id"
    noun="runners"
    search-label="Search runners"
    empty-title="No runners"
  >
    <template #actions>
      <UButton label="New runner" />
    </template>
    <template #filters>
      <NeFilterBar
        v-model="stateFilter"
        flush
        label="State"
        :items="[
          { key: 'online', label: 'Online' },
          { key: 'offline', label: 'Offline' },
        ]"
      />
    </template>
    <template #state-cell="{ row }">
      <NeStatusBadge :label="row.state" :tone="row.state === 'online' ? 'ok' : 'neutral'" />
    </template>
  </NeAdminListPage>
</template>
