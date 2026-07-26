<script setup lang="ts">
import { NardukLineChart } from '@narduk-enterprises/narduk-charts'
import type { ChartTheme } from '@narduk-enterprises/narduk-charts'

/**
 * Ten series on purpose: the palette is ten tokens deep, and a theme that only
 * looks right for the first two or three is a theme that has not been checked.
 */
const labels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug']

const series = Array.from({ length: 10 }, (_, s) => ({
  name: `Series ${s + 1}`,
  data: labels.map((_, i) => 40 + s * 7 + Math.sin(i / 1.7 + s) * 9),
}))

const twoSeries = [
  { name: 'Revenue', data: [42, 48, 45, 57, 61, 59, 68, 73] },
  { name: 'Expenses', data: [31, 34, 36, 35, 40, 44, 43, 47] },
]

const presets: { theme: ChartTheme, dark: boolean, title: string }[] = [
  { theme: 'default', dark: false, title: 'default' },
  { theme: 'default', dark: true, title: 'dark' },
  { theme: 'high-contrast', dark: false, title: 'high-contrast' },
  { theme: 'print', dark: false, title: 'print' },
  { theme: 'colorblind-safe', dark: false, title: 'colorblind-safe' },
  { theme: 'colorblind-safe', dark: true, title: 'colorblind-safe · dark' },
]
</script>

<template>
  <Story title="Series palette">
    <Variant
      v-for="p in presets"
      :key="p.title"
      :title="p.title"
    >
      <div :style="{ padding: '20px', background: p.dark ? 'oklch(16.5% 0.014 258)' : 'oklch(98.4% 0.003 258)' }">
        <NardukLineChart
          :series="series"
          :labels="labels"
          :theme="p.theme"
          :dark="p.dark"
          :height="340"
          :animate="false"
        />
      </div>
    </Variant>

    <Variant title="Two series — not good vs bad">
      <NardukLineChart
        :series="twoSeries"
        :labels="labels"
        :height="320"
        chart-title="Revenue vs expenses"
        chart-description="Series 1 and 2 are indigo and teal. A blue/red default made the most common chart in the docs read as a judgement."
        show-area
      />
    </Variant>

    <Variant title="Custom colors still win">
      <NardukLineChart
        :series="twoSeries"
        :labels="labels"
        :height="320"
        :colors="['#7c3aed', '#f97316']"
      />
    </Variant>
  </Story>
</template>
