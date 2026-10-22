<script setup lang="ts">
const tabs = [
  { value: 'overview', label: 'Overview' },
  { value: 'trades', label: 'Trades', badge: 12 },
  { value: 'rules', label: 'Rules' },
  { value: 'archive', label: 'Archive', disabled: true },
]
const selected = ref('overview')
</script>

<template>
  <NeTabs v-model="selected" :items="tabs" label="Game sections">
    <template #default="{ value }">
      <p class="py-3 text-sm">The {{ value }} panel.</p>
    </template>
  </NeTabs>
</template>
