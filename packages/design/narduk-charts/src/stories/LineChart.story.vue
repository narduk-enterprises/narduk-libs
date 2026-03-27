<script setup lang="ts">
import { NardukLineChart } from '@narduk-enterprises/narduk-charts'

const series = [
  { name: 'Alpha', data: [3, 7, 5, 12, 9, 14] },
  { name: 'Beta', data: [5, 4, 8, 6, 10, 8] },
]
const labels = ['A', 'B', 'C', 'D', 'E', 'F']

const dualSeries = [
  { name: 'Temp °C', data: [18, 19, 21, 22, 24, 23], yAxis: 'primary' as const },
  { name: 'Humidity %', data: [65, 62, 58, 55, 52, 54], yAxis: 'secondary' as const },
]
const dualLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const logSeries = [{ name: 'Count', data: [2, 8, 45, 120, 400, 90, 15] }]
const logLabels = ['a', 'b', 'c', 'd', 'e', 'f', 'g']

const bands = [{ y0: 6, y1: 10, color: '#22c55e', opacity: 0.15 }]
const ann = [
  { type: 'vline' as const, xIndex: 2, label: 'Cutoff', dashed: true },
  { type: 'point' as const, xIndex: 4, y: 10, label: 'Peak' },
]
</script>

<template>
  <Story title="Line chart">
    <Variant title="Default">
      <NardukLineChart
        :series="series"
        :labels="labels"
        :height="320"
      />
    </Variant>

    <Variant title="High contrast theme">
      <NardukLineChart
        :series="series"
        :labels="labels"
        :height="320"
        theme="high-contrast"
      />
    </Variant>

    <Variant title="Empty slot">
      <NardukLineChart
        :series="[]"
        :labels="[]"
        :height="240"
      >
        <template #empty>
          <span>Custom empty message</span>
        </template>
      </NardukLineChart>
    </Variant>

    <Variant title="Dual Y-axis">
      <NardukLineChart
        :series="dualSeries"
        :labels="dualLabels"
        :height="320"
        dual-y-axis
      />
    </Variant>

    <Variant title="Log Y">
      <NardukLineChart
        :series="logSeries"
        :labels="logLabels"
        :height="300"
        y-scale="log"
      />
    </Variant>

    <Variant title="Bands + annotations">
      <NardukLineChart
        :series="series"
        :labels="labels"
        :height="300"
        :y-bands="bands"
        :annotations="ann"
      />
    </Variant>

    <Variant title="Zoom (drag box, ⌃/⌘ wheel, ⇧ pan, dbl-click reset)">
      <NardukLineChart
        :series="series"
        :labels="labels"
        :height="300"
        zoomable
      />
    </Variant>
  </Story>
</template>
