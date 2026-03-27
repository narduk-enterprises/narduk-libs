<script setup lang="ts">
import { NardukHistogramChart } from '@narduk-enterprises/narduk-charts'
import ExamplePage from '../../components/ExamplePage.vue'

/** Skewed sample: web response times (ms) */
const values = [
  42, 48, 51, 55, 58, 61, 64, 67, 70, 72, 75, 78, 82, 88, 95, 102, 118, 135, 160, 95,
  58, 62, 66, 71, 74, 79, 84, 91, 99, 108, 52, 56, 60, 65, 69, 73, 77, 83, 90, 100,
]
</script>

<template>
  <ExamplePage
    title="Histogram"
    kicker="Distributions"
  >
    <template #intro>
      <p>
        Bin counts automatically from raw values, or pass explicit <code class="rounded bg-slate-100 px-1">bins</code>
        when you control bucket edges.
      </p>
    </template>
    <NardukHistogramChart
      chart-title="Response time distribution"
      :values="values"
      :bin-count="10"
      :height="360"
      :width="640"
      bar-color="#6366f1"
      class="w-full max-w-full"
    />
  </ExamplePage>
</template>
