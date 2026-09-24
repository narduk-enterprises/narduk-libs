<script setup lang="ts">
/*
 * The four shapes Acre Oracle (narduk-farm) draws — narduk-charts#37.
 * Colours come from a consumer CSS custom property (`--farm-accent`) set on the
 * wrapper, to show a `var()` colour painting through series, markers and rings.
 */
import { NardukBarChart, NardukLineChart } from '@narduk-enterprises/narduk-charts'

import type { ChartLineAnnotation, ChartSeries } from '@narduk-enterprises/narduk-charts'

const MONTH_STARTS = [1, 32, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335]
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const doyLabels = Array.from({ length: 366 }, (_, i) => String(i + 1))
/** Zero-based indices of the month starts, labelled via `xTickIndices`. */
const monthTicks = MONTH_STARTS.map(d => d - 1)
function formatDoy(label: string): string {
  const m = MONTH_STARTS.indexOf(Number(label))
  return m >= 0 ? MONTHS[m]! : label
}

/** Deterministic greenness curve: rises to a peak near `peakDay`, then falls. */
function ndvi(day: number, peakDay: number, peak: number): number {
  const d = (day - peakDay) / 45
  return Number((0.18 + (peak - 0.18) * Math.exp(-d * d)).toFixed(2))
}
function season(days: number[], peakDay: number, peak: number): Array<number | null> {
  const out: Array<number | null> = Array.from({ length: 366 }, () => null)
  for (const d of days) out[d - 1] = ndvi(d, peakDay, peak)
  return out
}

// 2024: clear passes with a 62-day cloudy gap in winter that must stay open.
const clear2024 = [12, 20, 83, 91, 104, 118, 126, 133, 149, 157, 170, 186, 203, 219, 240, 262]
const cloudy2024 = [37, 52, 66, 141, 195]
const clear2023 = [15, 44, 70, 98, 112, 139, 160, 171, 188, 210, 233, 251]

const greennessSeries: ChartSeries[] = [
  { name: '2024', data: season(clear2024, 150, 0.78), spanGaps: 40, color: 'var(--farm-accent)' },
  {
    name: '2024 cloudy passes',
    data: season(cloudy2024, 150, 0.78),
    mode: 'points',
    marker: { radius: 2.5, filled: false },
    opacity: 0.5,
    color: 'var(--farm-accent)',
  },
  { name: '2023', data: season(clear2023, 165, 0.66), spanGaps: 40, color: 'var(--farm-muted)' },
]
const peakAnnotations: ChartLineAnnotation[] = [
  {
    type: 'point',
    xIndex: 148,
    y: ndvi(149, 150, 0.78),
    ring: true,
    color: 'var(--farm-accent)',
    radius: 4.5,
    label: 'Peak 0.78',
  },
]
/* Fitted on round steps: span 0.6 > 0.5 -> step 0.2 on [0, 0.8] -> 5 ticks. */
const greennessY = { yMin: 0, yMax: 0.8, yTickCount: 5 }

// Small multiples: one chart per crop, each on its own scale.
const cropLabels = ['2019', '2020', '2021', '2022', '2023', '2024']
const crops: Array<{ data: Array<number | null>; name: string }> = [
  { name: 'Winter wheat · bu/ac', data: [62, 58, null, 71, 66, 69] },
  { name: 'Canola · lb/ac', data: [null, 1810, 2140, 1960, null, 2230] },
  { name: 'Peas · bu/ac', data: [38, null, 41, 35, 44, null] },
]

// Year-dot timeline with gaps.
const yieldYears = ['2017', '2018', '2019', '2020', '2021', '2022', '2023', '2024', '2025']
const yieldSeries: ChartSeries[] = [
  {
    name: 'Field 3 yield',
    data: [null, 61.2, 62, null, 58.4, 71.4, 66.1, null, 69.8],
    mode: 'points',
    marker: { radius: 4 },
    color: 'var(--farm-accent)',
    showValues: true,
    formatValue: v => v.toFixed(1),
  },
]
</script>

<template>
  <Story title="Farm shapes (narduk-charts#37)">
    <Variant title="Greenness season line (light)">
      <div class="farm-vars">
        <NardukLineChart
          :series="greennessSeries"
          :labels="doyLabels"
          :annotations="peakAnnotations"
          v-bind="greennessY"
          :height="260"
          :smooth="false"
          :format-x-label="formatDoy"
          :x-tick-indices="monthTicks"
          :dark="false"
          chart-title="Greenness by day of year"
          chart-description="Clear satellite passes joined across gaps of up to 40 days; cloudy passes shown as faint rings."
          show-data-table
        />
      </div>
    </Variant>

    <Variant title="Greenness season line (dark)">
      <div class="farm-vars farm-vars--dark">
        <NardukLineChart
          :series="greennessSeries"
          :labels="doyLabels"
          :annotations="peakAnnotations"
          v-bind="greennessY"
          :height="260"
          :smooth="false"
          :format-x-label="formatDoy"
          :x-tick-indices="monthTicks"
          dark
          chart-title="Greenness by day of year"
        />
      </div>
    </Variant>

    <Variant title="Small multiples per crop (own scales)">
      <div class="farm-vars farm-multiples">
        <NardukLineChart
          v-for="c in crops"
          :key="c.name"
          :series="[{ name: c.name, data: c.data, color: 'var(--farm-accent)' }]"
          :labels="cropLabels"
          :height="120"
          :chrome="false"
          :show-legend="false"
          :linear-from-zero="false"
          :smooth="false"
          :y-tick-count="3"
          :chart-title="c.name"
          show-points
        />
      </div>
    </Variant>

    <Variant title="Thin bar with a reference tick (% of normal)">
      <div class="farm-vars farm-bars">
        <div
          v-for="row in [
            { label: 'Rainfall', pct: 87 },
            { label: 'Growing degree days', pct: 112 },
          ]"
          :key="row.label"
          class="farm-bar-row"
        >
          <NardukBarChart
            :series="[{ name: row.label, data: [row.pct], color: 'var(--farm-accent)' }]"
            :labels="[row.label]"
            orientation="horizontal"
            :height="12"
            :bar-radius="0"
            :y-min="0"
            :y-max="150"
            :y-bands="[{ y0: 0, y1: 150, color: 'var(--farm-muted)', opacity: 0.18 }]"
            :reference-lines="[{ value: 100, dashed: false, color: 'var(--color-chart-text)' }]"
            :show-x-axis="false"
            :show-y-axis="false"
            :show-grid="false"
            :show-legend="false"
            :padding="{ top: 0, right: 0, bottom: 0, left: 0 }"
            :chart-title="`${row.label} · ${row.pct}% of normal`"
          />
        </div>
      </div>
    </Variant>

    <Variant title="Year-dot timeline with gaps">
      <div class="farm-vars">
        <NardukLineChart
          :series="yieldSeries"
          :labels="yieldYears"
          :height="150"
          :y-min="50"
          :y-max="80"
          :y-tick-count="4"
          :show-legend="false"
          chart-title="Field 3 yield by year (bu/ac)"
          show-data-table
        />
      </div>
    </Variant>
  </Story>
</template>

<style scoped>
.farm-vars {
  --farm-accent: oklch(52% 0.13 145);
  --farm-muted: oklch(62% 0.03 90);
  padding: 16px;
}

.farm-vars--dark {
  --farm-accent: oklch(74% 0.14 145);
  --farm-muted: oklch(70% 0.03 90);
  background: oklch(18% 0.01 258);
}

/* Grid children need min-width: 0, or the chart's own SVG width becomes the
   track's minimum and the ResizeObserver never sees a narrower container. */
.farm-multiples {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(220px, 100%), 1fr));
  gap: 12px;
}

.farm-bars {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 16px;
  max-width: 420px;
}

.farm-bar-row {
  min-width: 0;
}
</style>
