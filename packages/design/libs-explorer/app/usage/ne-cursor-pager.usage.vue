<script setup lang="ts">
const collection = useCursorCollection<{ id: number }>({
  fetch: async ({ limit, cursor }) => {
    const offset = cursor ? Number(cursor) : 0
    const items = Array.from({ length: Math.min(limit, 80 - offset) }, (_, index) => ({ id: offset + index + 1 }))
    return { items, limit, cursor: cursor ?? null, nextCursor: offset + limit < 80 ? String(offset + limit) : null, total: null, q: null, sort: null }
  },
  limit: 25,
})
</script>
<template>
  <div class="space-y-3">
    <ul class="font-mono text-sm"><li v-for="row in collection.items" :key="row.id">Revision {{ row.id }}</li></ul>
    <NeCursorPager :state="collection.state" noun="revisions" @next="collection.next()" @previous="collection.previous()" @newest="collection.newest()" />
  </div>
</template>
