<script setup lang="ts">
import type { NeCursorCollectionState } from '../composables/use-cursor-collection'

defineProps<{ noun?: string; state: NeCursorCollectionState<unknown>; }>()
defineEmits<{ newest: []; next: []; previous: []; }>()
</script>

<template>
  <nav aria-label="Cursor pagination" class="flex flex-wrap items-center justify-between gap-3 py-3" :aria-busy="state.pending">
    <span role="status" class="text-sm text-muted">
      {{ state.items.length }} {{ noun ?? 'records' }} shown<span v-if="state.total !== null"> of {{ state.total }}</span><span v-else> · total unknown</span>
      <span v-if="!state.hasNext && !state.pending && !state.error"> · End of results</span>
    </span>
    <span class="flex flex-wrap gap-2">
      <button type="button" class="min-h-11 rounded border px-3 py-2" :disabled="state.pending || !state.hasPrevious" @click="$emit('newest')">Newest</button>
      <button type="button" class="min-h-11 rounded border px-3 py-2" :disabled="state.pending || !state.hasPrevious" @click="$emit('previous')">Newer</button>
      <button type="button" class="min-h-11 rounded border px-3 py-2" :disabled="state.pending || !state.hasNext" @click="$emit('next')">Older</button>
    </span>
  </nav>
</template>
