<script setup lang="ts">
interface Runner {
  id: number
  name: string
}

const RUNNERS: Runner[] = Array.from({ length: 120 }, (_, index) => ({
  id: index + 1,
  name: `runner-${String(index + 1).padStart(3, '0')}`,
}))

// `fetch` would call your list endpoint; this one answers from memory with the
// same OffsetListResponse shape.
const collection = useCollection<Runner>({
  fetch: ({ limit, offset }) => ({
    items: RUNNERS.slice(offset, offset + limit),
    total: RUNNERS.length,
    limit,
    offset,
    q: null,
    sort: null,
  }),
  limit: 25,
})
</script>

<template>
  <div class="space-y-3">
    <ul class="columns-2 font-mono text-sm sm:columns-4" data-testid="pager-items">
      <li v-for="runner in collection.items" :key="runner.id">{{ runner.name }}</li>
    </ul>
    <!-- The pager writes only the page; a page-size change arrives as
         update:limit and must go to setLimit, or the select does nothing. -->
    <NePager
      v-model:state="collection.state"
      noun="runners"
      :page-sizes="[25, 50, 100]"
      @update:limit="collection.setLimit"
    />
  </div>
</template>
