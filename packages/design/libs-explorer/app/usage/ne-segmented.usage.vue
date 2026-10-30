<script setup lang="ts">
const range = ref<string | null>('1w')
const ranges = [
  { value: '1d', label: '1D' },
  { value: '1w', label: '1W' },
  { value: '1m', label: '1M' },
  { value: '1y', label: '1Y', disabled: true, disabledReason: 'Not enough history' },
]
</script>

<template>
  <div class="grid max-w-sm gap-2">
    <NeSegmented v-model="range" :options="ranges" label="Range" mono />
    <p class="text-sm">Range: {{ range }}</p>
  </div>
</template>
