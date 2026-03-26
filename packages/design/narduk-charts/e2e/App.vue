<script setup lang="ts">
import { ref } from 'vue'
import {
  NardukLineChart,
  NardukBarChart,
  NardukPieChart,
  NardukCandleChart,
} from '../src/index'
import type { ChartSeries, CandleBar, CandleTimeDomain } from '../src/types'

function makeCandleBars(n: number, stepMs = 60_000): CandleBar[] {
  const t0 = Date.UTC(2024, 0, 1, 14, 0, 0)
  return Array.from({ length: n }, (_, i) => {
    const base = 100 + Math.sin(i / 12) * 3
    const o = base
    const c = base + Math.sin(i / 7) * 0.8
    const h = Math.max(o, c) + 1.2
    const l = Math.min(o, c) - 1.2
    return {
      t: t0 + i * stepMs,
      o,
      h,
      l,
      c,
      v: 500 + (i % 200),
    }
  })
}

const qs = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '')
const candleBarCount = qs.get('candlePerf') === '1' ? 4000 : 96
const candleBars = ref(makeCandleBars(candleBarCount))
const candleDomain = ref<CandleTimeDomain | null>(null)

const lineSeries = ref<ChartSeries[]>([
  { name: 'Alpha', data: [1, 3, 2, 5, 4] },
  { name: 'Beta', data: [2, 2, 3, 4, 3] },
])
const lineLabels = ref(['A', 'B', 'C', 'D', 'E'])
const zoom = ref({ start: 0, end: 4 })

const barSeries: ChartSeries[] = [
  { name: 'S1', data: [2, 4, 3] },
  { name: 'S2', data: [1, 2, 3] },
]
const barLabels = ['Q1', 'Q2', 'Q3']

const pieData = [
  { label: 'X', value: 30 },
  { label: 'Y', value: 70 },
]
</script>

<template>
  <div class="e2e-root" style="padding: 24px; max-width: 720px">
    <h1 style="font: 600 16px system-ui; margin-bottom: 16px">
      E2E harness
    </h1>
    <section data-testid="line-section">
      <div data-testid="line-chart">
        <NardukLineChart
          chart-title="Line E2E"
          :series="lineSeries"
          :labels="lineLabels"
          :width="640"
          :height="320"
          :zoomable="true"
          @zoom="zoom = $event"
        />
      </div>
      <p data-testid="zoom-state">
        {{ zoom.start.toFixed(2) }},{{ zoom.end.toFixed(2) }}
      </p>
    </section>
    <section
      data-testid="bar-section"
      style="margin-top: 32px"
    >
      <div data-testid="bar-chart">
        <NardukBarChart
          chart-title="Bar E2E"
          :series="barSeries"
          :labels="barLabels"
          :width="640"
          :height="280"
        />
      </div>
    </section>
    <section
      data-testid="pie-section"
      style="margin-top: 32px"
    >
      <div data-testid="pie-chart">
        <NardukPieChart
          chart-title="Pie E2E"
          :data="pieData"
          :width="400"
          :height="320"
        />
      </div>
    </section>
    <section
      data-testid="candle-section"
      style="margin-top: 32px"
    >
      <div data-testid="candle-chart">
        <NardukCandleChart
          chart-title="Candle E2E"
          :bars="candleBars"
          :width="640"
          :height="360"
          :zoomable="true"
          :show-brush="true"
          :show-volume="true"
          v-model:domain="candleDomain"
        />
      </div>
      <p data-testid="candle-domain">
        {{ candleDomain ? `${candleDomain.start},${candleDomain.end}` : 'none' }}
      </p>
    </section>
  </div>
</template>
