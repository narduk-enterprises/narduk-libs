<script setup lang="ts">
import { ref } from 'vue'
import { RouterLink } from 'vue-router'
import { NardukLineChart } from '@narduk-enterprises/narduk-charts'
import type { ChartSeries } from '@narduk-enterprises/narduk-charts'
import ExamplePage from '../../components/ExamplePage.vue'

const labels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const series = ref<ChartSeries[]>([
  { name: 'Revenue', data: [12, 19, 15, 25, 22, 30, 28, 35, 32, 40, 38, 45] },
  { name: 'Costs', data: [8, 10, 9, 12, 11, 14, 13, 16, 15, 18, 17, 20] },
])
</script>

<template>
  <ExamplePage
    title="Line chart"
    kicker="Time series & categories"
  >
    <template #intro>
      <p>
        Category-based X axis, multiple series, optional zoom (try Ctrl/Cmd + scroll on the plot in the
        <RouterLink
          to="/playground"
          class="text-[var(--color-ns-accent)]"
        >
          playground
        </RouterLink>
        ), and themes via the <code class="rounded bg-slate-100 px-1">theme</code> prop.
      </p>
    </template>
    <NardukLineChart
      chart-title="Revenue vs costs"
      chart-description="Twelve month sample for SaaS reporting."
      :series="series"
      :labels="labels"
      :height="380"
      :width="640"
      :show-grid="true"
      class="w-full max-w-full"
    />
  </ExamplePage>
</template>
