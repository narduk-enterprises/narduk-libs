<script setup lang="ts">
import type { NeCommandGroup } from '@narduk-enterprises/narduk-shell'

const palette = useCommandPalette()

const groups: NeCommandGroup[] = [
  {
    id: 'pages',
    label: 'Pages',
    idleLimit: 3,
    items: [
      { id: 'map', label: 'Map', to: '/map', icon: 'i-lucide-map' },
      { id: 'rivers', label: 'Rivers', to: '/rivers', icon: 'i-lucide-waves' },
    ],
  },
  {
    id: 'rivers',
    label: 'Rivers',
    async search(query, { signal }) {
      const found = await $fetch<Array<{ id: string; name: string }>>('/api/search', {
        query: { q: query },
        signal,
      })
      return found.map((river) => ({ id: river.id, label: river.name, to: `/rivers/${river.id}` }))
    },
  },
]
</script>

<template>
  <div class="space-y-2">
    <button type="button" @click="palette.open()">Search</button>
    <!-- Mount it lazily: `armed` is set by the first open, and by the trigger on hover or focus. -->
    <LazyNeCommandPalette v-if="palette.armed.value" :groups="groups" title="Search" />
  </div>
</template>
