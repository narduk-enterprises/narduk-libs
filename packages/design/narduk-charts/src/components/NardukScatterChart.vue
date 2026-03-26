<script setup lang="ts">
import { ref, computed, onMounted, useId } from 'vue'
import { useChart } from '../composables/useChart'
import { linearScale, niceScale, formatValue } from '../utils/math'
import { getColor } from '../utils/colors'
import type { ScatterSeries, ChartTheme } from '../types'
import { chartThemeClass } from '../utils/chartTheme'
import { defaultScatterLabel } from '../utils/chartA11y'

const props = withDefaults(defineProps<{
  series: ScatterSeries[]
  width?: number
  height?: number
  colors?: string[]
  dark?: boolean
  theme?: ChartTheme
  chartTitle?: string
  chartDescription?: string
  dir?: 'ltr' | 'rtl'
  pointRadius?: number
  animate?: boolean
  respectReducedMotion?: boolean
}>(), {
  pointRadius: 4,
  animate: true,
  respectReducedMotion: true,
})

const emit = defineEmits<{
  pointClick: [payload: { seriesName: string; pointIndex: number; x: number; y: number }]
}>()

const rawId = useId()
const idSafe = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, '')
const capId = `nc-scap-${idSafe(rawId)}`
const svgTitleId = `nc-st-${idSafe(rawId)}`
const svgDescId = `nc-sd-${idSafe(rawId)}`

const containerRef = ref<HTMLElement | null>(null)
const { chartWidth, chartHeight, padding, plotWidth, plotHeight, isDark, effectiveAnimate } = useChart(
  containerRef,
  props,
)
const runAnimation = computed(() => effectiveAnimate(props.animate))

const rootChartClasses = computed(() => {
  const c = ['narduk-chart']
  if (isDark.value) c.push('narduk-chart--dark')
  const t = chartThemeClass(props.theme)
  if (t) c.push(t)
  return c
})

const allPoints = computed(() => props.series.flatMap(s => s.points))

const bounds = computed(() => {
  const pts = allPoints.value
  if (pts.length === 0) return { xmin: 0, xmax: 1, ymin: 0, ymax: 1 }
  const xs = pts.map(p => p.x)
  const ys = pts.map(p => p.y)
  return {
    xmin: Math.min(...xs),
    xmax: Math.max(...xs),
    ymin: Math.min(...ys),
    ymax: Math.max(...ys),
  }
})

const xScale = computed(() => {
  const { xmin, xmax } = bounds.value
  const s = niceScale(xmin, xmax, 6)
  return {
    ...s,
    toPx: (x: number) =>
      padding.value.left + linearScale(x, s.min, s.max, 0, plotWidth.value),
  }
})

const yScale = computed(() => {
  const { ymin, ymax } = bounds.value
  const s = niceScale(ymin, ymax, 6)
  return {
    ...s,
    toPx: (y: number) =>
      padding.value.top + plotHeight.value - linearScale(y, s.min, s.max, 0, plotHeight.value),
  }
})

const effectiveTitle = computed(() => props.chartTitle ?? defaultScatterLabel(props.series))

const isEmpty = computed(() => props.series.length === 0 || allPoints.value.length === 0)

function resolveColor(s: ScatterSeries): string {
  const idx = props.series.indexOf(s)
  return s.color || getColor(props.colors, idx)
}

const animated = ref(!runAnimation.value)

onMounted(() => {
  if (runAnimation.value) {
    requestAnimationFrame(() => { animated.value = true })
  } else {
    animated.value = true
  }
})

function onPointClick(seriesName: string, pi: number, x: number, y: number) {
  emit('pointClick', { seriesName, pointIndex: pi, x, y })
}
</script>

<template>
  <figure
    class="narduk-chart-figure m-0 min-w-0"
    :dir="dir"
  >
    <figcaption
      v-if="chartTitle"
      :id="capId"
      class="narduk-chart__title"
    >
      {{ chartTitle }}
    </figcaption>
    <p
      v-if="chartDescription"
      class="narduk-chart__description"
    >
      {{ chartDescription }}
    </p>
    <div
      ref="containerRef"
      :class="rootChartClasses"
      :style="{ width: props.width ? `${props.width}px` : '100%' }"
      role="group"
      :aria-labelledby="chartTitle ? capId : undefined"
      :aria-label="chartTitle ? undefined : effectiveTitle"
      :aria-describedby="chartDescription?.trim() ? svgDescId : undefined"
    >
      <div
        v-if="isEmpty"
        class="narduk-chart__empty"
      >
        No data
      </div>
      <svg
        v-else-if="chartWidth > 0"
        :width="chartWidth"
        :height="chartHeight"
        role="img"
        :aria-labelledby="chartDescription?.trim() ? `${svgTitleId} ${svgDescId}` : svgTitleId"
      >
        <title :id="svgTitleId">{{ effectiveTitle }}</title>
        <desc
          v-if="chartDescription?.trim()"
          :id="svgDescId"
        >
          {{ chartDescription }}
        </desc>
        <g class="narduk-grid">
          <line
            v-for="(t, ti) in yScale.ticks"
            :key="'gh-' + ti"
            :x1="padding.left"
            :y1="yScale.toPx(t)"
            :x2="chartWidth - padding.right"
            :y2="yScale.toPx(t)"
          />
        </g>
        <g class="narduk-axis">
          <line
            :x1="padding.left"
            :y1="padding.top"
            :x2="padding.left"
            :y2="chartHeight - padding.bottom"
          />
          <text
            v-for="(t, ti) in yScale.ticks"
            :key="'yt-' + ti"
            :x="padding.left - 8"
            :y="yScale.toPx(t)"
            text-anchor="end"
            dominant-baseline="middle"
            class="narduk-axis-label"
          >
            {{ formatValue(t) }}
          </text>
        </g>
        <g class="narduk-axis">
          <line
            :x1="padding.left"
            :y1="chartHeight - padding.bottom"
            :x2="chartWidth - padding.right"
            :y2="chartHeight - padding.bottom"
          />
          <text
            v-for="(t, ti) in xScale.ticks"
            :key="'xt-' + ti"
            :x="xScale.toPx(t)"
            :y="chartHeight - padding.bottom + 20"
            text-anchor="middle"
            dominant-baseline="hanging"
            class="narduk-axis-label"
          >
            {{ formatValue(t) }}
          </text>
        </g>
        <g
          v-for="(s, si) in series"
          :key="s.name"
        >
          <circle
            v-for="(p, pi) in s.points"
            :key="si + '-' + pi"
            class="narduk-scatter-point"
            :cx="xScale.toPx(p.x)"
            :cy="yScale.toPx(p.y)"
            :r="animated ? pointRadius : 0"
            :fill="resolveColor(s)"
            role="button"
            tabindex="0"
            :aria-label="`${s.name} ${formatValue(p.x)}, ${formatValue(p.y)}`"
            @click="onPointClick(s.name, pi, p.x, p.y)"
            @keydown.enter.prevent="onPointClick(s.name, pi, p.x, p.y)"
            @keydown.space.prevent="onPointClick(s.name, pi, p.x, p.y)"
          />
        </g>
      </svg>
    </div>
  </figure>
</template>

<style scoped>
.narduk-scatter-point {
  stroke: var(--color-chart-surface);
  stroke-width: 1;
  cursor: pointer;
}
.narduk-scatter-point:focus {
  outline: 2px solid var(--color-chart-accent);
  outline-offset: 2px;
}
.narduk-scatter-point:focus:not(:focus-visible) {
  outline: none;
}
</style>
