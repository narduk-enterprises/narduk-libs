<script setup lang="ts">
const q = ref('')
</script>

<template>
  <div class="space-y-2">
    <NeSearchInput
      v-model="q"
      :debounce="250"
      label="Search runners"
      placeholder="Search runners"
      show-summary
    />
    <p class="font-mono text-xs">applied: {{ q || 'none' }}</p>
  </div>
</template>
