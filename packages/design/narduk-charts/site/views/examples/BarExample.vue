<script setup lang="ts">
import { NardukBarChart } from 'narduk-charts'
import type { ChartSeries } from 'narduk-charts'
import ExamplePage from '../../components/ExamplePage.vue'

const labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const series: ChartSeries[] = [
  { name: 'Desktop', data: [44, 55, 41, 67, 22, 43, 38] },
  { name: 'Mobile', data: [53, 32, 33, 52, 13, 44, 41] },
]
</script>

<template>
  <ExamplePage
    title="Bar chart"
    kicker="Grouped comparisons"
  >
    <template #intro>
      <p>
        Grouped bars for channel or cohort comparisons. Switch to stacked layouts and log Y scales in the playground.
      </p>
    </template>
    <NardukBarChart
      chart-title="Traffic by device"
      :series="series"
      :labels="labels"
      :height="380"
      :width="640"
      :reference-lines="[{ value: 50, label: 'Goal', dashed: true }]"
      class="w-full max-w-full"
    />
  </ExamplePage>
</template>
