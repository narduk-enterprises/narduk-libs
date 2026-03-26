<script setup lang="ts">
import { NardukBarChart } from 'narduk-charts'

const series = [
  { name: 'A', data: [20, 35, 28, 40] },
  { name: 'B', data: [15, 22, 30, 18] },
]
const labels = ['Q1', 'Q2', 'Q3', 'Q4']

const logBars = [{ name: 'Hits', data: [3, 18, 420, 65] }]
const logLabels = ['A', 'B', 'C', 'D']
const barBands = [{ y0: 20, y1: 80, color: '#38bdf8', opacity: 0.15 }]
const barVline = [{ type: 'vline' as const, xIndex: 1, dashed: true, label: 'v1' }]
</script>

<template>
  <Story title="Bar chart">
    <Variant title="Grouped">
      <NardukBarChart
        :series="series"
        :labels="labels"
        :height="300"
      />
    </Variant>

    <Variant title="Print theme">
      <NardukBarChart
        :series="series"
        :labels="labels"
        :height="300"
        theme="print"
      />
    </Variant>

    <Variant title="Log Y + band + vline">
      <NardukBarChart
        :series="logBars"
        :labels="logLabels"
        :height="280"
        y-scale="log"
        :y-bands="barBands"
        :annotations="barVline"
      />
    </Variant>
  </Story>
</template>
