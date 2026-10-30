<script setup lang="ts">
/* NE Base design card for NeSegmented: both variants, a count and a disabled segment. */
import { ref } from 'vue'

import NeSegmented from '../runtime/components/NeSegmented.vue'

const range = ref<string | null>('1w')
const view = ref<string | null>('map')
const ranges = [
  { value: '1d', label: '1D' },
  { value: '1w', label: '1W' },
  { value: '1m', label: '1M' },
  { value: '1y', label: '1Y', disabled: true, disabledReason: 'Not enough history' },
]
const views = [
  { value: 'map', label: 'Map' },
  { value: 'list', label: 'List', count: 42 },
]
</script>

<template>
  <section
    class="preview-card"
    data-design-card="ne-segmented"
    data-name="Segmented control"
    data-group="Shell"
  >
    <h2>Segmented control</h2>
    <p>
      One choice among a few. A radiogroup with one Tab stop and arrow keys; a disabled segment
      stays visible with its reason.
    </p>
    <div class="preview-row" style="display: grid; gap: 0.75rem; max-width: 22rem">
      <NeSegmented v-model="range" :options="ranges" label="Range" mono />
      <NeSegmented v-model="view" :options="views" label="View" variant="chips" layout="scroll" />
    </div>
  </section>
</template>
