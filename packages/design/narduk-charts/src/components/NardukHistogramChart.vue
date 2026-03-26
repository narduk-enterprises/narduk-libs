<script setup lang="ts">
import { ref, computed, onMounted, useId } from 'vue'
import { useChart } from '../composables/useChart'
import { createYAxisMap } from '../utils/yScale'
import { computeHistogramBins } from '../utils/math'
import type { ChartTheme, HistogramBin } from '../types'
import { chartThemeClass } from '../utils/chartTheme'
import { defaultHistogramLabel } from '../utils/chartA11y'

const props = withDefaults(defineProps<{
  values: number[]
  /** Ignored when `bins` is set. */
  binCount?: number
  bins?: HistogramBin[]
  width?: number
  height?: number
  dark?: boolean
  theme?: ChartTheme
  chartTitle?: string
  chartDescription?: string
  dir?: 'ltr' | 'rtl'
  barColor?: string
  animate?: boolean
  respectReducedMotion?: boolean
}>(), {
  binCount: 8,
  animate: true,
  respectReducedMotion: true,
})

const rawId = useId()
const idSafe = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, '')
const capId = `nc-hcap-${idSafe(rawId)}`
const svgTitleId = `nc-ht-${idSafe(rawId)}`
const svgDescId = `nc-hd-${idSafe(rawId)}`

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

const binsResolved = computed(() => {
  if (props.bins && props.bins.length > 0) return props.bins
  return computeHistogramBins(props.values, props.binCount)
})

const effectiveTitle = computed(() =>
  props.chartTitle ?? defaultHistogramLabel(binsResolved.value.length),
)

const isEmpty = computed(() => binsResolved.value.length === 0 || props.values.length === 0)

const yMap = computed(() => {
  const counts = binsResolved.value.map(b => b.count)
  return createYAxisMap('linear', counts, [0], plotHeight.value)
})

const barRects = computed(() => {
  const bins = binsResolved.value
  const n = bins.length
  if (n === 0) return []
  const gap = 2
  const w = Math.max(1, (plotWidth.value - gap * (n - 1)) / n)
  const bottom = padding.value.top + plotHeight.value
  const m = yMap.value
  return bins.map((b, i) => {
    const h = m.yFromBottom(b.count)
    return {
      x: padding.value.left + i * (w + gap),
      y: bottom - h,
      width: w,
      height: h,
      label: `${b.start.toFixed(2)}–${b.end.toFixed(2)}`,
      count: b.count,
    }
  })
})

const animated = ref(!runAnimation.value)

onMounted(() => {
  if (runAnimation.value) {
    requestAnimationFrame(() => { animated.value = true })
  } else {
    animated.value = true
  }
})
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
            v-for="(t, ti) in yMap.ticks"
            :key="'g-' + ti"
            :x1="padding.left"
            :y1="padding.top + plotHeight - yMap.yFromBottom(t.value)"
            :x2="chartWidth - padding.right"
            :y2="padding.top + plotHeight - yMap.yFromBottom(t.value)"
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
            v-for="(t, ti) in yMap.ticks"
            :key="'y-' + ti"
            :x="padding.left - 8"
            :y="padding.top + plotHeight - yMap.yFromBottom(t.value)"
            text-anchor="end"
            dominant-baseline="middle"
          >
            {{ t.label }}
          </text>
        </g>
        <g class="narduk-axis">
          <line
            :x1="padding.left"
            :y1="chartHeight - padding.bottom"
            :x2="chartWidth - padding.right"
            :y2="chartHeight - padding.bottom"
          />
        </g>
        <rect
          v-for="(r, ri) in barRects"
          :key="ri"
          class="narduk-hist-bar"
          :x="r.x"
          :y="animated ? r.y : padding.top + plotHeight"
          :width="r.width"
          :height="animated ? r.height : 0"
          :fill="barColor || 'var(--color-chart-accent, #6366f1)'"
          role="img"
          :aria-label="`${r.label}, count ${r.count}`"
        />
      </svg>
    </div>
  </figure>
</template>

<style scoped>
.narduk-hist-bar {
  transition: y 0.5s ease, height 0.5s ease;
}
</style>
