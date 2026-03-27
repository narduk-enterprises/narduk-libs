<script setup lang="ts">
import { NardukPieChart } from '@narduk-enterprises/narduk-charts'
import type { PieDataItem } from '@narduk-enterprises/narduk-charts'
import ExamplePage from '../../components/ExamplePage.vue'

const data: PieDataItem[] = [
  { label: 'Direct', value: 35 },
  { label: 'Organic', value: 28 },
  { label: 'Referral', value: 22 },
  { label: 'Social', value: 15 },
]
</script>

<template>
  <ExamplePage
    title="Pie & donut"
    kicker="Part-to-whole"
  >
    <template #intro>
      <p>
        Marketing mix or budget slices with optional donut mode and per-slice colors. Fully keyboard navigable.
      </p>
    </template>
    <div class="flex justify-center">
      <NardukPieChart
        chart-title="Acquisition channels"
        :data="data"
        :height="400"
        :width="420"
        :donut="true"
        :inner-radius="0.55"
        class="max-w-full"
      />
    </div>
  </ExamplePage>
</template>
