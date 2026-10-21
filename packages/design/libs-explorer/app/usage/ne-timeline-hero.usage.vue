<script setup lang="ts">
import { computed, ref } from 'vue'

// Illustrative values, not a live spending feed. The app owns every headline update.
const periods = [
  { id: '2023', label: 'FY23', value: 120, valueLabel: '$120B' },
  { id: '2024', label: 'FY24', value: 150, valueLabel: '$150B' },
  { id: '2025', label: 'FY25', value: 170, valueLabel: '$170B' },
  { id: '2026', label: 'FY26', value: 90, valueLabel: '$90B', partial: true },
  { id: '2027', label: 'FY27', value: null },
]
const selected = ref('2026')
const current = computed(() => periods.find((period) => period.id === selected.value))
</script>
<template>
  <NeTimelineHero
    v-model="selected"
    eyebrow="Illustrative spending · sample data"
    subject="Texas"
    verb="paid"
    :value="current?.valueLabel ?? null"
    :suffix="`in ${current?.label ?? 'the selected period'}.`"
    :description="
      current?.partial
        ? 'Year open. This partial total is not a full-year comparison.'
        : 'Reported payments for the selected period.'
    "
    :periods="periods"
    timeline-label="Fiscal year"
  >
    <template #source
      >Illustrative values only · replace with your own sourced observations.</template
    >
  </NeTimelineHero>
</template>
