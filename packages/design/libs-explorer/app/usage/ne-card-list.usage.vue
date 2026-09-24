<script setup lang="ts">
interface River {
  id: string
  name: string
  stage: number | null
}

const RIVERS: River[] = [
  { id: 'des-plaines', name: 'Des Plaines', stage: 5.2 },
  { id: 'fox', name: 'Fox', stage: 3.1 },
  { id: 'kishwaukee', name: 'Kishwaukee', stage: null },
]

const collection = useCollection<River>({
  fetch: ({ limit, offset }) => ({
    items: RIVERS.slice(offset, offset + limit),
    total: RIVERS.length,
    limit,
    offset,
    q: null,
    sort: null,
  }),
  limit: 25,
})
</script>

<template>
  <NeCardList :collection="collection" noun="rivers" :columns="{ base: 1, md: 2, xl: 3 }">
    <template #card="{ item }">
      <NeCard :title="item.name" :stats="[{ label: 'Stage', unit: 'foot', value: item.stage }]" />
    </template>
  </NeCardList>
</template>
