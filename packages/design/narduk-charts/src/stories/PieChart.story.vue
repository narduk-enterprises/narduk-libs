<script setup lang="ts">
import { NardukPieChart } from 'narduk-charts'

const data = [
  { label: 'A', value: 40 },
  { label: 'B', value: 32 },
  { label: 'C', value: 28 },
]
</script>

<template>
  <Story title="Pie chart">
    <Variant title="Pie">
      <NardukPieChart
        :data="data"
        :height="320"
      />
    </Variant>

    <Variant title="Donut + colorblind-safe">
      <NardukPieChart
        :data="data"
        donut
        :height="320"
        theme="colorblind-safe"
      />
    </Variant>
  </Story>
</template>
