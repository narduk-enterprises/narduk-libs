<script setup lang="ts">
import { ref, computed, onMounted, watch, useId } from 'vue'
import { useChart } from '../composables/useChart'
import { useTooltip } from '../composables/useTooltip'
import {
  segmentLinePoints,
  lineSegmentsToPaths,
  closeAreaUnderLine,
  formatValue,
  decimateCategoryData,
} from '../utils/math'
import { createYAxisMap } from '../utils/yScale'
import { layoutReferenceLabelYs } from '../utils/refLabelLayout'
import { getColor } from '../utils/colors'
import ChartTooltip from './ChartTooltip.vue'
import ChartLegend from './ChartLegend.vue'
import type {
  ChartSeries,
  ChartReferenceLine,
  ChartTheme,
  ChartYAxisId,
  ChartYScaleMode,
  ChartYBand,
  ChartLineAnnotation,
  LegendItem,
  TooltipItem,
  LinePointClickPayload,
  LineZoomRange,
} from '../types'
import { chartThemeClass } from '../utils/chartTheme'
import {
  defaultLineChartLabel,
  linePointSummary,
  zoomKeyboardHint,
} from '../utils/chartA11y'

const props = withDefaults(defineProps<{
  series: ChartSeries[]
  labels: string[]
  width?: number
  height?: number
  smooth?: boolean
  showGrid?: boolean
  showPoints?: boolean
  showArea?: boolean
  colors?: string[]
  animate?: boolean
  dark?: boolean
  respectReducedMotion?: boolean
  referenceLines?: ChartReferenceLine[]
  theme?: ChartTheme
  /** Enable a second Y scale on the right; assign `series[].yAxis = 'secondary'`. */
  dualYAxis?: boolean
  /** Y scale for the primary (left) axis, or the only axis. */
  yScale?: ChartYScaleMode
  /** Y scale for the secondary (right) axis when `dualYAxis` is true. */
  yScaleSecondary?: ChartYScaleMode
  /** Linear threshold for `symlog` (matplotlib-style). */
  symlogLinthresh?: number
  /** Horizontal bands (Y in data space). */
  yBands?: ChartYBand[]
  /** Vertical lines, points, and labels in data space. */
  annotations?: ChartLineAnnotation[]
  /**
   * X-axis zoom: **drag** on the plot to draw a zoom box, **Ctrl/Cmd + wheel**,
   * **Shift + drag** to pan, **double-click** to reset. Emits `zoom` with fractional index range.
   */
  zoomable?: boolean
  /** Rescale Y to data in the visible X window (when `zoomable`). */
  zoomAutoY?: boolean
  /** Minimum visible points along X when zooming in (default 3). */
  zoomMinPoints?: number
  /** Short visible title (figcaption) and primary accessible name when set. */
  chartTitle?: string
  /** Longer description for screen readers and SVG `<desc>`. */
  chartDescription?: string
  /** Render an off-screen data table for high-stakes accessibility. */
  showDataTable?: boolean
  /** Fieldset legend label for the series toggles (screen readers). */
  legendGroupLabel?: string
  /** Text direction for layout mirroring (e.g. RTL). */
  dir?: 'ltr' | 'rtl'
  /** Format category labels on the X axis. */
  formatXLabel?: (label: string, index: number) => string
  /** Format numeric Y-axis tick labels. */
  formatTickValue?: (value: number) => string
  /**
   * Cap plotted categories (subsampling). Prefer with `zoomable={false}` unless you
   * intentionally zoom on decimated indices.
   */
  maxRenderPoints?: number
}>(), {
  smooth: true,
  showGrid: true,
  showPoints: false,
  showArea: false,
  animate: true,
  respectReducedMotion: true,
  dualYAxis: false,
  yScale: 'linear',
  yScaleSecondary: 'linear',
  symlogLinthresh: 1,
  zoomable: false,
  zoomAutoY: true,
  zoomMinPoints: 3,
  showDataTable: false,
  legendGroupLabel: 'Data series',
})

const emit = defineEmits<{
  pointClick: [payload: LinePointClickPayload]
  zoom: [range: LineZoomRange]
}>()

const effLabels = computed(() => {
  const m = props.maxRenderPoints
  if (m && props.labels.length > m) {
    return decimateCategoryData(props.labels, props.series, m).labels
  }
  return props.labels
})

const effSeries = computed(() => {
  const m = props.maxRenderPoints
  if (m && props.labels.length > m) {
    return decimateCategoryData(props.labels, props.series, m).series
  }
  return props.series
})

defineSlots<{
  empty?: () => unknown
  tooltip?: (props: { title: string; items: TooltipItem[]; visible: boolean }) => unknown
  'legend-item'?: (props: { item: LegendItem; toggle: () => void }) => unknown
}>()

/** Fractional category index window; sync with `NardukCandleChart` via mapped indices + `candleTimeAtIndex`. */
const xWindowModel = defineModel<{ start: number; end: number } | undefined>('xWindow')

const showRightAxis = computed(() => {
  if (!props.dualYAxis) return false
  return (
    visibleSeries.value.some(s => s.yAxis === 'secondary')
    || (props.referenceLines ?? []).some(r => r.yAxis === 'secondary')
    || (props.yBands ?? []).some(b => b.yAxis === 'secondary')
    || (props.annotations ?? []).some(
      a => (a.type === 'point' || a.type === 'label')
        && (a as { yAxis?: ChartYAxisId }).yAxis === 'secondary',
    )
  )
})

const paddingOverrides = computed(() => {
  const base = showRightAxis.value ? 56 : 24
  const refLabelPad = (props.referenceLines ?? []).some(r => r.label) ? 10 : 0
  return { right: base + refLabelPad }
})

const containerRef = ref<HTMLElement | null>(null)
const {
  chartWidth,
  chartHeight,
  padding,
  plotWidth,
  plotHeight,
  isDark,
  effectiveAnimate,
} = useChart(containerRef, props, paddingOverrides)
const { tooltip, show: showTooltip, hide: hideTooltip } = useTooltip()

const plotClipIdRaw = useId()
const idSafe = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, '')
const plotClipId = `nc-clip-${idSafe(plotClipIdRaw)}`
const plotClipUrl = computed(() => `url(#${plotClipId})`)
const captionElId = `nc-cap-${idSafe(plotClipIdRaw)}`
const liveRegionElId = `nc-live-${idSafe(plotClipIdRaw)}`
const zoomHintElId = `nc-zoom-${idSafe(plotClipIdRaw)}`
const svgTitleElId = `nc-svgt-${idSafe(plotClipIdRaw)}`
const svgDescElId = `nc-svgd-${idSafe(plotClipIdRaw)}`

/** Fractional index window along `labels` (inclusive ends). */
const xViewMin = ref(0)
const xViewMax = ref(1)

watch(
  () => effLabels.value.length,
  (n) => {
    const full = Math.max(0, n - 1)
    const w = xWindowModel.value
    if (w !== undefined && n > 1) {
      clampViewWindow(w.start, w.end)
      return
    }
    xViewMin.value = 0
    xViewMax.value = full
  },
  { immediate: true },
)

watch(
  () => xWindowModel.value,
  (w) => {
    if (w === undefined || effLabels.value.length <= 1) return
    if (xViewMin.value === w.start && xViewMax.value === w.end) return
    clampViewWindow(w.start, w.end)
  },
  { deep: true },
)

const xFullSpan = computed(() => Math.max(1e-9, effLabels.value.length - 1))

const minIndexSpan = computed(() => {
  const pts = Math.max(2, props.zoomMinPoints ?? 3)
  return Math.min(xFullSpan.value, Math.max(1e-6, pts - 1))
})

function clampViewWindow(a: number, b: number) {
  const full = xFullSpan.value
  let span = b - a
  span = Math.max(minIndexSpan.value, Math.min(full, span))
  let nmin = a
  let nmax = b
  if (nmax - nmin !== span) nmax = nmin + span
  if (nmin < 0) {
    nmax -= nmin
    nmin = 0
  }
  if (nmax > full) {
    nmin -= nmax - full
    nmax = full
    nmin = Math.max(0, nmin)
  }
  xViewMin.value = nmin
  xViewMax.value = nmax
}

function emitZoomRange() {
  const r = { start: xViewMin.value, end: xViewMax.value }
  emit('zoom', r)
  const m = xWindowModel.value
  if (m?.start !== r.start || m?.end !== r.end)
    xWindowModel.value = r
}

function resetZoom() {
  const full = xFullSpan.value
  xViewMin.value = 0
  xViewMax.value = full
  emitZoomRange()
}

function applyWheelZoom(e: WheelEvent) {
  const el = containerRef.value
  if (!el) return
  const svg = el.querySelector('svg')
  if (!svg) return
  const rect = svg.getBoundingClientRect()
  const mouseX = (e.clientX - rect.left) * (chartWidth.value / rect.width)
  const n = effLabels.value.length
  const full = xFullSpan.value
  if (n <= 1 || full <= 0) return

  const lo = xViewMin.value
  const hi = xViewMax.value
  const span = Math.max(1e-9, hi - lo)
  const plotL = padding.value.left
  const pw = plotWidth.value
  const u = pw > 0 ? Math.min(1, Math.max(0, (mouseX - plotL) / pw)) : 0.5
  const focal = lo + u * span

  const zoomIn = e.deltaY < 0
  const factor = zoomIn ? 0.88 : 1.12
  let newSpan = span * factor
  newSpan = Math.max(minIndexSpan.value, Math.min(full, newSpan))

  const focalRel = span > 0 ? (focal - lo) / span : 0.5
  let nmin = focal - focalRel * newSpan
  let nmax = nmin + newSpan
  if (nmin < 0) {
    nmax -= nmin
    nmin = 0
  }
  if (nmax > full) {
    nmin -= nmax - full
    nmax = full
    nmin = Math.max(0, nmin)
  }
  clampViewWindow(nmin, nmax)
  emitZoomRange()
}

watch(
  () => [containerRef.value, props.zoomable] as const,
  ([el, z], _prev, onCleanup) => {
    if (!el || !z) return
    const handler = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      applyWheelZoom(e)
    }
    el.addEventListener('wheel', handler, { passive: false })
    onCleanup(() => el.removeEventListener('wheel', handler))
  },
  { flush: 'post' },
)

const ZOOM_BOX_DRAG_THRESHOLD_PX = 4

const isZoomPanning = ref(false)
let panPointerId = -1
let panStartClientX = 0
let panStartMin = 0
let panStartMax = 0

type ZoomBoxPhase = 'idle' | 'pending' | 'dragging'
const zoomBoxPhase = ref<ZoomBoxPhase>('idle')
const zoomBoxStartSvgX = ref(0)
const zoomBoxCurrentSvgX = ref(0)
let zoomBoxPointerId = -1
let zoomBoxStartClientX = 0
let zoomBoxStartClientY = 0

const suppressNextSvgClick = ref(false)

function clientToSvgX(e: PointerEvent | MouseEvent, svg: SVGSVGElement): number {
  const rect = svg.getBoundingClientRect()
  return (e.clientX - rect.left) * (chartWidth.value / rect.width)
}

function clampSvgXToPlot(svgX: number): number {
  const pl = padding.value.left
  const pr = pl + plotWidth.value
  return Math.min(pr, Math.max(pl, svgX))
}

/** Map plot-area SVG X to fractional label index in the current X window. */
function svgPlotXToDataIndex(svgX: number): number {
  const pl = padding.value.left
  const pw = plotWidth.value
  const lo = xViewMin.value
  const span = Math.max(1e-9, xViewMax.value - lo)
  const u = pw > 0 ? (svgX - pl) / pw : 0.5
  return lo + Math.min(1, Math.max(0, u)) * span
}

const zoomBoxPreview = computed(() => {
  if (zoomBoxPhase.value !== 'dragging') return null
  const pt = padding.value.top
  const ph = plotHeight.value
  const x1 = clampSvgXToPlot(zoomBoxStartSvgX.value)
  const x2 = clampSvgXToPlot(zoomBoxCurrentSvgX.value)
  const left = Math.min(x1, x2)
  const right = Math.max(x1, x2)
  return { x: left, y: pt, w: Math.max(0, right - left), h: ph }
})

function applyZoomFromBox() {
  const n = effLabels.value.length
  if (n <= 1) return
  const x1 = clampSvgXToPlot(zoomBoxStartSvgX.value)
  const x2 = clampSvgXToPlot(zoomBoxCurrentSvgX.value)
  let i0 = svgPlotXToDataIndex(x1)
  let i1 = svgPlotXToDataIndex(x2)
  if (i1 < i0) [i0, i1] = [i1, i0]
  clampViewWindow(i0, i1)
  emitZoomRange()
}

function onPlotPointerDown(e: PointerEvent) {
  if (!props.zoomable || e.button !== 0) return

  const svg = e.currentTarget as SVGSVGElement
  const svgX = clientToSvgX(e, svg)
  const pl = padding.value.left
  const pr = pl + plotWidth.value

  if (e.shiftKey) {
    e.preventDefault()
    isZoomPanning.value = true
    panPointerId = e.pointerId
    panStartClientX = e.clientX
    panStartMin = xViewMin.value
    panStartMax = xViewMax.value
    svg.setPointerCapture(e.pointerId)
    return
  }

  if (svgX < pl || svgX > pr) return
  zoomBoxPhase.value = 'pending'
  zoomBoxPointerId = e.pointerId
  zoomBoxStartSvgX.value = svgX
  zoomBoxCurrentSvgX.value = svgX
  zoomBoxStartClientX = e.clientX
  zoomBoxStartClientY = e.clientY
}

function onPlotPointerMove(e: PointerEvent) {
  const svg = e.currentTarget as SVGSVGElement

  if (props.zoomable && isZoomPanning.value && e.pointerId === panPointerId) {
    const rect = svg.getBoundingClientRect()
    const dx = (e.clientX - panStartClientX) * (chartWidth.value / rect.width)
    const span = panStartMax - panStartMin
    const pw = plotWidth.value
    const deltaIdx = pw > 0 ? -(dx / pw) * span : 0
    const full = xFullSpan.value
    let nmin = panStartMin + deltaIdx
    let nmax = panStartMax + deltaIdx
    if (nmin < 0) {
      nmax -= nmin
      nmin = 0
    }
    if (nmax > full) {
      nmin -= nmax - full
      nmax = full
      nmin = Math.max(0, nmin)
    }
    xViewMin.value = nmin
    xViewMax.value = nmax
    emitZoomRange()
    return
  }

  if (zoomBoxPhase.value === 'idle' || e.pointerId !== zoomBoxPointerId) return

  const svgX = clientToSvgX(e, svg)

  if (zoomBoxPhase.value === 'pending') {
    const dx = e.clientX - zoomBoxStartClientX
    const dy = e.clientY - zoomBoxStartClientY
    if (Math.hypot(dx, dy) >= ZOOM_BOX_DRAG_THRESHOLD_PX) {
      zoomBoxPhase.value = 'dragging'
      e.preventDefault()
      svg.setPointerCapture(e.pointerId)
    }
  }

  if (zoomBoxPhase.value === 'dragging') {
    zoomBoxCurrentSvgX.value = svgX
  }
}

function onPlotPointerEnd(e: PointerEvent) {
  const svg = e.currentTarget as SVGSVGElement

  if (isZoomPanning.value && e.pointerId === panPointerId) {
    isZoomPanning.value = false
    panPointerId = -1
    try {
      svg.releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
    return
  }

  if (zoomBoxPhase.value === 'idle' || e.pointerId !== zoomBoxPointerId) return

  if (zoomBoxPhase.value === 'dragging') {
    applyZoomFromBox()
    suppressNextSvgClick.value = true
  }

  if (zoomBoxPhase.value === 'dragging') {
    try {
      svg.releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
  }

  zoomBoxPhase.value = 'idle'
  zoomBoxPointerId = -1
}

function onPlotDblClick(e: MouseEvent) {
  if (!props.zoomable) return
  e.preventDefault()
  resetZoom()
}

const rootChartClasses = computed(() => {
  const c = ['narduk-chart']
  if (isDark.value) c.push('narduk-chart--dark')
  const t = chartThemeClass(props.theme)
  if (t) c.push(t)
  if (props.zoomable) c.push('narduk-chart--zoomable')
  return c
})

const runAnimation = computed(() => effectiveAnimate(props.animate))

const hiddenSeries = ref(new Set<string>())

function toggleSeries(name: string) {
  const next = new Set(hiddenSeries.value)
  if (next.has(name)) next.delete(name)
  else next.add(name)
  hiddenSeries.value = next
}

const visibleSeries = computed(() =>
  effSeries.value.filter(s => !hiddenSeries.value.has(s.name)),
)

const isEmpty = computed(() => {
  if (props.series.length === 0 || props.labels.length === 0) return true
  const vis = visibleSeries.value
  if (vis.length === 0) return true
  return !vis.some(s => s.data.some(v => v != null && !Number.isNaN(Number(v))))
})

const useDual = computed(() => props.dualYAxis === true && showRightAxis.value)

const primarySeriesList = computed(() => {
  if (!useDual.value) return visibleSeries.value
  return visibleSeries.value.filter(s => (s.yAxis ?? 'primary') === 'primary')
})

const secondarySeriesList = computed(() => {
  if (!useDual.value) return []
  return visibleSeries.value.filter(s => s.yAxis === 'secondary')
})

function numericValues(series: ChartSeries[]): number[] {
  return series.flatMap(s =>
    s.data.filter((v): v is number => v != null && !Number.isNaN(v)),
  )
}

function visibleIndexBounds(): { i0: number; i1: number } {
  const n = effLabels.value.length
  if (n === 0) return { i0: 0, i1: -1 }
  const i0 = Math.max(0, Math.floor(xViewMin.value))
  const i1 = Math.min(n - 1, Math.ceil(xViewMax.value))
  return { i0, i1 }
}

function numericValuesSlice(series: ChartSeries[], i0: number, i1: number): number[] {
  if (i1 < i0) return []
  return series.flatMap((s) => {
    const slice = s.data.slice(i0, i1 + 1)
    return slice.filter((v): v is number => v != null && !Number.isNaN(v))
  })
}

const symlogOpts = computed(() => ({ symlogLinthresh: props.symlogLinthresh }))

const zoomYActive = computed(() => props.zoomable && props.zoomAutoY)

const primaryMap = computed(() => {
  const { i0, i1 } = visibleIndexBounds()
  const sliceY = zoomYActive.value
  const refs = (props.referenceLines ?? [])
    .filter(r => !useDual.value || (r.yAxis ?? 'primary') === 'primary')
    .map(r => r.value)
  const bands = (props.yBands ?? [])
    .filter(b => !useDual.value || (b.yAxis ?? 'primary') === 'primary')
    .flatMap(b => [b.y0, b.y1])
  const annY = (props.annotations ?? [])
    .filter((a): a is Extract<ChartLineAnnotation, { type: 'point' | 'label' }> =>
      a.type === 'point' || a.type === 'label')
    .filter(a => !useDual.value || (a.yAxis ?? 'primary') === 'primary')
    .filter((a) => {
      if (!sliceY) return true
      const x = a.xIndex
      return x >= i0 && x <= i1
    })
    .map(a => a.y)

  const seriesVals = sliceY
    ? numericValuesSlice(primarySeriesList.value, i0, i1)
    : numericValues(primarySeriesList.value)

  return createYAxisMap(
    props.yScale,
    seriesVals,
    [...refs, ...bands, ...annY],
    plotHeight.value,
    symlogOpts.value,
  )
})

const secondaryMap = computed(() => {
  if (!useDual.value) return primaryMap.value
  const { i0, i1 } = visibleIndexBounds()
  const sliceY = zoomYActive.value
  const refs = (props.referenceLines ?? [])
    .filter(r => r.yAxis === 'secondary')
    .map(r => r.value)
  const bands = (props.yBands ?? [])
    .filter(b => b.yAxis === 'secondary')
    .flatMap(b => [b.y0, b.y1])
  const annY = (props.annotations ?? [])
    .filter((a): a is Extract<ChartLineAnnotation, { type: 'point' | 'label' }> =>
      a.type === 'point' || a.type === 'label')
    .filter(a => a.yAxis === 'secondary')
    .filter((a) => {
      if (!sliceY) return true
      const x = a.xIndex
      return x >= i0 && x <= i1
    })
    .map(a => a.y)

  const seriesVals = sliceY
    ? numericValuesSlice(secondarySeriesList.value, i0, i1)
    : numericValues(secondarySeriesList.value)

  return createYAxisMap(
    props.yScaleSecondary,
    seriesVals,
    [...refs, ...bands, ...annY],
    plotHeight.value,
    symlogOpts.value,
  )
})

const primaryTicksForDisplay = computed(() =>
  primaryMap.value.ticks.map(t => ({
    ...t,
    label: props.formatTickValue ? props.formatTickValue(t.value) : t.label,
  })),
)

const secondaryTicksForDisplay = computed(() =>
  secondaryMap.value.ticks.map(t => ({
    ...t,
    label: props.formatTickValue ? props.formatTickValue(t.value) : t.label,
  })),
)

function axisForSeries(s: ChartSeries): ChartYAxisId {
  if (!useDual.value) return 'primary'
  return s.yAxis ?? 'primary'
}

function yMapForAxis(axis: ChartYAxisId) {
  return axis === 'secondary' ? secondaryMap.value : primaryMap.value
}

function yAtDataValue(value: number, axis: ChartYAxisId): number {
  const m = yMapForAxis(axis)
  return padding.value.top + plotHeight.value - m.yFromBottom(value)
}

function yPosForSeries(s: ChartSeries, v: number): number {
  return yAtDataValue(v, axisForSeries(s))
}

function xPos(index: number): number {
  const n = effLabels.value.length
  if (n <= 1) return padding.value.left + plotWidth.value / 2
  const lo = xViewMin.value
  const hi = xViewMax.value
  const span = Math.max(1e-9, hi - lo)
  return padding.value.left + ((index - lo) / span) * plotWidth.value
}

const yBaseline = computed(() => padding.value.top + plotHeight.value)

const seriesRender = computed(() =>
  visibleSeries.value.map((s) => {
    const segments = segmentLinePoints(s.data, (i, v) => [xPos(i), yPosForSeries(s, v)])
    const lineDs = lineSegmentsToPaths(segments, props.smooth)
    const areaDs = props.showArea
      ? lineDs.map((d, i) => closeAreaUnderLine(d, segments[i], yBaseline.value))
      : []
    return { segments, lineDs, areaDs }
  }),
)

function resolveColor(s: ChartSeries): string {
  const idx = props.series.findIndex(x => x.name === s.name)
  return s.color || getColor(props.colors, idx >= 0 ? idx : 0)
}

const activeIndex = ref<number | null>(null)
const kbFocusIndex = ref<number | null>(null)
const svgRef = ref<SVGSVGElement | null>(null)

const effectiveChartTitle = computed(() =>
  props.chartTitle ?? defaultLineChartLabel(props.series, props.labels.length),
)

const ariaDescribedBy = computed(() => {
  const ids: string[] = []
  if (props.chartDescription?.trim()) ids.push(svgDescElId)
  if (props.zoomable) ids.push(zoomHintElId)
  return ids.length ? ids.join(' ') : undefined
})

const displayIndex = computed(() =>
  kbFocusIndex.value !== null ? kbFocusIndex.value : activeIndex.value,
)

const liveSummary = computed(() => {
  const i = displayIndex.value
  if (i === null || isEmpty.value) return ''
  return linePointSummary(formatXAxisLabel(i), visibleSeries.value, i)
})

function formatXAxisLabel(i: number): string {
  const raw = effLabels.value[i] ?? ''
  return props.formatXLabel ? props.formatXLabel(raw, i) : raw
}

function showTooltipAtIndex(idx: number) {
  const items: TooltipItem[] = visibleSeries.value.map((s) => {
    const v = s.data[idx]
    return {
      color: resolveColor(s),
      label: s.name,
      value: v == null || Number.isNaN(v) ? '—' : formatValue(v),
    }
  })
  const px = Math.min(chartWidth.value - 8, Math.max(8, xPos(idx)))
  const py = padding.value.top + plotHeight.value / 2
  showTooltip(px, py, formatXAxisLabel(idx), items)
}

function onSvgFocus() {
  if (isEmpty.value) return
  const { i0, i1 } = visibleIndexBounds()
  const start = Math.min(i1, Math.max(i0, Math.round((i0 + i1) / 2)))
  kbFocusIndex.value = start
  showTooltipAtIndex(start)
}

function onSvgBlur() {
  kbFocusIndex.value = null
  hideTooltip()
}

function onPlotKeydown(e: KeyboardEvent) {
  if (isEmpty.value || effLabels.value.length === 0) return
  const { i0, i1 } = visibleIndexBounds()
  let idx = kbFocusIndex.value ?? Math.min(i1, Math.max(i0, Math.round((i0 + i1) / 2)))

  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
    e.preventDefault()
    idx = Math.min(i1, idx + 1)
    kbFocusIndex.value = idx
    showTooltipAtIndex(idx)
    return
  }
  if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
    e.preventDefault()
    idx = Math.max(i0, idx - 1)
    kbFocusIndex.value = idx
    showTooltipAtIndex(idx)
    return
  }
  if (e.key === 'Home') {
    e.preventDefault()
    kbFocusIndex.value = i0
    showTooltipAtIndex(i0)
    return
  }
  if (e.key === 'End') {
    e.preventDefault()
    kbFocusIndex.value = i1
    showTooltipAtIndex(i1)
    return
  }
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    const cur = kbFocusIndex.value
    if (cur === null) return
    emit('pointClick', {
      index: cur,
      label: effLabels.value[cur],
      values: visibleSeries.value.map(s => ({
        seriesName: s.name,
        value: s.data[cur] ?? null,
      })),
    })
    return
  }
  if (e.key === 'Escape') {
    e.preventDefault()
    hideTooltip()
    kbFocusIndex.value = null
  }
}

function pickNearestIndex(svgX: number): number | null {
  const n = effLabels.value.length
  if (n === 0) return null
  const pl = padding.value.left
  const pr = chartWidth.value - padding.value.right
  const pw = plotWidth.value
  if (svgX < pl - 10 || svgX > pr + 10) return null
  const lo = xViewMin.value
  const hi = xViewMax.value
  const span = Math.max(1e-9, hi - lo)
  const u = pw > 0 ? (svgX - pl) / pw : 0.5
  const frac = lo + Math.min(1, Math.max(0, u)) * span
  const nearest = Math.min(n - 1, Math.max(0, Math.round(frac)))
  return nearest
}

function onMouseMove(event: MouseEvent) {
  if (props.zoomable && zoomBoxPhase.value === 'dragging') {
    activeIndex.value = null
    kbFocusIndex.value = null
    hideTooltip()
    return
  }
  kbFocusIndex.value = null
  const svg = containerRef.value?.querySelector('svg')
  if (!svg) return
  const rect = svg.getBoundingClientRect()
  const mouseX = event.clientX - rect.left
  const mouseY = event.clientY - rect.top
  const svgX = mouseX * (chartWidth.value / rect.width)

  const nearest = pickNearestIndex(svgX)
  if (nearest === null) {
    activeIndex.value = null
    hideTooltip()
    return
  }

  activeIndex.value = nearest

  const items: TooltipItem[] = visibleSeries.value.map(s => {
    const v = s.data[nearest]
    return {
      color: resolveColor(s),
      label: s.name,
      value: v == null || Number.isNaN(v) ? '—' : formatValue(v),
    }
  })

  showTooltip(mouseX, mouseY, effLabels.value[nearest], items)
}

function onMouseLeave() {
  activeIndex.value = null
  if (document.activeElement !== svgRef.value) {
    hideTooltip()
    kbFocusIndex.value = null
  }
}

function onSvgClick(event: MouseEvent) {
  if (suppressNextSvgClick.value) {
    suppressNextSvgClick.value = false
    return
  }
  const svg = containerRef.value?.querySelector('svg')
  if (!svg) return
  const rect = svg.getBoundingClientRect()
  const svgX = (event.clientX - rect.left) * (chartWidth.value / rect.width)
  const idx = pickNearestIndex(svgX)
  if (idx === null) return
  emit('pointClick', {
    index: idx,
    label: effLabels.value[idx],
    values: visibleSeries.value.map(s => ({
      seriesName: s.name,
      value: s.data[idx] ?? null,
    })),
  })
}

const animated = ref(!runAnimation.value)

onMounted(() => {
  if (runAnimation.value) {
    requestAnimationFrame(() => { animated.value = true })
  } else {
    animated.value = true
  }
})

const legendItems = computed<LegendItem[]>(() =>
  props.series.map((s, i) => ({
    name: s.name,
    color: s.color || getColor(props.colors, i),
    hidden: hiddenSeries.value.has(s.name),
  })),
)

/** Integer label indices along X for the visible window (readability). */
const xAxisLabelIndices = computed(() => {
  const n = effLabels.value.length
  if (n === 0) return []
  const i0 = Math.max(0, Math.floor(xViewMin.value))
  const i1 = Math.min(n - 1, Math.ceil(xViewMax.value))
  const span = Math.max(1, i1 - i0 + 1)
  const approxLabelWidth = 50
  const available = plotWidth.value / span
  const step = available >= approxLabelWidth ? 1 : Math.ceil(approxLabelWidth / available)
  const out: number[] = []
  for (let i = i0; i <= i1; i += step) out.push(i)
  if (out.length === 0 || out[out.length - 1] !== i1) out.push(i1)
  return out
})

const primaryBands = computed(() =>
  (props.yBands ?? []).filter(b => !useDual.value || (b.yAxis ?? 'primary') === 'primary'),
)

const secondaryBands = computed(() =>
  (props.yBands ?? []).filter(b => useDual.value && b.yAxis === 'secondary'),
)

const vlineAnnotations = computed(() =>
  (props.annotations ?? []).filter((a): a is Extract<ChartLineAnnotation, { type: 'vline' }> =>
    a.type === 'vline'),
)

const pointAnnotations = computed(() =>
  (props.annotations ?? []).filter((a): a is Extract<ChartLineAnnotation, { type: 'point' }> =>
    a.type === 'point'),
)

const labelAnnotations = computed(() =>
  (props.annotations ?? []).filter((a): a is Extract<ChartLineAnnotation, { type: 'label' }> =>
    a.type === 'label'),
)

function bandRect(b: ChartYBand, axis: ChartYAxisId) {
  const y0p = yAtDataValue(b.y0, axis)
  const y1p = yAtDataValue(b.y1, axis)
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

/** Reference lines with vertically stacked right labels to avoid overlap. */
const referenceLineLayouts = computed(() => {
  const refs = props.referenceLines ?? []
  const lineYs = refs.map((ref, i) => ({
    ref,
    i,
    lineY: yAtDataValue(ref.value, ref.yAxis ?? 'primary'),
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
  return lineYs.map((x) => ({
    ref: x.ref,
    lineY: x.lineY,
    labelY: x.ref.label ? (map.get(x.i) ?? x.lineY) : x.lineY,
  }))
})

const refLabelAnchorX = computed(() => chartWidth.value - padding.value.right + 4)

const svgAriaLabelledby = computed(() => {
  const parts = [svgTitleElId]
  if (props.chartDescription?.trim()) parts.push(svgDescElId)
  return parts.join(' ')
})

const zoomAriaHint = computed(() => zoomKeyboardHint(props.zoomable))
</script>

<template>
  <figure
    class="narduk-chart-figure m-0 min-w-0"
    :dir="dir"
  >
    <figcaption
      v-if="chartTitle"
      :id="captionElId"
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
      :aria-labelledby="chartTitle ? captionElId : undefined"
      :aria-label="chartTitle ? undefined : effectiveChartTitle"
      :aria-describedby="ariaDescribedBy"
    >
      <div
        v-if="zoomable"
        :id="zoomHintElId"
        class="narduk-sr-only"
      >
        {{ zoomAriaHint }}
      </div>
      <div
        :id="liveRegionElId"
        aria-live="polite"
        aria-atomic="true"
        class="narduk-sr-only"
      >
        {{ liveSummary }}
      </div>

      <table
        v-if="showDataTable && !isEmpty"
        class="narduk-sr-only"
      >
        <caption>{{ effectiveChartTitle }}</caption>
        <thead>
          <tr>
            <th scope="col">
              Category
            </th>
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
            <th scope="row">
              {{ formatXLabel ? formatXLabel(lab, ri) : lab }}
            </th>
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
        class="narduk-line-chart__svg"
        role="img"
        :aria-labelledby="svgAriaLabelledby"
        tabindex="0"
        @focus="onSvgFocus"
        @blur="onSvgBlur"
        @keydown="onPlotKeydown"
        @mousemove="onMouseMove"
        @mouseleave="onMouseLeave"
        @click="onSvgClick"
        @pointerdown="onPlotPointerDown"
        @pointermove="onPlotPointerMove"
        @pointerup="onPlotPointerEnd"
        @pointercancel="onPlotPointerEnd"
        @dblclick="onPlotDblClick"
      >
        <title :id="svgTitleElId">{{ effectiveChartTitle }}</title>
        <desc
          v-if="chartDescription?.trim()"
          :id="svgDescElId"
        >
          {{ chartDescription }}
        </desc>
      <defs>
        <clipPath :id="plotClipId">
          <rect
            x="0"
            :y="padding.top"
            :width="chartWidth"
            :height="plotHeight"
          />
        </clipPath>
      </defs>

      <g :clip-path="plotClipUrl">
      <!-- Y bands (behind grid) -->
      <g
        v-if="primaryBands.length"
        class="narduk-y-bands"
      >
        <rect
          v-for="(b, bi) in primaryBands"
          :key="'pb-' + bi"
          class="narduk-y-band"
          :x="bandRect(b, 'primary').x"
          :y="bandRect(b, 'primary').y"
          :width="bandRect(b, 'primary').w"
          :height="bandRect(b, 'primary').h"
          :fill="bandRect(b, 'primary').fill"
          :opacity="bandRect(b, 'primary').opacity"
        />
      </g>
      <g
        v-if="secondaryBands.length"
        class="narduk-y-bands"
      >
        <rect
          v-for="(b, bi) in secondaryBands"
          :key="'sb-' + bi"
          class="narduk-y-band"
          :x="bandRect(b, 'secondary').x"
          :y="bandRect(b, 'secondary').y"
          :width="bandRect(b, 'secondary').w"
          :height="bandRect(b, 'secondary').h"
          :fill="bandRect(b, 'secondary').fill"
          :opacity="bandRect(b, 'secondary').opacity"
        />
      </g>

      <!-- Grid (primary scale) -->
      <g
        v-if="showGrid"
        class="narduk-grid"
      >
        <line
          v-for="(t, ti) in primaryMap.ticks"
          :key="'g-' + ti"
          :x1="padding.left"
          :y1="yAtDataValue(t.value, 'primary')"
          :x2="chartWidth - padding.right"
          :y2="yAtDataValue(t.value, 'primary')"
        />
      </g>

      <!-- Vertical guide annotations -->
      <g
        v-if="vlineAnnotations.length"
        class="narduk-ann-vline"
      >
        <g
          v-for="(vl, vi) in vlineAnnotations"
          :key="'vl-' + vi"
        >
          <line
            class="narduk-ref-line"
            :class="{ 'narduk-ref-line--dashed': vl.dashed !== false }"
            :stroke="vl.color || 'var(--color-chart-muted)'"
            :x1="xPos(vl.xIndex)"
            :y1="padding.top"
            :x2="xPos(vl.xIndex)"
            :y2="chartHeight - padding.bottom"
          />
          <text
            v-if="vl.label"
            class="narduk-ref-label"
            :x="xPos(vl.xIndex) + 4"
            :y="padding.top + 12"
          >
            {{ vl.label }}
          </text>
        </g>
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

      <!-- Series -->
      <g
        v-for="(s, si) in visibleSeries"
        :key="s.name"
      >
        <path
          v-for="(ad, ai) in seriesRender[si].areaDs"
          v-show="ad"
          :key="'a-' + ai"
          class="narduk-area-path"
          :d="ad"
          :fill="resolveColor(s)"
        />
        <path
          v-for="(d, pi) in seriesRender[si].lineDs"
          v-show="d"
          :key="'l-' + pi"
          class="narduk-line-path"
          :d="d"
          :stroke="resolveColor(s)"
          pathLength="1"
          stroke-dasharray="1"
          :stroke-dashoffset="animated ? 0 : 1"
        />

        <circle
          v-if="showPoints"
          v-for="(v, pi) in s.data"
          :key="'p-' + s.name + '-' + pi"
          v-show="v != null && !Number.isNaN(v)"
          class="narduk-line-point"
          :cx="xPos(pi)"
          :cy="yPosForSeries(s, v as number)"
          r="3"
          :fill="resolveColor(s)"
        />
      </g>

      <!-- Annotation markers -->
      <g
        v-if="pointAnnotations.length"
        class="narduk-ann-points"
      >
        <g
          v-for="(ap, pi) in pointAnnotations"
          :key="'ap-' + pi"
        >
          <circle
            class="narduk-ann-point"
            :cx="xPos(ap.xIndex)"
            :cy="yAtDataValue(ap.y, ap.yAxis ?? 'primary')"
            r="5"
            :fill="ap.color || 'var(--color-chart-text)'"
          />
          <text
            v-if="ap.label"
            class="narduk-ref-label"
            :x="xPos(ap.xIndex) + 8"
            :y="yAtDataValue(ap.y, ap.yAxis ?? 'primary')"
            dominant-baseline="middle"
          >
            {{ ap.label }}
          </text>
        </g>
      </g>
      <g
        v-if="labelAnnotations.length"
        class="narduk-ann-labels"
      >
        <text
          v-for="(al, li) in labelAnnotations"
          :key="'al-' + li"
          class="narduk-ann-label"
          :x="xPos(al.xIndex) + (al.dx ?? 0)"
          :y="yAtDataValue(al.y, al.yAxis ?? 'primary') + (al.dy ?? 0)"
          :fill="al.color || 'var(--color-chart-muted)'"
        >
          {{ al.text }}
        </text>
      </g>

      <!-- Crosshair -->
      <g v-if="displayIndex !== null">
        <line
          class="narduk-crosshair"
          :x1="xPos(displayIndex)"
          :y1="padding.top"
          :x2="xPos(displayIndex)"
          :y2="chartHeight - padding.bottom"
        />
        <circle
          v-for="s in visibleSeries"
          :key="s.name"
          v-show="s.data[displayIndex!] != null && !Number.isNaN(s.data[displayIndex!] as number)"
          class="narduk-line-point"
          :cx="xPos(displayIndex)"
          :cy="yPosForSeries(s, s.data[displayIndex!] as number)"
          r="5"
          :fill="resolveColor(s)"
        />
      </g>
      </g>

      <!-- Axes (unclipped so tick labels stay readable) -->
      <g class="narduk-axis">
        <line
          :x1="padding.left"
          :y1="padding.top"
          :x2="padding.left"
          :y2="chartHeight - padding.bottom"
        />
        <text
          v-for="(t, ti) in primaryTicksForDisplay"
          :key="'py-' + ti"
          :x="padding.left - 8"
          :y="yAtDataValue(t.value, 'primary')"
          text-anchor="end"
          dominant-baseline="middle"
        >
          {{ t.label }}
        </text>
      </g>

      <g
        v-if="showRightAxis"
        class="narduk-axis narduk-axis--secondary"
      >
        <line
          :x1="chartWidth - padding.right"
          :y1="padding.top"
          :x2="chartWidth - padding.right"
          :y2="chartHeight - padding.bottom"
        />
        <text
          v-for="(t, ti) in secondaryTicksForDisplay"
          :key="'sy-' + ti"
          :x="chartWidth - padding.right + 8"
          :y="yAtDataValue(t.value, 'secondary')"
          text-anchor="start"
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
        <text
          v-for="i in xAxisLabelIndices"
          :key="'xl-' + i"
          :x="xPos(i)"
          :y="chartHeight - padding.bottom + 20"
          text-anchor="middle"
          dominant-baseline="hanging"
        >
          {{ formatXAxisLabel(i) }}
        </text>
      </g>

      <rect
        v-if="zoomBoxPreview"
        class="narduk-zoom-box"
        :x="zoomBoxPreview.x"
        :y="zoomBoxPreview.y"
        :width="zoomBoxPreview.w"
        :height="zoomBoxPreview.h"
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
