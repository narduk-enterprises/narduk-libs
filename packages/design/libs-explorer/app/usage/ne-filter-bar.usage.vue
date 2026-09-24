<script setup lang="ts">
const state = ref<string | null>('open')
</script>

<template>
  <div class="space-y-2">
    <NeFilterBar
      v-model="state"
      label="State"
      :items="[
        { key: 'all', label: 'All', count: 24 },
        { key: 'open', label: 'Open', count: 7 },
        { key: 'draft', label: 'Draft' },
        { key: 'owner', label: 'By owner', disabled: true, title: 'Lands with the owner ledger' },
      ]"
      note="By owner lands with the owner ledger"
    />
    <p class="font-mono text-xs">selected: {{ state ?? 'none' }}</p>
  </div>
</template>
