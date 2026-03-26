<script setup lang="ts">
import { ref, computed, onMounted, nextTick, watch, useId } from 'vue'
import { useChart } from '../composables/useChart'
import { useTooltip } from '../composables/useTooltip'
import { formatValue } from '../utils/math'
import { createYAxisMap } from '../utils/yScale'
import { layoutReferenceLabelYs } from '../utils/refLabelLayout'
import { getColor } from '../utils/colors'
import ChartTooltip from './ChartTooltip.vue'
import ChartLegend from './ChartLegend.vue'
import type {
  ChartSeries,
  ChartReferenceLine,
  ChartTheme,
  ChartYScaleMode,
  ChartYBand,
  ChartLineAnnotation,
  LegendItem,
  TooltipItem,
  BarClickPayload,
} from '../types'
import { chartThemeClass } from '../utils/chartTheme'
import { defaultBarChartLabel } from '../utils/chartA11y'

interface BarRect {
  x: number
  y: number
  width: number
  height: number
  color: string
  value: number
  seriesName: string
  label: string
  labelIndex: number
}

const props = withDefaults(defineProps<{
  series: ChartSeries[]
  labels: string[]
  width?: number
  height?: number
  stacked?: boolean
  /** When `stacked`, rescale each category to 100%. */
  stackedPercent?: boolean
  colors?: string[]
  animate?: boolean
  barRadius?: number
  dark?: boolean
  respectReducedMotion?: boolean
  referenceLines?: ChartReferenceLine[]
  theme?: ChartTheme
  yScale?: ChartYScaleMode
  symlogLinthresh?: number
  yBands?: ChartYBand[]
  /** Renders `vline` annotations at category centers. */
  annotations?: ChartLineAnnotation[]
  chartTitle?: string
  chartDescription?: string
  showDataTable?: boolean
  legendGroupLabel?: string
  dir?: 'ltr' | 'rtl'
  formatXLabel?: (label: string, index: number) => string
  formatTickValue?: (value: number) => string
}>(), {
  stacked: false,
  stackedPercent: false,
  animate: true,
  barRadius: 4,
  respectReducedMotion: true,
  yScale: 'linear',
  symlogLinthresh: 1,
  showDataTable: false,
  legendGroupLabel: 'Data series',
})

const emit = defineEmits<{
  barClick: [payload: BarClickPayload]
}>()

defineSlots<{
  empty?: () => unknown
  tooltip?: (props: { title: string; items: TooltipItem[]; visible: boolean }) => unknown
  'legend-item'?: (props: { item: LegendItem; toggle: () => void }) => unknown
}>()

const barA11yRaw = useId()
const idSafe = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, '')
const barCaptionId = `nc-bcap-${idSafe(barA11yRaw)}`
const svgTitleId = `nc-bt-${idSafe(barA11yRaw)}`
const svgDescId = `nc-bd-${idSafe(barA11yRaw)}`

const containerRef = ref<HTMLElement | null>(null)
const svgRef = ref<SVGSVGElement | null>(null)
const focusedBarIndex = ref(0)

const effectiveChartTitle = computed(() =>
  props.chartTitle ?? defaultBarChartLabel(props.series, props.labels.length),
)

function formatXAt(i: number): string {
  const raw = props.labels[i] ?? ''
  return props.formatXLabel ? props.formatXLabel(raw, i) : raw
}

function focusBarEl(index: number) {
  nextTick(() => {
    const el = svgRef.value?.querySelector(`[data-nc-bar="${index}"]`)
    if (el instanceof SVGElement) el.focus()
  })
}

function onBarKeydown(e: KeyboardEvent, bi: number) {
  const n = bars.value.length
  if (n === 0) return
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
    e.preventDefault()
    const next = Math.min(n - 1, bi + 1)
    focusedBarIndex.value = next
    focusBarEl(next)
    const b = bars.value[next]
    showTooltip(8, 8, b.label, [{
      color: b.color,
      label: b.seriesName,
      value: formatValue(b.value),
    }])
    return
  }
  if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
    e.preventDefault()
    const prev = Math.max(0, bi - 1)
    focusedBarIndex.value = prev
    focusBarEl(prev)
    const b = bars.value[prev]
    showTooltip(8, 8, b.label, [{
      color: b.color,
      label: b.seriesName,
      value: formatValue(b.value),
    }])
    return
  }
  if (e.key === 'Home') {
    e.preventDefault()
    focusedBarIndex.value = 0
    focusBarEl(0)
    const b = bars.value[0]
    showTooltip(8, 8, b.label, [{
      color: b.color,
      label: b.seriesName,
      value: formatValue(b.value),
    }])
    return
  }
  if (e.key === 'End') {
    e.preventDefault()
    const last = n - 1
    focusedBarIndex.value = last
    focusBarEl(last)
    const b = bars.value[last]
    showTooltip(8, 8, b.label, [{
      color: b.color,
      label: b.seriesName,
      value: formatValue(b.value),
    }])
    return
  }
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    const b = bars.value[bi]
    emit('barClick', {
      index: b.labelIndex,
      label: b.label,
      seriesName: b.seriesName,
      value: b.value,
    })
    return
  }
  if (e.key === 'Escape') {
    e.preventDefault()
    hideTooltip()
  }
}
const barPaddingOverrides = computed(() => ({
  right: (props.referenceLines ?? []).some(r => r.label) ? 34 : 24,
}))
const { chartWidth, chartHeight, padding, plotWidth, plotHeight, isDark, effectiveAnimate } = useChart(
  containerRef,
  props,
  barPaddingOverrides,
)
const { tooltip, show: showTooltip, hide: hideTooltip } = useTooltip()

const rootChartClasses = computed(() => {
  const c = ['narduk-chart']
  if (isDark.value) c.push('narduk-chart--dark')
  const t = chartThemeClass(props.theme)
  if (t) c.push(t)
  return c
})

const runAnimation = computed(() => effectiveAnimate(props.animate))

// ── Series visibility ────────────────────────────────────────

const hiddenSeries = ref(new Set<string>())

function toggleSeries(name: string) {
  const next = new Set(hiddenSeries.value)
  if (next.has(name)) next.delete(name)
  else next.add(name)
  hiddenSeries.value = next
}

const visibleSeries = computed(() =>
  props.series.filter(s => !hiddenSeries.value.has(s.name)),
)

const isEmpty = computed(() => {
  if (props.series.length === 0 || props.labels.length === 0) return true
  return visibleSeries.value.length === 0
})

function resolveColor(s: ChartSeries): string {
  return s.color || getColor(props.colors, props.series.indexOf(s))
}

function barValue(v: number | null | undefined): number {
  if (v == null || Number.isNaN(v)) return 0
  return v
}

// ── Scale ────────────────────────────────────────────────────

const yMap = computed(() => {
  const refVals = (props.referenceLines ?? []).map(r => r.value)
  const bandEdges = (props.yBands ?? []).flatMap(b => [b.y0, b.y1])

  let dataVals: number[] = []
  if (props.stacked) {
    if (props.stackedPercent) {
      dataVals = props.labels.map(() => 100)
    } else {
      dataVals = props.labels.map((_, li) =>
        visibleSeries.value.reduce((sum, s) => sum + barValue(s.data[li]), 0),
      )
    }
  } else {
    dataVals = visibleSeries.value.flatMap(s => s.data.map(barValue))
  }

  let forMap: number[]
  if (props.yScale === 'log') {
    const pos = dataVals.filter(v => v > 0)
    forMap = pos.length ? pos : [0.1]
  } else {
    forMap = dataVals.length ? [...dataVals, 0] : [0]
  }

  return createYAxisMap(
    props.yScale,
    forMap,
    [...refVals, ...bandEdges],
    plotHeight.value,
    { symlogLinthresh: props.symlogLinthresh },
  )
})

const yTicksForDisplay = computed(() =>
  yMap.value.ticks.map(t => ({
    ...t,
    label: props.formatTickValue ? props.formatTickValue(t.value) : t.label,
  })),
)

function barPixelHeight(value: number): number {
  const m = yMap.value
  const base = m.yFromBottom(m.domain.min)
  const top = m.yFromBottom(value)
  return Math.max(0, top - base)
}

function yPos(value: number): number {
  return padding.value.top + plotHeight.value - yMap.value.yFromBottom(value)
}

function xCenterForIndex(i: number): number {
  const n = props.labels.length
  if (n <= 0) return padding.value.left
  return padding.value.left + (i + 0.5) * (plotWidth.value / n)
}

const vlineAnnotations = computed(() =>
  (props.annotations ?? []).filter((a): a is Extract<ChartLineAnnotation, { type: 'vline' }> =>
    a.type === 'vline'),
)

const referenceLineLayouts = computed(() => {
  const refs = props.referenceLines ?? []
  const lineYs = refs.map((ref, i) => ({
    ref,
    i,
    lineY: yPos(ref.value),
  }))
  const labeled = lineYs.filter(x => x.ref.label)
  if (labeled.length === 0) {
    return lineYs.map(x => ({ ref: x.ref, lineY: x.lineY, labelY: x.lineY }))
  }
  const bounds = {
    top: padding.value.top,
    bottom: chartHeight.value - padding.value.bottom,
  }
  const map = layoutReferenceLabelYs(
    labeled.map(x => ({ id: x.i, lineY: x.lineY })),
    bounds,
  )
  return lineYs.map(x => ({
    ref: x.ref,
    lineY: x.lineY,
    labelY: x.ref.label ? (map.get(x.i) ?? x.lineY) : x.lineY,
  }))
})

const refLabelAnchorX = computed(() => chartWidth.value - padding.value.right + 4)

// ── Bar geometry ─────────────────────────────────────────────

const groupGap = 0.2
const barGap = 2

const bars = computed<BarRect[]>(() => {
  const n = props.labels.length
  const numVisible = visibleSeries.value.length
  if (n === 0 || numVisible === 0) return []

  const groupWidth = plotWidth.value / n
  const innerWidth = groupWidth * (1 - groupGap)
  const result: BarRect[] = []
  const bottomY = padding.value.top + plotHeight.value

  if (props.stacked) {
    const barW = innerWidth
    for (let li = 0; li < n; li++) {
      const groupX = padding.value.left + li * groupWidth + (groupWidth - innerWidth) / 2
      const sum = visibleSeries.value.reduce((acc, s) => acc + barValue(s.data[li]), 0)
      let cumY = bottomY
      for (const s of visibleSeries.value) {
        const raw = barValue(s.data[li])
        const val = props.stackedPercent && sum > 0 ? (raw / sum) * 100 : raw
        const barH = barPixelHeight(val)
        cumY -= barH
        result.push({
          x: groupX,
          y: cumY,
          width: barW,
          height: barH,
          color: resolveColor(s),
          value: val,
          seriesName: s.name,
          label: props.labels[li],
          labelIndex: li,
        })
      }
    }
  } else {
    const barW = Math.max(1, (innerWidth - barGap * (numVisible - 1)) / numVisible)
    for (let li = 0; li < n; li++) {
      const groupX = padding.value.left + li * groupWidth + (groupWidth - innerWidth) / 2
      visibleSeries.value.forEach((s, si) => {
        const val = barValue(s.data[li])
        const barH = barPixelHeight(val)
        result.push({
          x: groupX + si * (barW + barGap),
          y: bottomY - barH,
          width: barW,
          height: barH,
          color: resolveColor(s),
          value: val,
          seriesName: s.name,
          label: props.labels[li],
          labelIndex: li,
        })
      })
    }
  }

  return result
})

watch(
  () => bars.value.length,
  (n) => {
    if (focusedBarIndex.value >= n) focusedBarIndex.value = Math.max(0, n - 1)
  },
)

// ── Hover ────────────────────────────────────────────────────

const hoverBar = ref<BarRect | null>(null)

function onMouseMove(event: MouseEvent) {
  const svg = containerRef.value?.querySelector('svg')
  if (!svg) return
  const rect = svg.getBoundingClientRect()
  const mouseX = event.clientX - rect.left
  const mouseY = event.clientY - rect.top
  const sx = mouseX * (chartWidth.value / rect.width)
  const sy = mouseY * (chartHeight.value / rect.height)

  const hit = bars.value.find(b =>
    sx >= b.x && sx <= b.x + b.width &&
    sy >= b.y && sy <= b.y + b.height,
  )

  if (hit) {
    hoverBar.value = hit
    showTooltip(mouseX, mouseY, hit.label, [{
      color: hit.color,
      label: hit.seriesName,
      value: formatValue(hit.value),
    }])
  } else {
    hoverBar.value = null
    hideTooltip()
  }
}

function onMouseLeave() {
  hoverBar.value = null
  hideTooltip()
}

function onBarPointerDown(bar: BarRect, e: MouseEvent) {
  e.stopPropagation()
  emit('barClick', {
    index: bar.labelIndex,
    label: bar.label,
    seriesName: bar.seriesName,
    value: bar.value,
  })
}

// ── Animation ────────────────────────────────────────────────

const animated = ref(!runAnimation.value)

onMounted(() => {
  if (runAnimation.value) {
    requestAnimationFrame(() => { animated.value = true })
  } else {
    animated.value = true
  }
})

// ── Legend ────────────────────────────────────────────────────

const legendItems = computed<LegendItem[]>(() =>
  props.series.map((s, i) => ({
    name: s.name,
    color: s.color || getColor(props.colors, i),
    hidden: hiddenSeries.value.has(s.name),
  })),
)

function bandRectBar(b: ChartYBand) {
  const y0p = yPos(b.y0)
  const y1p = yPos(b.y1)
  const top = Math.min(y0p, y1p)
  const h = Math.abs(y1p - y0p)
  return {
    x: padding.value.left,
    y: top,
    w: Math.max(0, chartWidth.value - padding.value.left - padding.value.right),
    h,
    opacity: b.opacity ?? 0.12,
    fill: b.color || 'var(--color-chart-accent, #6366f1)',
  }
}
</script>

<template>
  <figure
    class="narduk-chart-figure m-0 min-w-0"
    :dir="dir"
  >
    <figcaption
      v-if="chartTitle"
      :id="barCaptionId"
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
      :aria-labelledby="chartTitle ? barCaptionId : undefined"
      :aria-label="chartTitle ? undefined : effectiveChartTitle"
      :aria-describedby="chartDescription?.trim() ? svgDescId : undefined"
    >
      <table
        v-if="showDataTable && !isEmpty"
        class="narduk-sr-only"
      >
        <caption>{{ effectiveChartTitle }}</caption>
        <thead>
          <tr>
            <th scope="col">Category</th>
            <th
              v-for="s in series"
              :key="s.name"
              scope="col"
            >
              {{ s.name }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(lab, ri) in labels"
            :key="ri"
          >
            <th scope="row">{{ formatXAt(ri) }}</th>
            <td
              v-for="s in series"
              :key="s.name"
            >
              {{ s.data[ri] ?? '' }}
            </td>
          </tr>
        </tbody>
      </table>

      <div
        v-if="isEmpty"
        class="narduk-chart__empty"
      >
        <slot name="empty">No data</slot>
      </div>
      <svg
        v-else-if="chartWidth > 0"
        ref="svgRef"
        :width="chartWidth"
        :height="chartHeight"
        role="img"
        :aria-labelledby="chartDescription?.trim() ? `${svgTitleId} ${svgDescId}` : svgTitleId"
        @mousemove="onMouseMove"
        @mouseleave="onMouseLeave"
      >
        <title :id="svgTitleId">{{ effectiveChartTitle }}</title>
        <desc
          v-if="chartDescription?.trim()"
          :id="svgDescId"
        >
          {{ chartDescription }}
        </desc>
      <g
        v-if="yBands?.length"
        class="narduk-y-bands"
      >
        <rect
          v-for="(b, bi) in yBands"
          :key="'yb-' + bi"
          class="narduk-y-band"
          :x="bandRectBar(b).x"
          :y="bandRectBar(b).y"
          :width="bandRectBar(b).w"
          :height="bandRectBar(b).h"
          :fill="bandRectBar(b).fill"
          :opacity="bandRectBar(b).opacity"
        />
      </g>

      <g
        v-if="vlineAnnotations.length"
        class="narduk-ann-vline"
      >
        <line
          v-for="(vl, vi) in vlineAnnotations"
          :key="'vl-' + vi"
          class="narduk-ref-line"
          :class="{ 'narduk-ref-line--dashed': vl.dashed !== false }"
          :stroke="vl.color || 'var(--color-chart-muted)'"
          :x1="xCenterForIndex(vl.xIndex)"
          :y1="padding.top"
          :x2="xCenterForIndex(vl.xIndex)"
          :y2="chartHeight - padding.bottom"
        />
      </g>

      <!-- Grid lines -->
      <g class="narduk-grid">
        <line
          v-for="(t, ti) in yMap.ticks"
          :key="'g-' + ti"
          :x1="padding.left"
          :y1="yPos(t.value)"
          :x2="chartWidth - padding.right"
          :y2="yPos(t.value)"
        />
      </g>

      <!-- Reference lines -->
      <g
        v-if="referenceLineLayouts.length"
        class="narduk-ref-lines"
      >
        <g
          v-for="(layout, ri) in referenceLineLayouts"
          :key="ri"
        >
          <line
            class="narduk-ref-line"
            :class="{ 'narduk-ref-line--dashed': layout.ref.dashed !== false }"
            :stroke="layout.ref.color || 'var(--color-chart-muted)'"
            :x1="padding.left"
            :y1="layout.lineY"
            :x2="chartWidth - padding.right"
            :y2="layout.lineY"
          />
          <line
            v-if="layout.ref.label && Math.abs(layout.labelY - layout.lineY) > 2"
            class="narduk-ref-label-connector"
            :x1="refLabelAnchorX"
            :y1="layout.lineY"
            :x2="refLabelAnchorX"
            :y2="layout.labelY"
          />
          <text
            v-if="layout.ref.label"
            class="narduk-ref-label"
            :x="refLabelAnchorX"
            :y="layout.labelY"
            dominant-baseline="middle"
          >
            {{ layout.ref.label }}
          </text>
        </g>
      </g>

      <!-- Y axis -->
      <g class="narduk-axis">
        <line
          :x1="padding.left"
          :y1="padding.top"
          :x2="padding.left"
          :y2="chartHeight - padding.bottom"
        />
        <text
          v-for="(t, ti) in yTicksForDisplay"
          :key="'yt-' + ti"
          :x="padding.left - 8"
          :y="yPos(t.value)"
          text-anchor="end"
          dominant-baseline="middle"
        >
          {{ t.label }}
        </text>
      </g>

      <!-- X axis -->
      <g class="narduk-axis">
        <line
          :x1="padding.left"
          :y1="chartHeight - padding.bottom"
          :x2="chartWidth - padding.right"
          :y2="chartHeight - padding.bottom"
        />
        <text
          v-for="(_, i) in labels"
          :key="i"
          :x="padding.left + (i + 0.5) * (plotWidth / labels.length)"
          :y="chartHeight - padding.bottom + 20"
          text-anchor="middle"
          dominant-baseline="hanging"
        >
          {{ formatXAt(i) }}
        </text>
      </g>

      <!-- Bars -->
      <rect
        v-for="(bar, bi) in bars"
        :key="bi"
        class="narduk-bar-rect"
        role="button"
        :tabindex="focusedBarIndex === bi ? 0 : -1"
        :data-nc-bar="bi"
        :aria-label="`${bar.seriesName}, ${formatXAt(bar.labelIndex)}, ${formatValue(bar.value)}`"
        :class="{ 'narduk-bar-rect--hover': hoverBar === bar }"
        :x="bar.x"
        :y="animated ? bar.y : padding.top + plotHeight"
        :width="bar.width"
        :height="animated ? bar.height : 0"
        :rx="barRadius"
        :fill="bar.color"
        @focus="focusedBarIndex = bi"
        @keydown="onBarKeydown($event, bi)"
        @click="onBarPointerDown(bar, $event)"
      />
    </svg>

    <template v-if="!isEmpty">
      <ChartLegend
        :items="legendItems"
        :group-label="legendGroupLabel"
        @toggle="toggleSeries"
      >
        <template
          v-if="$slots['legend-item']"
          #item="slotProps"
        >
          <slot
            name="legend-item"
            v-bind="slotProps"
          />
        </template>
      </ChartLegend>
      <ChartTooltip
        v-bind="tooltip"
        :chart-width="chartWidth"
      >
        <template
          v-if="$slots.tooltip"
          #content="slotProps"
        >
          <slot
            name="tooltip"
            v-bind="slotProps"
          />
        </template>
      </ChartTooltip>
    </template>
    </div>
  </figure>
</template>
