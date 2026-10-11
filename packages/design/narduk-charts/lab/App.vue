<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { NardukLineChart } from '../src/index'

import kc from './kc-wastewater.json'

import type { ChartBand, ChartLook, ChartSeries, ChartTheme, ChartYBand } from '../src/types'

// Real public data: CDC NWSS wastewater (WVAL) and NSSP ED visits for the Kansas City
// region, as the KC Wastewater concept site draws them. One page, every look, so a
// change to the library is judged on data with real gaps, spikes and seasons.
type Hist = Array<[string, number]>
const theme = ref<ChartTheme>('default')
const look = ref<ChartLook>('classic')
const dark = ref(false)
// The lab is client-only; the query string is read after mount.
onMounted(() => {
  const qs = new URLSearchParams(location.search)
  theme.value = (qs.get('theme') ?? 'default') as ChartTheme
  look.value = qs.get('look') === 'studio' ? 'studio' : 'classic'
  dark.value = qs.get('dark') === '1'
})
const covid = kc.pathogens['sars-cov-2'] as {
  bands: number[]
  ed: Hist
  forecast: Array<[string, number, number, number]>
  history: Hist
}

const LEVELS = ['Very low', 'Low', 'Moderate', 'High', 'Very high']
const LEVEL_COLORS = ['#dbe9f4', '#9fc5e3', '#f2c45a', '#e07b39', '#bf3b2c']
const yBands = computed<ChartYBand[]>(() => {
  const edges = [0, ...covid.bands, 18]
  return LEVELS.map((label, i) => ({
    y0: edges[i]!,
    y1: edges[i + 1]!,
    label,
    color: LEVEL_COLORS[i],
  }))
})

// This season against the last two, by week since September 1.
const seasonOf = (d: string) => (+d.slice(5, 7) >= 9 ? +d.slice(0, 4) : +d.slice(0, 4) - 1)
const latest = seasonOf(covid.history.at(-1)![0])
const seasonLabels = Array.from({ length: 53 }, (_, i) => String(i))
const seasons = computed<ChartSeries[]>(() =>
  [latest, latest - 1, latest - 2].map(y => {
    const data: Array<number | null> = Array(53).fill(null)
    const start = Date.UTC(y, 8, 1)
    for (const [d, v] of covid.history) {
      if (seasonOf(d) !== y) continue
      const w = Math.floor((Date.parse(d) - start) / (7 * 864e5))
      if (w >= 0 && w < 53) data[w] = v
    }
    // The current season leads; the two before it are context.
    return {
      name: `${y}–${String(y + 1).slice(2)}`,
      data,
      emphasis: y === latest ? 'primary' : 'context',
    } as ChartSeries
  }),
)

// Wastewater against ED visits, each scaled to its own peak in the window.
const edWindow = computed(() => {
  const ed = new Map(covid.ed)
  const rows = covid.history.filter(([d]) => ed.has(d)).slice(-100)
  const ww = rows.map(([, v]) => v)
  const ev = rows.map(([d]) => ed.get(d)!)
  const mw = Math.max(...ww)
  const me = Math.max(...ev)
  return {
    labels: rows.map(([d]) => d),
    series: [
      { name: 'Wastewater (WVAL)', data: ww.map(v => Math.round((v / mw) * 100)) },
      { name: 'ED visits', data: ev.map(v => Math.round((v / me) * 100)) },
    ] as ChartSeries[],
  }
})

// The last 26 weeks plus the 3-week projection.
const trend = computed(() => {
  const h = covid.history.slice(-26)
  const f = covid.forecast
  const labels = [...h.map(([d]) => d), ...f.map(([d]) => d)]
  const pad = (n: number) => Array<null>(n).fill(null)
  return {
    labels,
    series: [
      { name: 'Measured', data: [...h.map(([, v]) => v), ...pad(f.length)] },
      {
        name: 'Projection',
        dashed: true,
        data: [...pad(h.length - 1), h.at(-1)![1], ...f.map(p => p[1])],
      },
    ] as ChartSeries[],
    bands: [
      {
        name: '80% band',
        series: 'Projection',
        low: [...pad(h.length), ...f.map(p => p[2])],
        high: [...pad(h.length), ...f.map(p => p[3])],
      },
    ] as ChartBand[],
  }
})
// Studio draws one tick per month (the first week of each); classic keeps the automatic spacing.
const monthStarts = (labels: string[]) =>
  labels.flatMap((d, i) => (i === 0 || d.slice(0, 7) !== labels[i - 1]!.slice(0, 7) ? [i] : []))
const trendTicks = computed(() =>
  look.value === 'studio' ? monthStarts(trend.value.labels) : undefined,
)
const edTicks = computed(() =>
  look.value === 'studio' ? monthStarts(edWindow.value.labels) : undefined,
)
const fmtMonth = (d: string) =>
  new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', {
    month: 'short',
    year: '2-digit',
    timeZone: 'UTC',
  })
</script>

<template>
  <main class="lab" :class="{ 'lab--dark': dark }">
    <header class="lab__head">
      <h1>narduk-charts lab</h1>
      <span
        >CDC NWSS · Kansas City · as of {{ kc.asOf }} · theme {{ theme
        }}{{ look === 'studio' ? ' · look studio' : '' }}</span
      >
    </header>
    <section class="lab__grid">
      <figure class="lab__card" data-shot="seasons">
        <figcaption>This season vs last two</figcaption>
        <NardukLineChart
          :series="seasons"
          :labels="seasonLabels"
          :y-bands="yBands"
          :look="look"
          y-unit="WVAL"
          end-labels
          :height="320"
          :theme="theme"
          :dark="dark"
          chart-title="COVID-19 WVAL by week since Sept 1"
        />
      </figure>
      <figure class="lab__card" data-shot="trend">
        <figcaption>Last 26 weeks and 3-week projection</figcaption>
        <NardukLineChart
          :series="trend.series"
          :labels="trend.labels"
          :x-tick-indices="trendTicks"
          :bands="trend.bands"
          :y-bands="yBands"
          :look="look"
          y-unit="WVAL"
          :height="300"
          :theme="theme"
          :dark="dark"
          :format-x-label="fmtMonth"
          chart-title="COVID-19 WVAL, region"
        />
      </figure>
      <figure class="lab__card lab__card--wide" data-shot="ed">
        <figcaption>Wastewater vs emergency visits</figcaption>
        <NardukLineChart
          :series="edWindow.series"
          :labels="edWindow.labels"
          :x-tick-indices="edTicks"
          :look="look"
          :height="300"
          :theme="theme"
          :dark="dark"
          :format-x-label="fmtMonth"
          chart-title="Peak = 100"
        />
      </figure>
    </section>
  </main>
</template>

<style>
body {
  margin: 0;
  background: #f4f6f7;
  font-family: system-ui, sans-serif;
}
.lab {
  padding: 24px;
  max-width: 1280px;
  margin: 0 auto;
  color: #12202b;
}
.lab--dark {
  background: #0c1216;
  color: #e6edf2;
}
.lab__head {
  display: flex;
  align-items: baseline;
  gap: 16px;
  margin-bottom: 16px;
}
.lab__head h1 {
  font-size: 18px;
  margin: 0;
}
.lab__head span {
  font-size: 12px;
  opacity: 0.7;
}
.lab__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 520px), 1fr));
  gap: 16px;
}
.lab__card {
  margin: 0;
  background: #fff;
  border: 1px solid #e3e8ec;
  border-radius: 10px;
  padding: 16px;
  min-width: 0;
}
.lab--dark .lab__card {
  background: #141c22;
  border-color: #26313a;
}
.lab__card--wide {
  grid-column: 1 / -1;
}
.lab__card figcaption {
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 8px;
}
</style>
