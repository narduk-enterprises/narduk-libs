<script setup lang="ts">
import { ref, computed, watch, onMounted, useId } from 'vue'
import { useChart } from '../composables/useChart'
import { useTooltip } from '../composables/useTooltip'
import {
  formatValue,
  formatAxisTickValue,
  aggregateCandlesDetailed,
  candleTimeAtIndex,
  candleIndexAtTime,
} from '../utils/math'
import { createYAxisMap, dataValueFromBottomPx } from '../utils/yScale'
import type {
  CandleBar,
  CandleTimeDomain,
  CandleZoomRange,
  CandleClickPayload,
  CandleDrawing,
  CandleDrawingTool,
  CandlePlotMetrics,
  CandlePriceDisplayMode,
  CandleBarStyle,
  ChartTheme,
  ChartYScaleMode,
  TooltipItem,
} from '../types'
import { chartThemeClass } from '../utils/chartTheme'
import {
  defaultCandleChartLabel,
  candleBarSummary,
  zoomKeyboardHint,
} from '../utils/chartA11y'
import ChartTooltip from './ChartTooltip.vue'

const props = withDefaults(defineProps<{
  bars: CandleBar[]
  width?: number
  height?: number
  dark?: boolean
  theme?: ChartTheme
  showGrid?: boolean
  animate?: boolean
  respectReducedMotion?: boolean
  chartTitle?: string
  chartDescription?: string
  dir?: 'ltr' | 'rtl'
  /**
   * Drag zoom box, Ctrl/Meta+wheel (or free wheel when `zoomWheelFree`), Shift+drag pan,
   * double-click reset. Emits `zoom` and `update:domain`.
   */
  zoomable?: boolean
  /** Minimum visible span along bar indices (default 3 bars). */
  zoomMinPoints?: number
  /** When true, wheel zoom does not require Ctrl/Meta. */
  zoomWheelFree?: boolean
  /** Cap drawn buckets from the visible window (aggregation). */
  maxDrawBars?: number
  showVolume?: boolean
  /** Fraction of plot height for volume when `showVolume` is set. */
  volumeFraction?: number
  /** Time navigator under the plot. */
  showBrush?: boolean
  /** Controlled visible time window (ms); sync multiple charts via `v-model:domain`. */
  domain?: CandleTimeDomain | null
  formatTickValue?: (value: number) => string
  formatTime?: (tMs: number) => string
  bullColor?: string
  bearColor?: string
  /** Price / tick labels (OHLC, axis, HUD). Falls back to `formatTickValue` then `formatValue`. */
  formatPrice?: (value: number) => string
  /** Extra Y padding as a fraction of visible high−low (default 0.06). */
  yPadFraction?: number
  /** Pointer crosshair (magnetic X to bar); horizontal shows price at cursor. */
  showCrosshair?: boolean
  /** Snap vertical crosshair to the hovered bar center. */
  crosshairMagnetic?: boolean
  /** Latest close line + axis label (right). */
  showLastPrice?: boolean
  /** Subtle close-price polyline across the visible window. */
  showCloseLine?: boolean
  /** Faint verticals when UTC hour or calendar day changes between bars. */
  showSessionGrid?: boolean
  /** Top-left OHLC panel while hovering or focusing a bar. */
  showOhlcHud?: boolean
  /** Y-axis mapping in **display** space (`priceDisplayMode` applied first). */
  yScale?: ChartYScaleMode
  /** Used when `yScale` is `symlog`. */
  symlogLinthresh?: number
  /** Rebases OHLC into % or indexed units (forces linear Y). */
  priceDisplayMode?: CandlePriceDisplayMode
  /** Emphasize the rightmost (forming) bucket in the visible window. */
  highlightFormingBar?: boolean
  /** Candle bodies vs hollow (bull outline) vs OHLC bar ticks. */
  candleStyle?: CandleBarStyle
  /** Serializable overlays in raw price + time (ms) space. */
  drawings?: CandleDrawing[]
  /**
   * When set, drag on the plot creates a drawing instead of a zoom box (wheel / shift-pan still zoom).
   * Emits `update:drawings` with a new array.
   */
  drawingTool?: CandleDrawingTool
}>(), {
  showGrid: true,
  animate: true,
  respectReducedMotion: true,
  zoomable: false,
  zoomMinPoints: 3,
  zoomWheelFree: false,
  maxDrawBars: 512,
  showVolume: false,
  volumeFraction: 0.22,
  showBrush: false,
  domain: undefined,
  yPadFraction: 0.06,
  showCrosshair: true,
  crosshairMagnetic: true,
  showLastPrice: true,
  showCloseLine: true,
  showSessionGrid: false,
  showOhlcHud: true,
  yScale: 'linear',
  symlogLinthresh: 1,
  priceDisplayMode: 'absolute',
  highlightFormingBar: false,
  candleStyle: 'candle',
  drawings: () => [],
  drawingTool: null,
})

const showVolumePane = computed(() => props.showVolume === true)

const emit = defineEmits<{
  zoom: [range: CandleZoomRange]
  'update:domain': [domain: CandleTimeDomain]
  barClick: [payload: CandleClickPayload]
  'update:drawings': [drawings: CandleDrawing[]]
}>()

const rawId = useId()
const idSafe = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, '')
const plotClipId = `nc-cclip-${idSafe(rawId)}`
const plotClipUrl = computed(() => `url(#${plotClipId})`)
const captionElId = `nc-ccap-${idSafe(rawId)}`
const liveRegionElId = `nc-clive-${idSafe(rawId)}`
const zoomHintElId = `nc-czoom-${idSafe(rawId)}`
const svgTitleElId = `nc-csvg-t-${idSafe(rawId)}`
const svgDescElId = `nc-csvg-d-${idSafe(rawId)}`

const containerRef = ref<HTMLElement | null>(null)
const paddingOverrides = computed(() => ({
  left: 62,
  bottom: 52 + (props.showBrush ? 36 : 0),
  right: props.showLastPrice !== false ? 68 : 24,
}))

const {
  chartWidth,
  chartHeight,
  padding,
  plotWidth,
  plotHeight,
  isDark,
  effectiveAnimate,
} = useChart(containerRef, props, paddingOverrides)

const runAnimation = computed(() => effectiveAnimate(props.animate))

const sortedBars = computed(() => {
  const b = props.bars ?? []
  if (b.length <= 1) return b.slice()
  return b.slice().sort((a, c) => a.t - c.t)
})

const isEmpty = computed(() => sortedBars.value.length === 0)

const xViewMin = ref(0)
const xViewMax = ref(1)

const xFullSpan = computed(() => Math.max(1e-9, sortedBars.value.length - 1))

const minIndexSpan = computed(() => {
  const pts = Math.max(2, props.zoomMinPoints ?? 3)
  return Math.min(xFullSpan.value, Math.max(1e-6, pts - 1))
})

watch(
  () => sortedBars.value.length,
  (n) => {
    const full = Math.max(0, n - 1)
    xViewMin.value = 0
    xViewMax.value = full
    if (n > 0) queueMicrotask(() => emitZoomAndDomain())
  },
  { immediate: true },
)

watch(
  () => props.domain,
  (d) => {
    if (!d || sortedBars.value.length === 0) return
    const bars = sortedBars.value
    let a = candleIndexAtTime(bars, d.start)
    let b = candleIndexAtTime(bars, d.end)
    if (b < a) [a, b] = [b, a]
    clampViewWindow(a, b)
  },
  { deep: true },
)

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

function emitZoomAndDomain() {
  const bars = sortedBars.value
  if (bars.length === 0) return
  const z: CandleZoomRange = {
    startTime: candleTimeAtIndex(bars, xViewMin.value),
    endTime: candleTimeAtIndex(bars, xViewMax.value),
    startIndex: xViewMin.value,
    endIndex: xViewMax.value,
  }
  emit('zoom', z)
  emit('update:domain', { start: z.startTime, end: z.endTime })
}

function resetZoom() {
  const full = xFullSpan.value
  xViewMin.value = 0
  xViewMax.value = full
  emitZoomAndDomain()
}

const volGap = 6

const priceInnerHeight = computed(() => {
  if (!showVolumePane.value) return plotHeight.value
  const vf = Math.min(0.45, Math.max(0.12, props.volumeFraction ?? 0.22))
  const volH = Math.max(32, Math.floor(plotHeight.value * vf))
  return Math.max(40, plotHeight.value - volH - volGap)
})

const volumeInnerHeight = computed(() => {
  if (!showVolumePane.value) return 0
  return Math.max(0, plotHeight.value - priceInnerHeight.value - volGap)
})

const volumeTop = computed(() =>
  padding.value.top + priceInnerHeight.value + (showVolumePane.value ? volGap : 0),
)

const mainPlotBottom = computed(() => {
  if (showVolumePane.value) return volumeTop.value + volumeInnerHeight.value
  return padding.value.top + priceInnerHeight.value
})

function visibleIndexBounds(): { i0: number; i1: number } {
  const n = sortedBars.value.length
  if (n === 0) return { i0: 0, i1: -1 }
  const i0 = Math.max(0, Math.floor(xViewMin.value))
  const i1 = Math.min(n - 1, Math.ceil(xViewMax.value))
  return { i0, i1 }
}

const visibleOhlcValues = computed(() => {
  const { i0, i1 } = visibleIndexBounds()
  if (i1 < i0) return []
  const out: number[] = []
  for (let i = i0; i <= i1; i++) {
    const b = sortedBars.value[i]!
    out.push(b.o, b.h, b.l, b.c)
  }
  return out
})

const firstVisibleCloseRef = computed(() => {
  const { i0, i1 } = visibleIndexBounds()
  if (i1 < i0) return 1
  const c = sortedBars.value[i0]?.c
  return c != null && Number.isFinite(c) && c !== 0 ? c : 1
})

function rawToDisplayPrice(raw: number): number {
  const mode = props.priceDisplayMode ?? 'absolute'
  if (mode === 'absolute') return raw
  const ref = firstVisibleCloseRef.value
  if (!Number.isFinite(ref) || ref === 0) return raw
  if (mode === 'percent') return (raw / ref - 1) * 100
  return (raw / ref) * 100
}

const visibleDisplayOhlcValues = computed(() =>
  visibleOhlcValues.value.map(rawToDisplayPrice),
)

const yAxisPadValues = computed(() => {
  const v = visibleDisplayOhlcValues.value
  if (v.length === 0) return []
  const lo = Math.min(...v)
  const hi = Math.max(...v)
  const r = hi - lo || Math.abs(hi) * 0.002 || 1
  const pad = r * (props.yPadFraction ?? 0.06)
  return [lo - pad, hi + pad]
})

const effectiveYScale = computed<ChartYScaleMode>(() => {
  const m = props.priceDisplayMode ?? 'absolute'
  if (m !== 'absolute') return 'linear'
  return props.yScale ?? 'linear'
})

const yMap = computed(() =>
  createYAxisMap(
    effectiveYScale.value,
    visibleDisplayOhlcValues.value,
    yAxisPadValues.value,
    priceInnerHeight.value,
    {
      linearFromZero: false,
      maxTicks: 8,
      symlogLinthresh: props.symlogLinthresh ?? 1,
    },
  ),
)

function formatPriceStr(v: number) {
  if (props.formatPrice) return props.formatPrice(v)
  if (props.formatTickValue) return props.formatTickValue(v)
  const m = props.priceDisplayMode ?? 'absolute'
  if (m === 'percent') return `${formatValue(v)}%`
  if (m === 'indexed') return formatValue(v)
  return formatValue(v)
}

/** Tooltip OHLC uses raw prices when the axis is rebased (% / indexed). */
function formatOhlcTooltipValue(v: number): string {
  if ((props.priceDisplayMode ?? 'absolute') !== 'absolute') return formatValue(v)
  return formatPriceStr(v)
}

const ticksForDisplay = computed(() => {
  const domain = yMap.value.domain
  const custom = props.formatPrice || props.formatTickValue
  const raw = yMap.value.ticks
  return raw.map((t, ti) => {
    const prev = raw[ti - 1]
    const next = raw[ti + 1]
    const step = Math.min(
      prev != null ? Math.abs(t.value - prev.value) : Number.POSITIVE_INFINITY,
      next != null ? Math.abs(next.value - t.value) : Number.POSITIVE_INFINITY,
    )
    const tickStep = Number.isFinite(step) && step > 0 ? step : undefined
    return {
      ...t,
      label: custom
        ? formatPriceStr(t.value)
        : formatAxisTickLabel(domain.min, domain.max, t.value, tickStep),
    }
  })
})

function formatAxisTickLabel(
  domainMin: number,
  domainMax: number,
  value: number,
  tickStep?: number,
): string {
  const m = props.priceDisplayMode ?? 'absolute'
  const opt = tickStep != null ? { tickStep } : undefined
  if (m === 'percent') return `${formatAxisTickValue(domainMin, domainMax, value, opt)}%`
  if (m === 'indexed') return formatAxisTickValue(domainMin, domainMax, value, opt)
  return formatAxisTickValue(domainMin, domainMax, value, opt)
}

function yPriceRaw(rawOhlc: number): number {
  const d = rawToDisplayPrice(rawOhlc)
  return padding.value.top + priceInnerHeight.value - yMap.value.yFromBottom(d)
}

/** Display-space price → pixel Y (crosshair tag). */
function yPriceDisplay(displayValue: number): number {
  return padding.value.top + priceInnerHeight.value - yMap.value.yFromBottom(displayValue)
}

function rawPriceFromPricePaneSvgY(svgY: number): number | null {
  const pt = padding.value.top
  const pb = pt + priceInnerHeight.value
  if (svgY < pt || svgY > pb || priceInnerHeight.value <= 0) return null
  const bottomPx = pb - svgY
  const display = dataValueFromBottomPx(
    effectiveYScale.value,
    bottomPx,
    priceInnerHeight.value,
    yMap.value.domain,
    { symlogLinthresh: props.symlogLinthresh ?? 1 },
  )
  const mode = props.priceDisplayMode ?? 'absolute'
  if (mode === 'absolute') return display
  const ref = firstVisibleCloseRef.value
  if (!Number.isFinite(ref) || ref === 0) return display
  if (mode === 'percent') return ref * (1 + display / 100)
  return ref * display / 100
}

function xPos(index: number): number {
  const n = sortedBars.value.length
  if (n <= 1) return padding.value.left + plotWidth.value / 2
  const lo = xViewMin.value
  const hi = xViewMax.value
  const span = Math.max(1e-9, hi - lo)
  return padding.value.left + ((index - lo) / span) * plotWidth.value
}

function xFromTimeMs(tMs: number): number {
  return xPos(candleIndexAtTime(sortedBars.value, tMs))
}

const drawBuckets = computed(() => {
  const bars = sortedBars.value
  const { i0, i1 } = visibleIndexBounds()
  if (i1 < i0) return [] as { bar: CandleBar; midIdx: number; g0: number; g1: number }[]
  const slice = bars.slice(i0, i1 + 1)
  const cap = Math.max(2, props.maxDrawBars ?? 512)
  const detailed = aggregateCandlesDetailed(slice, Math.min(slice.length, cap))
  return detailed.map((d) => {
    const g0 = i0 + d.i0
    const g1 = i0 + d.i1
    const midIdx = (g0 + g1) / 2
    return { bar: d.bar, midIdx, g0, g1 }
  })
})

const bull = computed(() => props.bullColor ?? 'var(--color-chart-up, #22c55e)')
const bear = computed(() => props.bearColor ?? 'var(--color-chart-down, #ef4444)')

const candleGeoms = computed(() => {
  const slot = plotWidth.value / Math.max(1, drawBuckets.value.length)
  const bodyW = Math.max(1, Math.min(18, slot * 0.68))
  const nBar = sortedBars.value.length
  const forming = props.highlightFormingBar === true && nBar > 0
  return drawBuckets.value.map((d) => {
    const cx = xPos(d.midIdx)
    const { bar: b } = d
    const yh = yPriceRaw(b.h)
    const yl = yPriceRaw(b.l)
    const yo = yPriceRaw(b.o)
    const yc = yPriceRaw(b.c)
    const top = Math.min(yo, yc)
    const bot = Math.max(yo, yc)
    const isUp = b.c >= b.o
    const fill = isUp ? bull.value : bear.value
    return {
      cx,
      yh,
      yl,
      yo,
      yc,
      top,
      bot,
      bodyH: Math.max(1, bot - top),
      bodyW,
      tickW: Math.max(3, bodyW * 0.45),
      wickW: Math.max(1, bodyW * 0.15),
      fill,
      isUp,
      bar: b,
      g0: d.g0,
      g1: d.g1,
      isForming: forming && d.g1 >= nBar - 1,
    }
  })
})

const volumeMax = computed(() => {
  if (!showVolumePane.value) return 1
  const { i0, i1 } = visibleIndexBounds()
  if (i1 < i0) return 1
  let m = 0
  for (let i = i0; i <= i1; i++) {
    const v = sortedBars.value[i]?.v
    if (v != null) m = Math.max(m, v)
  }
  return m > 0 ? m : 1
})

const volumeBars = computed(() => {
  if (!showVolumePane.value) return []
  const slot = plotWidth.value / Math.max(1, drawBuckets.value.length)
  const bodyW = Math.max(1, Math.min(18, slot * 0.68))
  return drawBuckets.value.map((d) => {
    const v = d.bar.v ?? 0
    const h = (v / volumeMax.value) * volumeInnerHeight.value
    const y = volumeTop.value + volumeInnerHeight.value - h
    return {
      x: xPos(d.midIdx) - bodyW / 2,
      y,
      w: bodyW,
      h: Math.max(0, h),
      fill: d.bar.c >= d.bar.o ? bull.value : bear.value,
    }
  })
})

const sessionVlineXs = computed(() => {
  if (!props.showSessionGrid) return [] as number[]
  const bars = sortedBars.value
  const { i0, i1 } = visibleIndexBounds()
  if (i1 < i0) return []
  const xs: number[] = []
  for (let i = Math.max(i0 + 1, 1); i <= i1; i++) {
    const a = new Date(bars[i - 1]!.t)
    const b = new Date(bars[i]!.t)
    if (
      a.getUTCHours() !== b.getUTCHours()
      || a.getUTCDate() !== b.getUTCDate()
      || a.getUTCMonth() !== b.getUTCMonth()
    )
      xs.push(xPos(i))
  }
  return xs
})

const closeLinePath = computed(() => {
  if (!props.showCloseLine) return ''
  const { i0, i1 } = visibleIndexBounds()
  if (i1 < i0) return ''
  const parts: string[] = []
  for (let i = i0; i <= i1; i++) {
    const x = xPos(i)
    const y = yPriceRaw(sortedBars.value[i]!.c)
    parts.push(`${i === i0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`)
  }
  return parts.join(' ')
})

const lastPriceInfo = computed(() => {
  if (props.showLastPrice === false || sortedBars.value.length === 0) return null
  const c = sortedBars.value[sortedBars.value.length - 1]!.c
  const d = yMap.value.domain
  const disp = rawToDisplayPrice(c)
  const y = yPriceRaw(c)
  const inView = disp >= d.min && disp <= d.max
  return { close: c, y, inView }
})

function applyZoomAtFocal(focal: number, zoomIn: boolean) {
  const full = xFullSpan.value
  if (full <= 0) return
  const lo = xViewMin.value
  const hi = xViewMax.value
  const span = Math.max(1e-9, hi - lo)
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
  emitZoomAndDomain()
}

function applyWheelZoom(e: WheelEvent) {
  const el = containerRef.value
  if (!el) return
  const svg = el.querySelector('svg')
  if (!svg) return
  const rect = svg.getBoundingClientRect()
  const mouseX = (e.clientX - rect.left) * (chartWidth.value / rect.width)
  const n = sortedBars.value.length
  const full = xFullSpan.value
  if (n <= 1 || full <= 0) return
  const lo = xViewMin.value
  const hi = xViewMax.value
  const span = Math.max(1e-9, hi - lo)
  const plotL = padding.value.left
  const pw = plotWidth.value
  const u = pw > 0 ? Math.min(1, Math.max(0, (mouseX - plotL) / pw)) : 0.5
  const focal = lo + u * span
  applyZoomAtFocal(focal, e.deltaY < 0)
}

watch(
  () => [containerRef.value, props.zoomable, props.zoomWheelFree] as const,
  ([el, z, free], _p, onCleanup) => {
    if (!el || !z) return
    const handler = (e: WheelEvent) => {
      if (!free && !e.ctrlKey && !e.metaKey) return
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

/** Pointer-driven crosshair; keyboard focus adds a vertical-only line via `crosshairPlot`. */
const pointerCrosshair = ref<{ plotX: number; priceY: number | null } | null>(null)

const FIB_RATIOS = [0, 0.236, 0.382, 0.5, 0.618, 1] as const

const trendDragStart = ref<{
  t0: number
  p0: number
  pointerId: number
  mode: 'trend' | 'fib_retracement'
} | null>(null)
const trendDragCurrent = ref<{ t1: number; p1: number } | null>(null)

const rangeDragStart = ref<{ t0: number; p0: number; pointerId: number } | null>(null)
const rangeDragCurrent = ref<{ t1: number; p1: number } | null>(null)

function newDrawingId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `d-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

const trendPreviewLine = computed(() => {
  const a = trendDragStart.value
  const b = trendDragCurrent.value
  if (!a || !b) return ''
  const x1 = xFromTimeMs(a.t0)
  const y1 = yPriceRaw(a.p0)
  const x2 = xFromTimeMs(b.t1)
  const y2 = yPriceRaw(b.p1)
  return `M ${x1} ${y1} L ${x2} ${y2}`
})

const rangePreviewPath = computed(() => {
  const a = rangeDragStart.value
  const b = rangeDragCurrent.value
  if (!a || !b) return ''
  const tLo = Math.min(a.t0, b.t1)
  const tHi = Math.max(a.t0, b.t1)
  const pTop = Math.max(a.p0, b.p1)
  const pBot = Math.min(a.p0, b.p1)
  const x1 = xFromTimeMs(tLo)
  const x2 = xFromTimeMs(tHi)
  const y1 = yPriceRaw(pTop)
  const y2 = yPriceRaw(pBot)
  const left = Math.min(x1, x2)
  const right = Math.max(x1, x2)
  const top = Math.min(y1, y2)
  const bot = Math.max(y1, y2)
  return `M ${left} ${top} L ${right} ${top} L ${right} ${bot} L ${left} ${bot} Z`
})

const drawingSvgItems = computed(() => {
  const pl = padding.value.left
  const pr = chartWidth.value - padding.value.right
  const out: { key: string; d: string; variant: 'line' | 'fib' | 'rangeFill' | 'rangeStroke' }[] = []
  for (const d of props.drawings ?? []) {
    if (d.type === 'trend') {
      const x1 = xFromTimeMs(d.tStart)
      const y1 = yPriceRaw(d.priceStart)
      const x2 = xFromTimeMs(d.tEnd)
      const y2 = yPriceRaw(d.priceEnd)
      out.push({ key: d.id, d: `M ${x1} ${y1} L ${x2} ${y2}`, variant: 'line' })
    }
    else if (d.type === 'horizontal') {
      const y = yPriceRaw(d.price)
      out.push({ key: d.id, d: `M ${pl} ${y} L ${pr} ${y}`, variant: 'line' })
    }
    else if (d.type === 'fib_retracement') {
      const pHigh = Math.max(d.priceStart, d.priceEnd)
      const pLow = Math.min(d.priceStart, d.priceEnd)
      for (const r of FIB_RATIOS) {
        const price = pHigh - r * (pHigh - pLow)
        const y = yPriceRaw(price)
        out.push({
          key: `${d.id}-fib-${r}`,
          d: `M ${pl} ${y} L ${pr} ${y}`,
          variant: 'fib',
        })
      }
    }
    else {
      const tLo = Math.min(d.tStart, d.tEnd)
      const tHi = Math.max(d.tStart, d.tEnd)
      const pTop = Math.max(d.priceTop, d.priceBottom)
      const pBot = Math.min(d.priceTop, d.priceBottom)
      const x1 = xFromTimeMs(tLo)
      const x2 = xFromTimeMs(tHi)
      const y1 = yPriceRaw(pTop)
      const y2 = yPriceRaw(pBot)
      const left = Math.min(x1, x2)
      const right = Math.max(x1, x2)
      const top = Math.min(y1, y2)
      const bot = Math.max(y1, y2)
      const box = `M ${left} ${top} L ${right} ${top} L ${right} ${bot} L ${left} ${bot} Z`
      out.push({ key: `${d.id}-rf`, d: box, variant: 'rangeFill' })
      out.push({ key: `${d.id}-rs`, d: box, variant: 'rangeStroke' })
    }
  }
  return out
})

function clientToSvgX(e: PointerEvent | MouseEvent, svg: SVGSVGElement): number {
  const rect = svg.getBoundingClientRect()
  return (e.clientX - rect.left) * (chartWidth.value / rect.width)
}

function clientToSvgY(e: PointerEvent | MouseEvent, svg: SVGSVGElement): number {
  const rect = svg.getBoundingClientRect()
  return (e.clientY - rect.top) * (chartHeight.value / rect.height)
}

function clampSvgXToPlot(svgX: number): number {
  const pl = padding.value.left
  const pr = pl + plotWidth.value
  return Math.min(pr, Math.max(pl, svgX))
}

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
  const ph = priceInnerHeight.value
  const x1 = clampSvgXToPlot(zoomBoxStartSvgX.value)
  const x2 = clampSvgXToPlot(zoomBoxCurrentSvgX.value)
  const left = Math.min(x1, x2)
  const right = Math.max(x1, x2)
  return { x: left, y: pt, w: Math.max(0, right - left), h: ph }
})

function applyZoomFromBox() {
  const n = sortedBars.value.length
  if (n <= 1) return
  const x1 = clampSvgXToPlot(zoomBoxStartSvgX.value)
  const x2 = clampSvgXToPlot(zoomBoxCurrentSvgX.value)
  let i0 = svgPlotXToDataIndex(x1)
  let i1 = svgPlotXToDataIndex(x2)
  if (i1 < i0) [i0, i1] = [i1, i0]
  clampViewWindow(i0, i1)
  emitZoomAndDomain()
}

function onPlotPointerDown(e: PointerEvent) {
  if (e.button !== 0) return
  const svg = e.currentTarget as SVGSVGElement
  const svgX = clientToSvgX(e, svg)
  const svgY = clientToSvgY(e, svg)
  const pl = padding.value.left
  const pr = pl + plotWidth.value
  const pt = padding.value.top
  const pb = pt + priceInnerHeight.value

  const tool = props.drawingTool
  if (
    (tool === 'trend' || tool === 'fib_retracement')
    && !e.shiftKey
    && svgX >= pl
    && svgX <= pr
    && svgY >= pt
    && svgY <= pb
  ) {
    e.preventDefault()
    const raw = rawPriceFromPricePaneSvgY(svgY)
    if (raw == null) return
    const t0 = candleTimeAtIndex(sortedBars.value, svgPlotXToDataIndex(clampSvgXToPlot(svgX)))
    trendDragStart.value = {
      t0,
      p0: raw,
      pointerId: e.pointerId,
      mode: tool === 'fib_retracement' ? 'fib_retracement' : 'trend',
    }
    trendDragCurrent.value = { t1: t0, p1: raw }
    svg.setPointerCapture(e.pointerId)
    return
  }
  if (tool === 'horizontal' && !e.shiftKey && svgX >= pl && svgX <= pr && svgY >= pt && svgY <= pb) {
    e.preventDefault()
    const raw = rawPriceFromPricePaneSvgY(svgY)
    if (raw == null) return
    emit('update:drawings', [
      ...(props.drawings ?? []),
      { id: newDrawingId(), type: 'horizontal', price: raw },
    ])
    return
  }
  if (tool === 'range' && !e.shiftKey && svgX >= pl && svgX <= pr && svgY >= pt && svgY <= pb) {
    e.preventDefault()
    const raw = rawPriceFromPricePaneSvgY(svgY)
    if (raw == null) return
    const t0 = candleTimeAtIndex(sortedBars.value, svgPlotXToDataIndex(clampSvgXToPlot(svgX)))
    rangeDragStart.value = { t0, p0: raw, pointerId: e.pointerId }
    rangeDragCurrent.value = { t1: t0, p1: raw }
    svg.setPointerCapture(e.pointerId)
    return
  }

  if (!props.zoomable) return

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

  const td = trendDragStart.value
  if (td && e.pointerId === td.pointerId) {
    const svgX = clientToSvgX(e, svg)
    const svgY = clientToSvgY(e, svg)
    const pl = padding.value.left
    const pr = pl + plotWidth.value
    const pt = padding.value.top
    const pb = pt + priceInnerHeight.value
    const cx = clampSvgXToPlot(svgX)
    const cy = Math.min(pb, Math.max(pt, svgY))
    const raw = rawPriceFromPricePaneSvgY(cy)
    const t1 = candleTimeAtIndex(sortedBars.value, svgPlotXToDataIndex(cx))
    trendDragCurrent.value = {
      t1,
      p1: raw ?? td.p0,
    }
    return
  }

  const rd = rangeDragStart.value
  if (rd && e.pointerId === rd.pointerId) {
    const svgX = clientToSvgX(e, svg)
    const svgY = clientToSvgY(e, svg)
    const pt = padding.value.top
    const pb = pt + priceInnerHeight.value
    const cx = clampSvgXToPlot(svgX)
    const cy = Math.min(pb, Math.max(pt, svgY))
    const raw = rawPriceFromPricePaneSvgY(cy)
    const t1 = candleTimeAtIndex(sortedBars.value, svgPlotXToDataIndex(cx))
    rangeDragCurrent.value = {
      t1,
      p1: raw ?? rd.p0,
    }
    return
  }

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
    emitZoomAndDomain()
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
  if (zoomBoxPhase.value === 'dragging') zoomBoxCurrentSvgX.value = svgX
}

function onPlotPointerEnd(e: PointerEvent) {
  const svg = e.currentTarget as SVGSVGElement
  const td = trendDragStart.value
  if (td && e.pointerId === td.pointerId) {
    const cur = trendDragCurrent.value
    trendDragStart.value = null
    trendDragCurrent.value = null
    try {
      svg.releasePointerCapture(e.pointerId)
    } catch { /* ignore */ }
    suppressNextSvgClick.value = true
    if (cur && (Math.abs(cur.t1 - td.t0) > 0.5 || Math.abs(cur.p1 - td.p0) > 1e-9)) {
      const next =
        td.mode === 'fib_retracement'
          ? {
              id: newDrawingId(),
              type: 'fib_retracement' as const,
              tStart: td.t0,
              priceStart: td.p0,
              tEnd: cur.t1,
              priceEnd: cur.p1,
            }
          : {
              id: newDrawingId(),
              type: 'trend' as const,
              tStart: td.t0,
              priceStart: td.p0,
              tEnd: cur.t1,
              priceEnd: cur.p1,
            }
      emit('update:drawings', [...(props.drawings ?? []), next])
    }
    return
  }

  const rds = rangeDragStart.value
  if (rds && e.pointerId === rds.pointerId) {
    const cur = rangeDragCurrent.value
    rangeDragStart.value = null
    rangeDragCurrent.value = null
    try {
      svg.releasePointerCapture(e.pointerId)
    }
    catch { /* ignore */ }
    suppressNextSvgClick.value = true
    if (
      cur
      && (Math.abs(cur.t1 - rds.t0) > 0.5 || Math.abs(cur.p1 - rds.p0) > 1e-9)
    ) {
      emit('update:drawings', [
        ...(props.drawings ?? []),
        {
          id: newDrawingId(),
          type: 'range',
          tStart: Math.min(rds.t0, cur.t1),
          tEnd: Math.max(rds.t0, cur.t1),
          priceTop: Math.max(rds.p0, cur.p1),
          priceBottom: Math.min(rds.p0, cur.p1),
        },
      ])
    }
    return
  }
  if (isZoomPanning.value && e.pointerId === panPointerId) {
    isZoomPanning.value = false
    panPointerId = -1
    try {
      svg.releasePointerCapture(e.pointerId)
    } catch { /* ignore */ }
    return
  }
  if (zoomBoxPhase.value === 'idle' || e.pointerId !== zoomBoxPointerId) return
  if (zoomBoxPhase.value === 'dragging') {
    applyZoomFromBox()
    suppressNextSvgClick.value = true
    try {
      svg.releasePointerCapture(e.pointerId)
    } catch { /* ignore */ }
  }
  zoomBoxPhase.value = 'idle'
  zoomBoxPointerId = -1
}

function onPlotDblClick(e: MouseEvent) {
  if (!props.zoomable) return
  e.preventDefault()
  resetZoom()
}

let pinchDist0 = 0
let pinchSpan0 = 0
let pinchFocal = 0

function onTouchStart(e: TouchEvent) {
  if (!props.zoomable || e.touches.length !== 2) return
  e.preventDefault()
  const t = e.touches
  pinchDist0 = Math.hypot(
    t[0]!.clientX - t[1]!.clientX,
    t[0]!.clientY - t[1]!.clientY,
  )
  pinchSpan0 = xViewMax.value - xViewMin.value
  const midX = (t[0]!.clientX + t[1]!.clientX) / 2
  const el = containerRef.value
  const svg = el?.querySelector('svg') as SVGSVGElement | undefined
  if (!svg || pinchDist0 <= 0) return
  const svgX = (midX - svg.getBoundingClientRect().left) * (chartWidth.value / svg.getBoundingClientRect().width)
  pinchFocal = svgPlotXToDataIndex(svgX)
}

function onTouchMove(e: TouchEvent) {
  if (!props.zoomable || e.touches.length !== 2 || pinchDist0 <= 0) return
  e.preventDefault()
  const t = e.touches
  const d = Math.hypot(
    t[0]!.clientX - t[1]!.clientX,
    t[0]!.clientY - t[1]!.clientY,
  )
  if (d <= 0) return
  const ratio = d / pinchDist0
  const full = xFullSpan.value
  let newSpan = pinchSpan0 * ratio
  newSpan = Math.max(minIndexSpan.value, Math.min(full, newSpan))
  const lo = xViewMin.value
  const hi = xViewMax.value
  const span = Math.max(1e-9, hi - lo)
  const focalRel = span > 0 ? (pinchFocal - lo) / span : 0.5
  let nmin = pinchFocal - focalRel * newSpan
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
  emitZoomAndDomain()
}

function onTouchEnd(e: TouchEvent) {
  if (e.touches.length < 2) pinchDist0 = 0
}

const brushH = 28
const brushTop = computed(() => chartHeight.value - padding.value.bottom + 4)

const minimapPath = computed(() => {
  const bars = sortedBars.value
  if (bars.length < 2) return ''
  const pl = padding.value.left
  const pr = chartWidth.value - padding.value.right
  const w = pr - pl
  const top = brushTop.value + 3
  const bot = brushTop.value + brushH - 3
  let minP = Infinity
  let maxP = -Infinity
  for (const b of bars) {
    minP = Math.min(minP, b.c)
    maxP = Math.max(maxP, b.c)
  }
  if (!Number.isFinite(minP) || minP === maxP) {
    const y = (top + bot) / 2
    return `M ${pl} ${y} L ${pr} ${y}`
  }
  const pts = bars.map((b, i) => {
    const x = pl + (i / (bars.length - 1)) * w
    const u = (b.c - minP) / (maxP - minP)
    const y = bot - u * (bot - top)
    return `${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`
  })
  return pts.join(' ')
})

const brushWindowRect = computed(() => {
  const bars = sortedBars.value
  if (bars.length <= 1) return null
  const pl = padding.value.left
  const pr = chartWidth.value - padding.value.right
  const w = pr - pl
  const full = xFullSpan.value
  const x0 = pl + (xViewMin.value / full) * w
  const x1 = pl + (xViewMax.value / full) * w
  return {
    x: Math.min(x0, x1),
    w: Math.max(2, Math.abs(x1 - x0)),
  }
})

let brushPanStart = 0
let brushViewMin0 = 0
let brushViewMax0 = 0
let brushPointerId = -1

function onBrushPointerDown(e: PointerEvent) {
  if (!props.showBrush || !props.zoomable) return
  const svg = e.currentTarget as SVGSVGElement
  const svgX = clientToSvgX(e, svg)
  const pl = padding.value.left
  const pr = chartWidth.value - padding.value.right
  if (svgX < pl || svgX > pr) return
  e.preventDefault()
  brushPointerId = e.pointerId
  brushPanStart = svgX
  brushViewMin0 = xViewMin.value
  brushViewMax0 = xViewMax.value
  svg.setPointerCapture(e.pointerId)
}

function onBrushPointerMove(e: PointerEvent) {
  if (brushPointerId !== e.pointerId) return
  const svg = e.currentTarget as SVGSVGElement
  const svgX = clientToSvgX(e, svg)
  const pl = padding.value.left
  const pw = plotWidth.value
  const full = xFullSpan.value
  const dxIdx = pw > 0 ? ((svgX - brushPanStart) / pw) * full : 0
  let nmin = brushViewMin0 - dxIdx
  let nmax = brushViewMax0 - dxIdx
  const span = nmax - nmin
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
  emitZoomAndDomain()
}

function onBrushPointerUp(e: PointerEvent) {
  if (e.pointerId !== brushPointerId) return
  brushPointerId = -1
  try {
    (e.currentTarget as SVGSVGElement).releasePointerCapture(e.pointerId)
  } catch { /* ignore */ }
}

const { tooltip, show: showTooltip, hide: hideTooltip } = useTooltip()
const svgRef = ref<SVGSVGElement | null>(null)
const activeIndex = ref<number | null>(null)
const kbFocusIndex = ref<number | null>(null)

const effectiveChartTitle = computed(() =>
  props.chartTitle ?? defaultCandleChartLabel(sortedBars.value.length),
)

function formatTimeLabel(t: number): string {
  if (props.formatTime) return props.formatTime(t)
  const d = new Date(t)
  return Number.isNaN(d.getTime()) ? String(t) : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

const displayIndex = computed(() =>
  kbFocusIndex.value !== null ? kbFocusIndex.value : activeIndex.value,
)

const crosshairPlot = computed(() => {
  if (props.showCrosshair === false) return null
  const p = pointerCrosshair.value
  if (p) return p
  const kb = kbFocusIndex.value
  if (kb !== null) return { plotX: xPos(kb), priceY: null as number | null }
  return null
})

/** When Y matches the last-price pill, draw the crosshair price tag on the left edge instead. */
const crosshairPriceTagLayout = computed(() => {
  const cp = crosshairPlot.value
  if (!cp || cp.priceY == null) return null
  const yCenter = yPriceDisplay(cp.priceY)
  const tagW = 62
  const tagH = 18
  const pr = padding.value
  const cw = chartWidth.value
  const rightX = cw - pr.right + 2
  const leftX = pr.left + 2
  const overlapLast =
    props.showLastPrice !== false
    && lastPriceInfo.value?.inView === true
    && Math.abs(yCenter - lastPriceInfo.value.y) < 24
  const rectX = overlapLast ? leftX : rightX
  return {
    rectX,
    rectY: yCenter - tagH / 2,
    textX: rectX + tagW / 2,
    tagW,
    tagH,
  }
})

/** OHLC HUD anchored top-right inside the price pane so it clears titles and left-side data. */
const hudTransform = computed(() => {
  const w = 124
  const x = chartWidth.value - padding.value.right - w - 4
  const y = padding.value.top + 6
  return `translate(${Math.max(padding.value.left + 4, x)}, ${y})`
})

const overlayPlotMetrics = computed((): CandlePlotMetrics => ({
  chartWidth: chartWidth.value,
  chartHeight: chartHeight.value,
  padding: { ...padding.value },
  plotWidth: plotWidth.value,
  priceInnerHeight: priceInnerHeight.value,
  xViewMin: xViewMin.value,
  xViewMax: xViewMax.value,
  yDomain: { ...yMap.value.domain },
  indexFromSvgX: (sx: number) => svgPlotXToDataIndex(clampSvgXToPlot(sx)),
  xPos: (i: number) => xPos(i),
  priceYFromRaw: (r: number) => yPriceRaw(r),
  timeAtIndex: (i: number) => candleTimeAtIndex(sortedBars.value, i),
  rawFromPlotY: (svgY: number) => rawPriceFromPricePaneSvgY(svgY) ?? NaN,
}))

const hudBar = computed(() => {
  if (props.showOhlcHud === false) return null
  const i = displayIndex.value
  if (i === null) return null
  return sortedBars.value[i] ?? null
})

const liveSummary = computed(() => {
  const i = displayIndex.value
  if (i === null || isEmpty.value) return ''
  const b = sortedBars.value[i]
  if (!b) return ''
  return candleBarSummary(b, formatTimeLabel(b.t))
})

const ariaDescribedBy = computed(() => {
  const ids: string[] = []
  if (props.chartDescription?.trim()) ids.push(svgDescElId)
  if (props.zoomable) ids.push(zoomHintElId)
  return ids.length ? ids.join(' ') : undefined
})

const zoomAriaHint = computed(() => zoomKeyboardHint(props.zoomable))

function visibleIntegerBounds(): { i0: number; i1: number } {
  return visibleIndexBounds()
}

function showTooltipAtIndex(idx: number) {
  if (props.showOhlcHud !== false) return
  const b = sortedBars.value[idx]
  if (!b) return
  const px = Math.min(chartWidth.value - 8, Math.max(8, xPos(idx)))
  const py = padding.value.top + priceInnerHeight.value / 2
  const items: TooltipItem[] = [
    { color: bull.value, label: 'O', value: formatOhlcTooltipValue(b.o) },
    { color: bear.value, label: 'H', value: formatOhlcTooltipValue(b.h) },
    { color: bear.value, label: 'L', value: formatOhlcTooltipValue(b.l) },
    { color: bull.value, label: 'C', value: formatOhlcTooltipValue(b.c) },
  ]
  if (b.v != null) items.push({ color: 'var(--color-chart-muted)', label: 'V', value: formatValue(b.v) })
  showTooltip(px, py, formatTimeLabel(b.t), items)
}

function updatePointerTooltipFromBar(nearest: number, mouseX: number, mouseY: number) {
  if (props.showOhlcHud !== false) {
    hideTooltip()
    return
  }
  const b = sortedBars.value[nearest]!
  const items: TooltipItem[] = [
    { color: bull.value, label: 'O', value: formatOhlcTooltipValue(b.o) },
    { color: bear.value, label: 'H', value: formatOhlcTooltipValue(b.h) },
    { color: bear.value, label: 'L', value: formatOhlcTooltipValue(b.l) },
    { color: bull.value, label: 'C', value: formatOhlcTooltipValue(b.c) },
  ]
  if (b.v != null) items.push({ color: 'var(--color-chart-muted)', label: 'V', value: formatValue(b.v) })
  showTooltip(mouseX, mouseY, formatTimeLabel(b.t), items)
}

function onSvgFocus() {
  if (isEmpty.value) return
  const { i0, i1 } = visibleIntegerBounds()
  const start = Math.min(i1, Math.max(i0, Math.round((i0 + i1) / 2)))
  kbFocusIndex.value = start
  showTooltipAtIndex(start)
}

function onSvgBlur() {
  kbFocusIndex.value = null
  pointerCrosshair.value = null
  hideTooltip()
}

function onPlotKeydown(e: KeyboardEvent) {
  if (isEmpty.value) return
  const { i0, i1 } = visibleIntegerBounds()
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
    const bar = sortedBars.value[cur]
    if (bar) emit('barClick', { index: cur, bar })
    return
  }
  if (e.key === 'Escape') {
    e.preventDefault()
    hideTooltip()
    kbFocusIndex.value = null
  }
  if (e.key === 'Delete' && (props.drawings?.length ?? 0) > 0) {
    e.preventDefault()
    emit('update:drawings', [])
  }
}

function pickNearestIndex(svgX: number): number | null {
  const n = sortedBars.value.length
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
  return Math.min(n - 1, Math.max(0, Math.round(frac)))
}

function onMouseMove(event: MouseEvent) {
  if (props.zoomable && zoomBoxPhase.value === 'dragging') {
    activeIndex.value = null
    kbFocusIndex.value = null
    pointerCrosshair.value = null
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
  const svgY = mouseY * (chartHeight.value / rect.height)
  const pl = padding.value.left
  const pr = chartWidth.value - padding.value.right
  const pt = padding.value.top
  const pb = pt + priceInnerHeight.value
  const nearest = pickNearestIndex(svgX)
  if (nearest === null) {
    activeIndex.value = null
    pointerCrosshair.value = null
    hideTooltip()
    return
  }
  activeIndex.value = nearest
  updatePointerTooltipFromBar(nearest, mouseX, mouseY)

  if (props.showCrosshair !== false && svgX >= pl && svgX <= pr && svgY >= pt && svgY <= mainPlotBottom.value) {
    const d = yMap.value.domain
    const inPrice = svgY >= pt && svgY <= pb
    let priceY: number | null = null
    if (inPrice && priceInnerHeight.value > 0) {
      const bottomPx = pb - svgY
      priceY = dataValueFromBottomPx(
        effectiveYScale.value,
        bottomPx,
        priceInnerHeight.value,
        d,
        { symlogLinthresh: props.symlogLinthresh ?? 1 },
      )
    }
    const plotX = props.crosshairMagnetic !== false ? xPos(nearest) : svgX
    pointerCrosshair.value = { plotX, priceY }
  } else {
    pointerCrosshair.value = null
  }
}

function onMouseLeave() {
  activeIndex.value = null
  pointerCrosshair.value = null
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
  const bar = sortedBars.value[idx]
  if (bar) emit('barClick', { index: idx, bar })
}

const xAxisLabelIndices = computed(() => {
  const n = sortedBars.value.length
  if (n === 0) return []
  const bars = sortedBars.value
  const { i0, i1 } = visibleIndexBounds()
  const span = Math.max(1, i1 - i0 + 1)
  /** Long datetime strings need more space; cap count from plot width (not bar width). */
  const minPxPerLabel = 112
  const pw = Math.max(1, plotWidth.value)
  const maxSlots = Math.max(2, Math.floor(pw / minPxPerLabel))
  const count = Math.min(span, maxSlots)
  if (count >= span) {
    return dedupeTimeAxisIndices(
      Array.from({ length: span }, (_, k) => i0 + k),
      (i) => formatTimeLabel(bars[i]!.t),
    )
  }
  const out: number[] = []
  for (let k = 0; k < count; k++) {
    const t = count <= 1 ? 0 : k / (count - 1)
    out.push(Math.round(i0 + t * (i1 - i0)))
  }
  let uniq = [...new Set(out)].sort((a, b) => a - b)
  if (uniq.length === 0) return [i0]
  if (uniq[0] !== i0) uniq = [i0, ...uniq]
  if (uniq[uniq.length - 1] !== i1) uniq = [...uniq, i1]
  const merged = [...new Set(uniq)].sort((a, b) => a - b)
  return dedupeTimeAxisIndices(merged, (i) => formatTimeLabel(bars[i]!.t))
})

/** Drop interior ticks whose formatted time matches the previous tick (reduces overlap when zoomed). */
function dedupeTimeAxisIndices(indices: number[], labelAt: (i: number) => string): number[] {
  if (indices.length <= 2) return indices
  const out: number[] = [indices[0]!]
  let lastLab = labelAt(indices[0]!)
  for (let k = 1; k < indices.length - 1; k++) {
    const i = indices[k]!
    const lab = labelAt(i)
    if (lab === lastLab) continue
    out.push(i)
    lastLab = lab
  }
  const last = indices[indices.length - 1]!
  if (out[out.length - 1] !== last) out.push(last)
  return out
}

const rootChartClasses = computed(() => {
  const c = ['narduk-chart']
  if (isDark.value) c.push('narduk-chart--dark')
  const t = chartThemeClass(props.theme)
  if (t) c.push(t)
  if (props.zoomable) c.push('narduk-chart--zoomable')
  return c
})

const svgAriaLabelledby = computed(() => {
  const parts = [svgTitleElId]
  if (props.chartDescription?.trim()) parts.push(svgDescElId)
  return parts.join(' ')
})

const animated = ref(!runAnimation.value)

onMounted(() => {
  if (runAnimation.value) requestAnimationFrame(() => { animated.value = true })
  else animated.value = true
})

watch(
  () => containerRef.value,
  (el, _p, onCleanup) => {
    if (!el) return
    const opts: AddEventListenerOptions = { passive: false }
    el.addEventListener('touchstart', onTouchStart, opts)
    el.addEventListener('touchmove', onTouchMove, opts)
    el.addEventListener('touchend', onTouchEnd)
    el.addEventListener('touchcancel', onTouchEnd)
    onCleanup(() => {
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', onTouchEnd)
      el.removeEventListener('touchcancel', onTouchEnd)
    })
  },
  { flush: 'post' },
)

function getCandlePlotMetrics(): CandlePlotMetrics {
  return overlayPlotMetrics.value
}

defineExpose({
  getCandlePlotMetrics,
})
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
        class="narduk-candle-chart__svg"
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

        <rect
          class="narduk-plot-surface narduk-plot-surface--price"
          :x="padding.left"
          :y="padding.top"
          :width="plotWidth"
          :height="priceInnerHeight"
          rx="12"
        />
        <rect
          v-if="showVolumePane"
          class="narduk-plot-surface narduk-plot-surface--volume"
          :x="padding.left"
          :y="volumeTop"
          :width="plotWidth"
          :height="volumeInnerHeight"
          rx="10"
        />
        <g :clip-path="plotClipUrl">
          <g
            v-if="showGrid"
            class="narduk-grid"
          >
            <line
              v-for="(t, ti) in yMap.ticks"
              :key="'g-' + ti"
              :x1="padding.left"
              :y1="padding.top + priceInnerHeight - yMap.yFromBottom(t.value)"
              :x2="chartWidth - padding.right"
              :y2="padding.top + priceInnerHeight - yMap.yFromBottom(t.value)"
            />
          </g>

          <g
            v-if="sessionVlineXs.length"
            class="narduk-candle-session"
            pointer-events="none"
          >
            <line
              v-for="(vx, si) in sessionVlineXs"
              :key="'sv-' + si"
              :x1="vx"
              :x2="vx"
              :y1="padding.top"
              :y2="mainPlotBottom"
            />
          </g>

          <path
            v-if="closeLinePath"
            class="narduk-candle-close-line"
            fill="none"
            pointer-events="none"
            :d="closeLinePath"
          />

          <g class="narduk-candles">
            <g
              v-for="(c, ci) in candleGeoms"
              :key="'c-' + ci"
            >
              <template v-if="candleStyle === 'bar'">
                <line
                  class="narduk-candle__wick"
                  :x1="c.cx"
                  :x2="c.cx"
                  :y1="c.yh"
                  :y2="c.yl"
                  :stroke="c.fill"
                  stroke-width="1"
                />
                <line
                  class="narduk-candle__tick"
                  :x1="c.cx - c.tickW"
                  :x2="c.cx"
                  :y1="c.yo"
                  :y2="c.yo"
                  :stroke="c.fill"
                  stroke-width="1"
                />
                <line
                  class="narduk-candle__tick"
                  :x1="c.cx"
                  :x2="c.cx + c.tickW"
                  :y1="c.yc"
                  :y2="c.yc"
                  :stroke="c.fill"
                  stroke-width="1"
                />
              </template>
              <template v-else>
                <line
                  class="narduk-candle__wick"
                  :x1="c.cx"
                  :x2="c.cx"
                  :y1="c.yh"
                  :y2="c.yl"
                  :stroke="c.fill"
                  stroke-width="1"
                />
                <rect
                  class="narduk-candle__body"
                  :class="{
                    'narduk-candle__body--forming': c.isForming,
                    'narduk-candle__body--hollow': candleStyle === 'hollow',
                  }"
                  :data-nc-candle="ci"
                  :x="c.cx - c.bodyW / 2"
                  :y="c.top"
                  :width="c.bodyW"
                  :height="c.bodyH"
                  :rx="Math.min(2.5, c.bodyW / 3)"
                  :fill="candleStyle === 'hollow' && c.isUp ? 'none' : c.fill"
                  :stroke="candleStyle === 'hollow' ? c.fill : 'none'"
                  :stroke-width="candleStyle === 'hollow' ? 1.25 : 0"
                />
              </template>
            </g>
          </g>

          <g
            v-if="lastPriceInfo && lastPriceInfo.inView"
            class="narduk-candle-last-price"
            pointer-events="none"
          >
            <line
              :x1="padding.left"
              :x2="chartWidth - padding.right"
              :y1="lastPriceInfo.y"
              :y2="lastPriceInfo.y"
            />
            <rect
              :x="chartWidth - padding.right + 2"
              :y="lastPriceInfo.y - 11"
              width="64"
              height="22"
              rx="11"
              class="narduk-candle-last-price__tag"
            />
            <text
              class="narduk-candle-last-price__text"
              :x="chartWidth - padding.right + 34"
              :y="lastPriceInfo.y"
              dominant-baseline="middle"
              text-anchor="middle"
            >
              {{ formatPriceStr(rawToDisplayPrice(lastPriceInfo.close)) }}
            </text>
          </g>

          <g
            v-if="drawingSvgItems.length || trendPreviewLine || rangePreviewPath"
            class="narduk-candle-drawings"
            pointer-events="none"
          >
            <template
              v-for="p in drawingSvgItems"
              :key="p.key"
            >
              <path
                v-if="p.variant === 'rangeFill'"
                class="narduk-candle-drawing narduk-candle-drawing--range-fill"
                :d="p.d"
              />
              <path
                v-else
                class="narduk-candle-drawing"
                :class="{
                  'narduk-candle-drawing--fib': p.variant === 'fib',
                  'narduk-candle-drawing--range-stroke': p.variant === 'rangeStroke',
                }"
                fill="none"
                :d="p.d"
              />
            </template>
            <path
              v-if="rangePreviewPath"
              class="narduk-candle-drawing narduk-candle-drawing--range-fill narduk-candle-drawing--preview"
              :d="rangePreviewPath"
            />
            <path
              v-if="trendPreviewLine"
              class="narduk-candle-drawing narduk-candle-drawing--preview"
              fill="none"
              :d="trendPreviewLine"
            />
          </g>

          <g
            v-if="showVolumePane"
            class="narduk-candle-volume"
          >
            <rect
              :x="padding.left"
              :y="volumeTop"
              :width="plotWidth"
              :height="volumeInnerHeight"
              class="narduk-candle-volume__bg"
            />
            <rect
              v-for="(vb, vi) in volumeBars"
              :key="'v-' + vi"
              class="narduk-candle-volume__bar"
              :x="vb.x"
              :y="vb.y"
              :width="vb.w"
              :height="vb.h"
              :rx="Math.min(2, vb.w / 3)"
              :fill="vb.fill"
            />
          </g>

          <g
            v-if="crosshairPlot"
            class="narduk-candle-crosshair"
            pointer-events="none"
          >
            <line
              :x1="crosshairPlot.plotX"
              :x2="crosshairPlot.plotX"
              :y1="padding.top"
              :y2="mainPlotBottom"
            />
            <template v-if="crosshairPlot.priceY != null && crosshairPriceTagLayout">
              <line
                :x1="padding.left"
                :x2="chartWidth - padding.right"
                :y1="yPriceDisplay(crosshairPlot.priceY)"
                :y2="yPriceDisplay(crosshairPlot.priceY)"
              />
              <rect
                :x="crosshairPriceTagLayout.rectX"
                :y="crosshairPriceTagLayout.rectY"
                :width="crosshairPriceTagLayout.tagW"
                :height="crosshairPriceTagLayout.tagH"
                rx="9"
                class="narduk-candle-crosshair__tag"
              />
              <text
                class="narduk-candle-crosshair__text"
                :x="crosshairPriceTagLayout.textX"
                :y="yPriceDisplay(crosshairPlot.priceY)"
                dominant-baseline="middle"
                text-anchor="middle"
              >
                {{ formatPriceStr(crosshairPlot.priceY) }}
              </text>
            </template>
          </g>

          <g
            v-if="hudBar"
            class="narduk-candle-hud"
            pointer-events="none"
            :transform="hudTransform"
          >
            <rect
              x="0"
              y="0"
              width="124"
              height="76"
              rx="10"
              class="narduk-candle-hud__bg"
            />
            <text
              x="118"
              y="14"
              class="narduk-candle-hud__title"
              text-anchor="end"
            >
              {{ formatTimeLabel(hudBar.t) }}
            </text>
            <text
              x="118"
              y="32"
              class="narduk-candle-hud__row"
              text-anchor="end"
            >
              O {{ formatPriceStr(hudBar.o) }} · H {{ formatPriceStr(hudBar.h) }}
            </text>
            <text
              x="118"
              y="48"
              class="narduk-candle-hud__row"
              text-anchor="end"
            >
              L {{ formatPriceStr(hudBar.l) }} · C {{ formatPriceStr(hudBar.c) }}
            </text>
            <text
              v-if="hudBar.v != null"
              x="118"
              y="64"
              class="narduk-candle-hud__muted"
              text-anchor="end"
            >
              Vol {{ formatValue(hudBar.v) }}
            </text>
          </g>

          <slot
            v-if="$slots.overlay"
            name="overlay"
            :metrics="overlayPlotMetrics"
          />
        </g>

        <g
          v-if="showVolumePane"
          class="narduk-axis"
        >
          <line
            :x1="padding.left"
            :y1="volumeTop"
            :x2="chartWidth - padding.right"
            :y2="volumeTop"
          />
        </g>

        <g class="narduk-axis">
          <line
            :x1="padding.left"
            :y1="padding.top"
            :x2="padding.left"
            :y2="padding.top + priceInnerHeight"
          />
          <text
            v-for="(t, ti) in ticksForDisplay"
            :key="'py-' + ti"
            :x="padding.left - 8"
            :y="padding.top + priceInnerHeight - yMap.yFromBottom(t.value)"
            text-anchor="end"
            dominant-baseline="middle"
          >
            {{ t.label }}
          </text>
        </g>

        <g class="narduk-axis">
          <line
            :x1="padding.left"
            :y1="padding.top + plotHeight"
            :x2="chartWidth - padding.right"
            :y2="padding.top + plotHeight"
          />
          <text
            v-for="i in xAxisLabelIndices"
            :key="'xl-' + i"
            :x="xPos(i)"
            :y="padding.top + plotHeight + 18"
            text-anchor="middle"
            dominant-baseline="hanging"
          >
            {{ formatTimeLabel(sortedBars[i].t) }}
          </text>
        </g>

        <g
          v-if="showBrush"
          class="narduk-candle-brush"
        >
          <rect
            :x="padding.left"
            :y="brushTop"
            :width="plotWidth"
            :height="brushH"
            class="narduk-candle-brush__track"
            stroke="var(--color-chart-axis)"
            stroke-width="1"
            @pointerdown="onBrushPointerDown"
            @pointermove="onBrushPointerMove"
            @pointerup="onBrushPointerUp"
            @pointercancel="onBrushPointerUp"
          />
          <path
            :d="minimapPath"
            fill="none"
            stroke="var(--color-chart-muted)"
            stroke-width="1"
            opacity="0.75"
            pointer-events="none"
          />
          <rect
            v-if="brushWindowRect"
            :x="brushWindowRect.x"
            :y="brushTop + 2"
            :width="brushWindowRect.w"
            :height="brushH - 4"
            class="narduk-candle-brush__window"
            pointer-events="none"
          />
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

      <ChartTooltip
        v-if="!isEmpty && !showOhlcHud"
        v-bind="tooltip"
        :chart-width="chartWidth"
      />
    </div>
  </figure>
</template>
