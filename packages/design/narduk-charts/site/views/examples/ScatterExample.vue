<script setup lang="ts">
import { NardukScatterChart } from '@narduk-enterprises/narduk-charts'
import type { ScatterSeries } from '@narduk-enterprises/narduk-charts'
import ExamplePage from '../../components/ExamplePage.vue'

const series: ScatterSeries[] = [
  {
    name: 'Campaign A',
    color: '#6366f1',
    points: [
      { x: 12, y: 48 },
      { x: 24, y: 52 },
      { x: 36, y: 61 },
      { x: 48, y: 58 },
      { x: 60, y: 72 },
    ],
  },
  {
    name: 'Campaign B',
    color: '#14b8a6',
    points: [
      { x: 14, y: 38 },
      { x: 28, y: 44 },
      { x: 42, y: 49 },
      { x: 55, y: 55 },
      { x: 68, y: 63 },
    ],
  },
]
</script>

<template>
  <ExamplePage
    title="Scatter chart"
    kicker="Numeric X & Y"
  >
    <template #intro>
      <p>
        Compare two numeric dimensions — spend vs conversions, latency vs load, or any paired measurements.
      </p>
    </template>
    <NardukScatterChart
      chart-title="Spend vs outcome"
      :series="series"
      :height="380"
      :width="640"
      class="w-full max-w-full"
    />
  </ExamplePage>
</template>
