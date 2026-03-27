<script setup lang="ts">
import { NardukBrandBackdrop, NardukLineChart } from '@narduk-enterprises/narduk-charts'

const series = [{ name: 'Demo', data: [4, 7, 5, 12, 9, 14, 11] }]
const labels = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
</script>

<template>
  <Story title="Brand backdrop">
    <Variant title="Behind chart (built SVG)">
      <div class="relative min-h-[420px] overflow-hidden rounded-2xl border border-chart-frame bg-chart-surface p-6 shadow-sm">
        <NardukBrandBackdrop />
        <div class="relative z-10 mx-auto max-w-3xl">
          <p class="mb-2 text-center text-xs font-semibold uppercase tracking-wider text-chart-muted">
            NardukCharts
          </p>
          <NardukLineChart
            :series="series"
            :labels="labels"
            :height="280"
            chart-title="Vector-only backdrop"
            chart-description="Decorative grid and series use the same design tokens as charts—no generated bitmaps."
          />
        </div>
      </div>
    </Variant>
  </Story>
</template>
