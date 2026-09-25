<script setup lang="ts">
import { computed, nextTick, onMounted, ref, useId, watch } from 'vue'

import { useChart } from '../composables/useChart'
import { useTooltip } from '../composables/useTooltip'
import { defaultBarChartLabel } from '../utils/chartA11y'
import { chartThemeClass } from '../utils/chartTheme'
import { getColor } from '../utils/colors'
import { formatValue } from '../utils/math'
import { layoutReferenceLabelXs, layoutReferenceLabelYs } from '../utils/refLabelLayout'
import { createYAxisMap } from '../utils/yScale'

import ChartLegend from './ChartLegend.vue'
import ChartTooltip from './ChartTooltip.vue'

import type {
  BarClickPayload,
  ChartLineAnnotation,
  ChartPadding,
  ChartReferenceLine,
  ChartSeries,
  ChartTheme,
  ChartYBand,
  ChartYScaleMode,
  LegendItem,
  TooltipItem,
} from '../types'

interface BarRect {
  color: string
  height: number
  label: string
  labelIndex: number
  seriesName: string
  value: number
  width: number
  x: number
  y: number
}

const props = withDefaults(
  defineProps<{
    animate?: boolean
    /**
     * Line annotations. `type: 'vline'` is drawn **vertically** at the category
     * center in vertical orientation; in **horizontal** orientation it becomes a
     * **horizontal** guide across the plot at that category row (same `xIndex`).
     */
    annotations?: ChartLineAnnotation[]
    barRadius?: number
    /**
     * When `orientation` is `horizontal`, maximum width (px) for the left
     * category gutter. The layout uses `min(estimatedWidth, this value)` with a
     * 32px floor — i.e. a cap, not a minimum width override.
     */
    categoryLabelMaxWidth?: number
    chartDescription?: string
    chartTitle?: string
    colors?: string[]
    dark?: boolean
    dir?: 'ltr' | 'rtl'
    formatTickValue?: (value: number) => string
    formatXLabel?: (label: string, index: number) => string
    height?: number
    labels: string[]
    legendGroupLabel?: string
    /**
     * `vertical` (default): categories on the X axis, values on the Y axis.
     * `horizontal`: categories on the Y axis, values on the X axis (bars grow +X from the left gutter).
     * **Keyboard (horizontal):** ArrowUp/ArrowDown change category; ArrowLeft/ArrowRight change series within the category.
     */
    orientation?: 'vertical' | 'horizontal'
    /** Override chart padding, e.g. for a thin inline bar with no axes. */
    padding?: Partial<ChartPadding>
    referenceLines?: ChartReferenceLine[]
    respectReducedMotion?: boolean
    series: ChartSeries[]
    showDataTable?: boolean
    /** Draw the value gridlines. Default `true`. */
    showGrid?: boolean
    /** Render the legend. Default `true`. */
    showLegend?: boolean
    /** Draw the bottom axis line and its labels (values when horizontal). Default `true`. */
    showXAxis?: boolean
    /** Draw the left axis line and its labels (categories when horizontal). Default `true`. */
    showYAxis?: boolean
    stacked?: boolean
    /** When `stacked`, rescale each category to 100%. */
    stackedPercent?: boolean
    symlogLinthresh?: number
    theme?: ChartTheme
    width?: number
    yBands?: ChartYBand[]
    /** Pin the value-axis ceiling. Same contract as `yMin`. */
    yMax?: number
    /**
     * Pin the value-axis domain. Either end may be given on its own; the value
     * is used exactly (same contract as `NardukLineChart`'s `yMin` / `yMax`), so
     * a "% of normal" bar can run 0–150 whatever its value.
     */
    yMin?: number
    yScale?: ChartYScaleMode
  }>(),
  {
    stacked: false,
    stackedPercent: false,
    animate: true,
    barRadius: 4,
    respectReducedMotion: true,
    yScale: 'linear',
    symlogLinthresh: 1,
    showDataTable: false,
    legendGroupLabel: 'Data series',
    orientation: 'vertical',
    showXAxis: true,
    showYAxis: true,
    showLegend: true,
    showGrid: true,
  },
)

const emit = defineEmits<{
  barClick: [payload: BarClickPayload]
}>()

defineSlots<{
  empty?: () => unknown
  'legend-item'?: (props: { item: LegendItem; toggle: () => void }) => unknown
  tooltip?: (props: { items: TooltipItem[]; title: string; visible: boolean }) => unknown
}>()

const barA11yRaw = useId()
const idSafe = (s: string) => s.replace(/[^\w-]/g, '')
const barCaptionId = `nc-bcap-${idSafe(barA11yRaw)}`
const svgTitleId = `nc-bt-${idSafe(barA11yRaw)}`
const svgDescId = `nc-bd-${idSafe(barA11yRaw)}`

const containerRef = ref<HTMLElement | null>(null)
const svgRef = ref<SVGSVGElement | null>(null)
const focusedBarIndex = ref(0)

const effectiveChartTitle = computed(
  () => props.chartTitle ?? defaultBarChartLabel(props.series, props.labels.length),
)

function formatXAt(i: number): string {
  const raw = props.labels[i] ?? ''
  return props.formatXLabel ? props.formatXLabel(raw, i) : raw
}

const isHorizontal = computed(() => props.orientation === 'horizontal')

const estimatedCategoryLabelWidth = computed(() => {
  if (!isHorizontal.value) return 56
  let maxLen = 0
  for (let i = 0; i < props.labels.length; i++) maxLen = Math.max(maxLen, formatXAt(i).length)
  const estimated = Math.min(320, Math.max(56, maxLen * 7 + 16))
  if (props.categoryLabelMaxWidth != null) {
    return Math.min(estimated, Math.max(32, props.categoryLabelMaxWidth))
  }
  return estimated
})

function focusBarEl(index: number) {
  nextTick(() => {
    const el = svgRef.value?.querySelector(`[data-nc-bar="${index}"]`)
    if (el instanceof SVGElement) el.focus()
  })
}

function barTooltipItems(b: BarRect): TooltipItem[] {
  return [
    {
      color: b.color,
      label: b.seriesName,
      value: formatValue(b.value),
    },
  ]
}

function focusBarAndTooltip(index: number) {
  focusedBarIndex.value = index
  focusBarEl(index)
  const b = bars.value[index]
  showTooltip(8, 8, formatXAt(b.labelIndex), barTooltipItems(b))
}

function onBarKeydown(e: KeyboardEvent, bi: number) {
  const n = bars.value.length
  if (n === 0) return

  const numVis = visibleSeries.value.length
  const nLab = props.labels.length

  if (isHorizontal.value && numVis > 0) {
    const li = Math.floor(bi / numVis)
    const si = bi % numVis
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (li >= nLab - 1) return
      focusBarAndTooltip((li + 1) * numVis + si)
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (li <= 0) return
      focusBarAndTooltip((li - 1) * numVis + si)
      return
    }
    if (e.key === 'ArrowRight') {
      e.preventDefault()
      if (si >= numVis - 1) return
      focusBarAndTooltip(li * numVis + si + 1)
      return
    }
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      if (si <= 0) return
      focusBarAndTooltip(li * numVis + si - 1)
      return
    }
  }

  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
    e.preventDefault()
    const next = Math.min(n - 1, bi + 1)
    focusBarAndTooltip(next)
    return
  }
  if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
    e.preventDefault()
    const prev = Math.max(0, bi - 1)
    focusBarAndTooltip(prev)
    return
  }
  if (e.key === 'Home') {
    e.preventDefault()
    focusBarAndTooltip(0)
    return
  }
  if (e.key === 'End') {
    e.preventDefault()
    focusBarAndTooltip(n - 1)
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
const barPaddingOverrides = computed(() => {
  const right = (props.referenceLines ?? []).some(r => r.label) ? 34 : 24
  const base = isHorizontal.value ? { right, left: estimatedCategoryLabelWidth.value } : { right }
  return { ...base, ...props.padding }
})
const { chartWidth, chartHeight, padding, plotWidth, plotHeight, isDark, effectiveAnimate } =
  useChart(containerRef, props, barPaddingOverrides)
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

const visibleSeries = computed(() => props.series.filter(s => !hiddenSeries.value.has(s.name)))

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

/** 100% mode implies stacked geometry even if the stacked prop is omitted. */
const stackedLayout = computed(() => props.stacked || props.stackedPercent)

const valueAxisSpan = computed(() => (isHorizontal.value ? plotWidth.value : plotHeight.value))

const yMap = computed(() => {
  const refVals = (props.referenceLines ?? []).map(r => r.value)
  const bandEdges = (props.yBands ?? []).flatMap(b => [b.y0, b.y1])

  let dataVals: number[] = []
  if (stackedLayout.value) {
    if (props.stackedPercent) {
      dataVals = props.labels.map(() => 100)
    } else {
      // Positive and negative segments stack separately (#928), so the
      // domain has to reach both totals, not just their net sum.
      dataVals = props.labels.flatMap((_, li) => {
        let positive = 0
        let negative = 0
        for (const s of visibleSeries.value) {
          const v = barValue(s.data[li])
          if (v < 0) negative += v
          else positive += v
        }
        return [positive, negative]
      })
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

  return createYAxisMap(props.yScale, forMap, [...refVals, ...bandEdges], valueAxisSpan.value, {
    symlogLinthresh: props.symlogLinthresh,
    domainMin: props.yMin,
    domainMax: props.yMax,
  })
})

const yTicksForDisplay = computed(() =>
  yMap.value.ticks.map(t => ({
    ...t,
    label: props.formatTickValue ? props.formatTickValue(t.value) : t.label,
  })),
)

/**
 * The value-axis pixel span (distance from the axis origin, low and high) that
 * a bar covering `from`..`to` occupies. Both ends are clamped into the domain
 * so a pinned `yMin`/`yMax`, or a log axis, never extrapolates.
 */
function valueSpan(from: number, to: number): { hi: number; lo: number } {
  const m = yMap.value
  const clamp = (v: number) => Math.min(m.domain.max, Math.max(m.domain.min, v))
  const a = m.yFromBottom(clamp(from))
  const b = m.yFromBottom(clamp(to))
  return { hi: Math.max(a, b), lo: Math.min(a, b) }
}

/**
 * Bars grow from zero, not from the domain floor (#928): a negative value
 * extends below (or left of) the zero line. Zero is clamped into the domain,
 * so a log axis, or a pinned domain that excludes zero, grows from its floor.
 */
function barSpan(value: number): { hi: number; lo: number } {
  return valueSpan(0, value)
}

/**
 * Stacked segments run from the stack's running total to that total plus the
 * segment, each axis-mapped, so log and symlog stacks stay right (#873).
 * Positive and negative segments keep separate totals and grow away from
 * zero in opposite directions (#928).
 */
function createStackCursor() {
  let positive = 0
  let negative = 0
  return (value: number) => {
    const start = value < 0 ? negative : positive
    const end = start + value
    if (value < 0) negative = end
    else positive = end
    return valueSpan(start, end)
  }
}

function yPos(value: number): number {
  return padding.value.top + plotHeight.value - yMap.value.yFromBottom(value)
}

/** Value → X coordinate (numeric axis) when `orientation` is horizontal. */
function xPosForValue(value: number): number {
  return padding.value.left + yMap.value.yFromBottom(value)
}

function yCenterForCategoryIndex(i: number): number {
  const n = props.labels.length
  if (n <= 0) return padding.value.top
  return padding.value.top + (i + 0.5) * (plotHeight.value / n)
}

function xCenterForIndex(i: number): number {
  const n = props.labels.length
  if (n <= 0) return padding.value.left
  return padding.value.left + (i + 0.5) * (plotWidth.value / n)
}

const vlineAnnotations = computed(() =>
  (props.annotations ?? []).filter(
    (a): a is Extract<ChartLineAnnotation, { type: 'vline' }> => a.type === 'vline',
  ),
)

const referenceLineLayoutsVertical = computed(() => {
  if (isHorizontal.value)
    return [] as Array<{ labelY: number; lineY: number; ref: ChartReferenceLine }>
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

const referenceLineLayoutsHorizontal = computed(() => {
  if (!isHorizontal.value)
    return [] as Array<{ labelX: number; lineX: number; ref: ChartReferenceLine }>
  const refs = props.referenceLines ?? []
  const lineXs = refs.map((ref, i) => ({
    ref,
    i,
    lineX: xPosForValue(ref.value),
  }))
  const labeled = lineXs.filter(x => x.ref.label)
  if (labeled.length === 0) {
    return lineXs.map(x => ({ ref: x.ref, lineX: x.lineX, labelX: x.lineX }))
  }
  const bounds = {
    left: padding.value.left,
    right: chartWidth.value - padding.value.right,
  }
  const map = layoutReferenceLabelXs(
    labeled.map(x => ({ id: x.i, lineX: x.lineX })),
    bounds,
  )
  return lineXs.map(x => ({
    ref: x.ref,
    lineX: x.lineX,
    labelX: x.ref.label ? (map.get(x.i) ?? x.lineX) : x.lineX,
  }))
})

const refLabelAnchorX = computed(() => chartWidth.value - padding.value.right + 4)
/** Horizontal bar chart: reference label above the plot, packed on X. */
const refLabelTopY = 10

// ── Bar geometry ─────────────────────────────────────────────

const groupGap = 0.2
const barGap = 2

const bars = computed<BarRect[]>(() => {
  const n = props.labels.length
  const numVisible = visibleSeries.value.length
  if (n === 0 || numVisible === 0) return []

  if (isHorizontal.value) {
    const groupHeight = plotHeight.value / n
    const innerH = groupHeight * (1 - groupGap)
    const result: BarRect[] = []

    if (stackedLayout.value) {
      const barH = innerH
      for (let li = 0; li < n; li++) {
        const rowTop = padding.value.top + li * groupHeight + (groupHeight - innerH) / 2
        const sum = visibleSeries.value.reduce((acc, s) => acc + barValue(s.data[li]), 0)
        const stack = createStackCursor()
        for (const s of visibleSeries.value) {
          const raw = barValue(s.data[li])
          const val = props.stackedPercent && sum > 0 ? (raw / sum) * 100 : raw
          const { lo, hi } = stack(val)
          result.push({
            x: padding.value.left + lo,
            y: rowTop,
            width: hi - lo,
            height: barH,
            color: resolveColor(s),
            value: val,
            seriesName: s.name,
            label: props.labels[li]!,
            labelIndex: li,
          })
        }
      }
    } else {
      const barH = Math.max(1, (innerH - barGap * (numVisible - 1)) / numVisible)
      for (let li = 0; li < n; li++) {
        const rowTop = padding.value.top + li * groupHeight + (groupHeight - innerH) / 2
        for (const [si, s] of visibleSeries.value.entries()) {
          const val = barValue(s.data[li])
          const { lo, hi } = barSpan(val)
          result.push({
            x: padding.value.left + lo,
            y: rowTop + si * (barH + barGap),
            width: hi - lo,
            height: barH,
            color: resolveColor(s),
            value: val,
            seriesName: s.name,
            label: props.labels[li]!,
            labelIndex: li,
          })
        }
      }
    }
    return result
  }

  const groupWidth = plotWidth.value / n
  const innerWidth = groupWidth * (1 - groupGap)
  const result: BarRect[] = []
  const bottomY = padding.value.top + plotHeight.value

  if (stackedLayout.value) {
    const barW = innerWidth
    for (let li = 0; li < n; li++) {
      const groupX = padding.value.left + li * groupWidth + (groupWidth - innerWidth) / 2
      const sum = visibleSeries.value.reduce((acc, s) => acc + barValue(s.data[li]), 0)
      const stack = createStackCursor()
      for (const s of visibleSeries.value) {
        const raw = barValue(s.data[li])
        const val = props.stackedPercent && sum > 0 ? (raw / sum) * 100 : raw
        const { lo, hi } = stack(val)
        result.push({
          x: groupX,
          y: bottomY - hi,
          width: barW,
          height: hi - lo,
          color: resolveColor(s),
          value: val,
          seriesName: s.name,
          label: props.labels[li]!,
          labelIndex: li,
        })
      }
    }
  } else {
    const barW = Math.max(1, (innerWidth - barGap * (numVisible - 1)) / numVisible)
    for (let li = 0; li < n; li++) {
      const groupX = padding.value.left + li * groupWidth + (groupWidth - innerWidth) / 2
      for (const [si, s] of visibleSeries.value.entries()) {
        const val = barValue(s.data[li])
        const { lo, hi } = barSpan(val)
        result.push({
          x: groupX + si * (barW + barGap),
          y: bottomY - hi,
          width: barW,
          height: hi - lo,
          color: resolveColor(s),
          value: val,
          seriesName: s.name,
          label: props.labels[li]!,
          labelIndex: li,
        })
      }
    }
  }

  return result
})

watch(
  () => bars.value.length,
  n => {
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

  const hit = bars.value.find(
    b => sx >= b.x && sx <= b.x + b.width && sy >= b.y && sy <= b.y + b.height,
  )

  if (hit) {
    hoverBar.value = hit
    showTooltip(mouseX, mouseY, formatXAt(hit.labelIndex), [
      {
        color: hit.color,
        label: hit.seriesName,
        value: formatValue(hit.value),
      },
    ])
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

// eslint-disable-next-line vue/no-ref-object-reactivity-loss -- narduk-libs#131: one-time paint seed; onMounted owns the flag after setup
const animated = ref(!runAnimation.value)

onMounted(() => {
  if (runAnimation.value) {
    requestAnimationFrame(() => {
      animated.value = true
    })
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
  if (isHorizontal.value) {
    const x0p = xPosForValue(b.y0)
    const x1p = xPosForValue(b.y1)
    const left = Math.min(x0p, x1p)
    const h = Math.max(0, chartHeight.value - padding.value.top - padding.value.bottom)
    return {
      x: left,
      y: padding.value.top,
      w: Math.abs(x1p - x0p),
      h,
      opacity: b.opacity ?? 0.12,
      fill: b.color || 'var(--color-chart-accent, #6366f1)',
    }
  }
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

function horizontalRoundedPathAnimStyle(anim: boolean): Record<string, string> {
  return {
    transform: anim ? 'scaleX(1)' : 'scaleX(0)',
    transformOrigin: '0 center',
    transformBox: 'fill-box',
  }
}

/** Rounded outer (+X / right) edge only — vertical bars use SVG rect rounding. */
function horizontalBarRoundedPath(bar: BarRect): string {
  const r = Math.max(0, props.barRadius)
  const { x, y, width: w, height: h } = bar
  if (w <= 0 || h <= 0) return ''
  const rr = Math.min(r, h / 2, w / 2)
  if (rr <= 0) return `M ${x} ${y} H ${x + w} V ${y + h} H ${x} Z`
  return [
    `M ${x} ${y}`,
    `L ${x + w - rr} ${y}`,
    `A ${rr} ${rr} 0 0 1 ${x + w} ${y + rr}`,
    `L ${x + w} ${y + h - rr}`,
    `A ${rr} ${rr} 0 0 1 ${x + w - rr} ${y + h}`,
    `L ${x} ${y + h}`,
    'Z',
  ].join(' ')
}
</script>

<template>
  <figure class="narduk-chart-figure m-0 min-w-0" :dir="dir">
    <figcaption v-if="chartTitle" :id="barCaptionId" class="narduk-chart__title">
      {{ chartTitle }}
    </figcaption>
    <p v-if="chartDescription" class="narduk-chart__description">
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
      <!-- The wrapper, not the table, is visually hidden: `overflow` does not
           apply to a table box, and an auto-layout table grows to its content
           whatever its declared width (narduk-libs#296). -->
      <div v-if="showDataTable && !isEmpty" class="narduk-sr-only">
        <table>
          <caption>
            {{
              effectiveChartTitle
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">Category</th>
              <th v-for="s in series" :key="s.name" scope="col">
                {{ s.name }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(lab, ri) in labels" :key="ri">
              <th scope="row">{{ formatXAt(ri) }}</th>
              <td v-for="s in series" :key="s.name">
                {{ s.data[ri] ?? '' }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="isEmpty" class="narduk-chart__empty">
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
        <desc v-if="chartDescription?.trim()" :id="svgDescId">
          {{ chartDescription }}
        </desc>
        <g v-if="yBands?.length" class="narduk-y-bands">
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

        <g v-if="vlineAnnotations.length && !isHorizontal" class="narduk-ann-vline">
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

        <!-- Horizontal mode: `vline` is a horizontal guide at the category row (`xIndex` → category). -->
        <g v-if="vlineAnnotations.length && isHorizontal" class="narduk-ann-vline">
          <line
            v-for="(vl, vi) in vlineAnnotations"
            :key="'vl-h-' + vi"
            class="narduk-ref-line"
            :class="{ 'narduk-ref-line--dashed': vl.dashed !== false }"
            :stroke="vl.color || 'var(--color-chart-muted)'"
            :x1="padding.left"
            :y1="yCenterForCategoryIndex(vl.xIndex)"
            :x2="chartWidth - padding.right"
            :y2="yCenterForCategoryIndex(vl.xIndex)"
          />
        </g>

        <!-- Grid lines -->
        <g v-if="showGrid && !isHorizontal" class="narduk-grid">
          <line
            v-for="(t, ti) in yMap.ticks"
            :key="'g-' + ti"
            :x1="padding.left"
            :y1="yPos(t.value)"
            :x2="chartWidth - padding.right"
            :y2="yPos(t.value)"
          />
        </g>
        <g v-else-if="showGrid" class="narduk-grid">
          <line
            v-for="(t, ti) in yMap.ticks"
            :key="'gh-' + ti"
            :x1="xPosForValue(t.value)"
            :y1="padding.top"
            :x2="xPosForValue(t.value)"
            :y2="chartHeight - padding.bottom"
          />
        </g>

        <!-- Reference lines -->
        <g v-if="referenceLineLayoutsVertical.length" class="narduk-ref-lines">
          <g v-for="(layout, ri) in referenceLineLayoutsVertical" :key="'rv-' + ri">
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
        <g v-if="referenceLineLayoutsHorizontal.length" class="narduk-ref-lines">
          <g v-for="(layout, ri) in referenceLineLayoutsHorizontal" :key="'rh-' + ri">
            <line
              class="narduk-ref-line"
              :class="{ 'narduk-ref-line--dashed': layout.ref.dashed !== false }"
              :stroke="layout.ref.color || 'var(--color-chart-muted)'"
              :x1="layout.lineX"
              :y1="padding.top"
              :x2="layout.lineX"
              :y2="chartHeight - padding.bottom"
            />
            <text
              v-if="layout.ref.label"
              class="narduk-ref-label"
              :x="layout.labelX"
              :y="refLabelTopY"
              text-anchor="middle"
              dominant-baseline="auto"
            >
              {{ layout.ref.label }}
            </text>
          </g>
        </g>

        <template v-if="!isHorizontal">
          <!-- Y axis (numeric) -->
          <g v-if="showYAxis" class="narduk-axis">
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

          <!-- X axis (categories) -->
          <g v-if="showXAxis" class="narduk-axis">
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
        </template>
        <template v-else>
          <!-- Y axis spine + category labels -->
          <g v-if="showYAxis" class="narduk-axis">
            <line
              :x1="padding.left"
              :y1="padding.top"
              :x2="padding.left"
              :y2="chartHeight - padding.bottom"
            />
            <text
              v-for="(_, i) in labels"
              :key="'cat-' + i"
              :x="padding.left - 8"
              :y="yCenterForCategoryIndex(i)"
              text-anchor="end"
              dominant-baseline="middle"
            >
              {{ formatXAt(i) }}
            </text>
          </g>
          <!-- X axis (numeric) -->
          <g v-if="showXAxis" class="narduk-axis">
            <line
              :x1="padding.left"
              :y1="chartHeight - padding.bottom"
              :x2="chartWidth - padding.right"
              :y2="chartHeight - padding.bottom"
            />
            <text
              v-for="(t, ti) in yTicksForDisplay"
              :key="'xt-' + ti"
              :x="xPosForValue(t.value)"
              :y="chartHeight - padding.bottom + 20"
              text-anchor="middle"
              dominant-baseline="hanging"
            >
              {{ t.label }}
            </text>
          </g>
        </template>

        <!-- Bars -->
        <template v-for="(bar, bi) in bars" :key="'b-' + bi">
          <rect
            v-if="!isHorizontal"
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
          <g v-else-if="barRadius > 0" :transform="`translate(${bar.x}, ${bar.y})`">
            <path
              class="narduk-bar-rect narduk-bar-rect--hscale"
              role="button"
              :tabindex="focusedBarIndex === bi ? 0 : -1"
              :data-nc-bar="bi"
              :aria-label="`${bar.seriesName}, ${formatXAt(bar.labelIndex)}, ${formatValue(bar.value)}`"
              :class="{ 'narduk-bar-rect--hover': hoverBar === bar }"
              :d="
                horizontalBarRoundedPath({
                  ...bar,
                  x: 0,
                  y: 0,
                  width: bar.width,
                })
              "
              :style="horizontalRoundedPathAnimStyle(animated)"
              :fill="bar.color"
              @focus="focusedBarIndex = bi"
              @keydown="onBarKeydown($event, bi)"
              @click="onBarPointerDown(bar, $event)"
            />
          </g>
          <rect
            v-else
            class="narduk-bar-rect"
            role="button"
            :tabindex="focusedBarIndex === bi ? 0 : -1"
            :data-nc-bar="bi"
            :aria-label="`${bar.seriesName}, ${formatXAt(bar.labelIndex)}, ${formatValue(bar.value)}`"
            :class="{ 'narduk-bar-rect--hover': hoverBar === bar }"
            :x="bar.x"
            :y="bar.y"
            :width="animated ? bar.width : 0"
            :height="bar.height"
            :fill="bar.color"
            @focus="focusedBarIndex = bi"
            @keydown="onBarKeydown($event, bi)"
            @click="onBarPointerDown(bar, $event)"
          />
        </template>
      </svg>

      <template v-if="!isEmpty">
        <ChartLegend
          v-if="showLegend"
          :items="legendItems"
          :group-label="legendGroupLabel"
          @toggle="toggleSeries"
        >
          <template v-if="$slots['legend-item']" #item="slotProps">
            <slot name="legend-item" v-bind="slotProps" />
          </template>
        </ChartLegend>
        <ChartTooltip v-bind="tooltip" :chart-width="chartWidth">
          <template v-if="$slots.tooltip" #content="slotProps">
            <slot name="tooltip" v-bind="slotProps" />
          </template>
        </ChartTooltip>
      </template>
    </div>
  </figure>
</template>
