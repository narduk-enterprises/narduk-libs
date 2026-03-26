<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
/**
 * Import processed CSS (Tailwind directives expanded by Vite) so the string
 * injected into exported SVGs is browser-valid CSS without any @apply/@layer.
 */
import chartStylesRaw from '../src/styles/chart.css?inline'
import {
  NardukLineChart,
  NardukBarChart,
  NardukPieChart,
  exportChartPng,
  exportChartSvg,
  getChartSvgElement,
  useStreamingSeries,
  chartThemeClass,
  type ChartSeries,
  type ChartTheme,
  type ChartYScaleMode,
  type ChartYBand,
  type ChartLineAnnotation,
  type PieDataItem,
  type ChartReferenceLine,
} from 'narduk-charts'

type TabId = 'line' | 'bar' | 'pie' | 'wind'
type WindUnit = 'mph' | 'knots' | 'ms'

const tabs: { id: TabId; label: string }[] = [
  { id: 'line', label: 'Line' },
  { id: 'bar', label: 'Bar' },
  { id: 'pie', label: 'Pie' },
  { id: 'wind', label: 'Wind' },
]

const activeTab = ref<TabId>('line')
const forceDark = ref(false)
const lastEvent = ref<string | null>(null)

const lineChartWrapRef = ref<HTMLElement | null>(null)
const barChartWrapRef = ref<HTMLElement | null>(null)
const pieChartWrapRef = ref<HTMLElement | null>(null)
const windChartWrapRef = ref<HTMLElement | null>(null)

function activeChartRoot(): HTMLElement | null {
  switch (activeTab.value) {
    case 'line':
      return lineChartWrapRef.value
    case 'bar':
      return barChartWrapRef.value
    case 'pie':
      return pieChartWrapRef.value
    case 'wind':
      return windChartWrapRef.value
    default:
      return null
  }
}

function exportActiveSvg() {
  const svg = getChartSvgElement(activeChartRoot())
  const name = `${activeTab.value}-chart.svg`
  exportChartSvg(svg, { filename: name, embeddedCss: chartStylesRaw })
  if (!svg) lastEvent.value = 'export SVG — no chart in view (try another tab or wait for wind data)'
  else lastEvent.value = `exported ${name}`
}

async function exportActivePng() {
  const svg = getChartSvgElement(activeChartRoot())
  if (!svg) {
    lastEvent.value = 'export PNG — no chart in view (try another tab or wait for wind data)'
    return
  }
  const name = `${activeTab.value}-chart.png`
  try {
    await exportChartPng(svg, { filename: name, scale: 2, embeddedCss: chartStylesRaw })
    lastEvent.value = `exported ${name}`
  } catch (e) {
    lastEvent.value = `export PNG failed: ${e instanceof Error ? e.message : String(e)}`
  }
}

function log(kind: string, detail: unknown) {
  lastEvent.value = `${kind} ${JSON.stringify(detail)}`
}

/** Applied to every chart; pairs with chart.css theme modifiers. */
const chartTheme = ref<ChartTheme>('default')

/** Slot / empty-state demos (same toggles for all tabs). */
const demoCustomTooltip = ref(false)
const demoCustomLegend = ref(false)
const demoCustomEmpty = ref(false)
const demoForceEmpty = ref(false)

// ── Shared sample data ──────────────────────────────────────

const monthLabels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const revenueSeries: ChartSeries[] = [
  { name: 'Revenue', data: [12, 19, 15, 25, 22, 30, 28, 35, 32, 40, 38, 45] },
  { name: 'Costs', data: [8, 10, 9, 12, 11, 14, 13, 16, 15, 18, 17, 20] },
]

const trendSeries: ChartSeries[] = [
  { name: 'North', data: [2, 5, 3, 8, 6, 9] },
  { name: 'South', data: [4, 3, 6, 5, 7, 8] },
]

const gapLineSeries: ChartSeries[] = [
  { name: 'Uptime %', data: [99.2, 99.5, null, null, 98.1, 99.0, 99.6] },
]

const weekLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const barSeries: ChartSeries[] = [
  { name: 'Desktop', data: [44, 55, 41, 67, 22, 43] },
  { name: 'Mobile', data: [53, 32, 33, 52, 13, 44] },
  { name: 'Tablet', data: [12, 17, 11, 9, 15, 21] },
]

const stackedBarSeries: ChartSeries[] = [
  { name: 'Alpha', data: [20, 25, 18, 30] },
  { name: 'Beta', data: [15, 20, 22, 18] },
  { name: 'Gamma', data: [10, 12, 15, 14] },
]

const quarterLabels = ['Q1', 'Q2', 'Q3', 'Q4']
const dayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const palette = ['#6366f1', '#14b8a6', '#f59e0b', '#ec4899', '#8b5cf6']

const pieTraffic: PieDataItem[] = [
  { label: 'Direct', value: 35 },
  { label: 'Organic', value: 28 },
  { label: 'Referral', value: 22 },
  { label: 'Social', value: 15 },
]

const pieBudget: PieDataItem[] = [
  { label: 'Engineering', value: 42, color: '#3b82f6' },
  { label: 'Marketing', value: 24, color: '#a855f7' },
  { label: 'Ops', value: 18, color: '#22c55e' },
  { label: 'G&A', value: 16, color: '#f97316' },
]

const pieBrowsers: PieDataItem[] = [
  { label: 'Chrome', value: 48 },
  { label: 'Safari', value: 22 },
  { label: 'Edge', value: 14 },
  { label: 'Firefox', value: 9 },
  { label: 'Other', value: 7 },
]

const pieStorage: PieDataItem[] = [
  { label: 'Photos', value: 38, color: '#ec4899' },
  { label: 'Video', value: 28, color: '#8b5cf6' },
  { label: 'Apps', value: 18, color: '#06b6d4' },
  { label: 'System', value: 10, color: '#64748b' },
  { label: 'Free', value: 6, color: '#22c55e' },
]

const pieTickets: PieDataItem[] = [
  { label: 'Open', value: 34 },
  { label: 'In progress', value: 28 },
  { label: 'Waiting', value: 18 },
  { label: 'Resolved', value: 156 },
]

const pieRetail: PieDataItem[] = [
  { label: 'In-store', value: 44, color: '#059669' },
  { label: 'Web', value: 31, color: '#2563eb' },
  { label: 'Mobile app', value: 18, color: '#d97706' },
  { label: 'Partner', value: 7, color: '#7c3aed' },
]

// ── Line chart dataset catalog ──────────────────────────────

type LineDatasetId =
  | 'dual'
  | 'gaps'
  | 'trend'
  | 'temp'
  | 'latency'
  | 'energy'
  | 'subscriptions'
  | 'logVolume'

interface LinePack {
  series: ChartSeries[]
  labels: string[]
}

const lineTemperatureSeries: ChartSeries[] = [
  { name: 'High °F', data: [38, 41, 45, 52, 61, 70, 75, 73, 67, 55, 47, 40] },
  { name: 'Low °F', data: [26, 28, 32, 40, 48, 58, 63, 62, 55, 44, 36, 29] },
]

const lineLatencySeries: ChartSeries[] = [
  { name: 'p50 (ms)', data: [42, 38, 41, 45, 40, 44, 39] },
  { name: 'p95 (ms)', data: [120, 98, 110, 135, 105, 112, 88] },
  { name: 'p99 (ms)', data: [240, 210, 260, 310, 195, 225, 180] },
]

const lineEnergySeries: ChartSeries[] = [
  { name: 'Solar MWh', data: [0, 0, 4, 28, 52, 68, 72, 65, 40, 12, 0, 0] },
  { name: 'Wind MWh', data: [22, 28, 35, 30, 25, 18, 15, 20, 38, 45, 40, 32] },
]

const lineSubscriptionsSeries: ChartSeries[] = [
  { name: 'New', data: [120, 132, 128, 145, 160, 178, 195, 210, 198, 215, 230, 248] },
  { name: 'Churned', data: [22, 24, 21, 26, 28, 30, 32, 35, 31, 33, 36, 38] },
]

const lineLogVolumeSeries: ChartSeries[] = [
  { name: 'Requests', data: [12, 40, 900, 85, 2000, 120, 45] },
]
const lineLogVolumeLabels = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7']

const lineDualWeatherPack: LinePack = {
  series: [
    { name: 'Temp °C', data: [16, 18, 21, 19, 23, 26, 24, 22], yAxis: 'primary' },
    { name: 'Humidity %', data: [72, 68, 62, 65, 58, 52, 55, 60], yAxis: 'secondary' },
  ],
  labels: ['D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8'],
}

const lineDatasets: Record<LineDatasetId, LinePack> = {
  dual: { series: revenueSeries, labels: monthLabels },
  gaps: { series: gapLineSeries, labels: weekLabels },
  trend: { series: trendSeries, labels: ['M1', 'M2', 'M3', 'M4', 'M5', 'M6'] },
  temp: { series: lineTemperatureSeries, labels: monthLabels },
  latency: { series: lineLatencySeries, labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] },
  energy: { series: lineEnergySeries, labels: monthLabels },
  subscriptions: { series: lineSubscriptionsSeries, labels: monthLabels },
  logVolume: { series: lineLogVolumeSeries, labels: lineLogVolumeLabels },
}

// ── Bar chart dataset catalog ───────────────────────────────

type BarGroupedId = 'devices' | 'regions' | 'scores'
type BarStackedId = 'products' | 'channels' | 'runtime'

const barRegionsSeries: ChartSeries[] = [
  { name: 'Americas', data: [120, 132, 101, 142, 98, 110] },
  { name: 'EMEA', data: [80, 94, 77, 88, 72, 85] },
  { name: 'APAC', data: [55, 62, 58, 71, 64, 69] },
]

const barScoresSeries: ChartSeries[] = [
  { name: 'Math', data: [72, 78, 81, 75] },
  { name: 'Reading', data: [85, 82, 88, 90] },
]

const barWeekLabels6 = ['W1', 'W2', 'W3', 'W4', 'W5', 'W6']

const barGroupedDatasets: Record<BarGroupedId, LinePack> = {
  devices: { series: barSeries, labels: dayLabels },
  regions: { series: barRegionsSeries, labels: barWeekLabels6 },
  scores: { series: barScoresSeries, labels: ['Q1', 'Q2', 'Q3', 'Q4'] },
}

const barChannelsStacked: ChartSeries[] = [
  { name: 'Email', data: [35, 28, 31, 42] },
  { name: 'SMS', data: [12, 18, 15, 14] },
  { name: 'Push', data: [8, 11, 9, 13] },
]

const barRuntimeStacked: ChartSeries[] = [
  { name: 'Sleep', data: [7.2, 7.5, 6.8, 7.1] },
  { name: 'Work', data: [8.5, 8.2, 9.0, 7.5] },
  { name: 'Other', data: [8.3, 8.3, 8.2, 9.4] },
]

const barStackedDatasets: Record<BarStackedId, LinePack> = {
  products: { series: stackedBarSeries, labels: quarterLabels },
  channels: { series: barChannelsStacked, labels: ['Jan', 'Feb', 'Mar', 'Apr'] },
  runtime: { series: barRuntimeStacked, labels: ['Mon', 'Tue', 'Wed', 'Thu'] },
}

// ── Pie dataset catalog ─────────────────────────────────────

type PieDatasetId = 'traffic' | 'budget' | 'browsers' | 'storage' | 'tickets' | 'retail'

const pieDatasets: Record<PieDatasetId, PieDataItem[]> = {
  traffic: pieTraffic,
  budget: pieBudget,
  browsers: pieBrowsers,
  storage: pieStorage,
  tickets: pieTickets,
  retail: pieRetail,
}

// ── Line controls ───────────────────────────────────────────

const lineDataset = ref<LineDatasetId>('dual')
const lineDualYAxis = ref(false)
const lineYScaleChoice = ref<ChartYScaleMode>('linear')
const lineYScaleSecondary = ref<ChartYScaleMode>('linear')
const lineShowBands = ref(false)
const lineShowAnnotations = ref(false)
const lineSmooth = ref(true)
const lineShowGrid = ref(true)
const lineShowPoints = ref(false)
const lineShowArea = ref(false)
const lineAnimate = ref(true)
const lineRespectRm = ref(true)
const lineZoomable = ref(false)
const lineZoomAutoY = ref(true)
const lineRefGoal = ref(false)
const lineRefFloor = ref(false)
const lineUseCustomColors = ref(true)
const lineFixedWidth = ref(false)
const lineHeight = ref(440)

const lineSeriesAndLabels = computed(() => lineDatasets[lineDataset.value])

const lineSeriesForChart = computed(() => {
  if (demoForceEmpty.value) return []
  if (lineDualYAxis.value) return lineDualWeatherPack.series
  return lineSeriesAndLabels.value.series
})
const lineLabelsForChart = computed(() => {
  if (demoForceEmpty.value) return []
  if (lineDualYAxis.value) return lineDualWeatherPack.labels
  return lineSeriesAndLabels.value.labels
})

const lineYScaleEffective = computed<ChartYScaleMode>(() =>
  lineDataset.value === 'logVolume' ? 'log' : lineYScaleChoice.value,
)

const lineYBands = computed<ChartYBand[] | undefined>(() => {
  if (!lineShowBands.value || demoForceEmpty.value || lineDualYAxis.value) return undefined
  return [{ y0: 15, y1: 35, color: '#a855f7', opacity: 0.12 }]
})

const lineAnnotations = computed<ChartLineAnnotation[] | undefined>(() => {
  if (!lineShowAnnotations.value || demoForceEmpty.value || lineDualYAxis.value
    || lineDataset.value === 'logVolume') {
    return undefined
  }
  return [
    { type: 'vline', xIndex: 3, dashed: true, label: 'Q1' },
    { type: 'point', xIndex: 5, y: 38, color: '#ef4444', label: 'Peak' },
    { type: 'label', xIndex: 1, y: 22, text: 'Note', dx: 6, dy: -10 },
  ]
})

const lineReferenceLines = computed<ChartReferenceLine[]>(() => {
  if (lineDualYAxis.value) return []
  const out: ChartReferenceLine[] = []
  if (lineRefGoal.value)
    out.push({ value: 35, label: 'Goal', color: '#ef4444', dashed: true })
  if (lineRefFloor.value)
    out.push({ value: 12, label: 'Floor', color: '#64748b', dashed: true })
  return out
})

// ── Bar controls ────────────────────────────────────────────

const barYScale = ref<ChartYScaleMode>('linear')
const barShowBands = ref(false)
const barShowVlines = ref(false)

const barStacked = ref(false)
const barGroupedId = ref<BarGroupedId>('devices')
const barStackedId = ref<BarStackedId>('products')
const barAnimate = ref(true)
const barRespectRm = ref(true)
const barShowRef = ref(true)
const barRadius = ref(6)
const barHeight = ref(440)
const barCustomColors = ref(false)

const barSeriesAndLabels = computed(() =>
  barStacked.value ? barStackedDatasets[barStackedId.value] : barGroupedDatasets[barGroupedId.value],
)

const barSeriesForChart = computed(() =>
  demoForceEmpty.value ? [] : barSeriesAndLabels.value.series,
)
const barLabelsForChart = computed(() =>
  demoForceEmpty.value ? [] : barSeriesAndLabels.value.labels,
)

const barRefLines = computed<ChartReferenceLine[]>(() =>
  barShowRef.value
    ? [{ value: 50, label: 'Quota', color: '#f59e0b', dashed: true }]
    : [],
)

const barColors = computed(() => (barCustomColors.value ? palette : undefined))

const barYBands = computed<ChartYBand[] | undefined>(() => {
  if (!barShowBands.value || demoForceEmpty.value) return undefined
  return [{ y0: 40, y1: 95, color: '#0ea5e9', opacity: 0.14 }]
})

const barAnnotations = computed<ChartLineAnnotation[] | undefined>(() => {
  if (!barShowVlines.value || demoForceEmpty.value) return undefined
  return [{ type: 'vline', xIndex: 2, dashed: true, label: 'Launch' }]
})

// ── Pie controls ───────────────────────────────────────────

const pieDataset = ref<PieDatasetId>('traffic')
const pieDonut = ref(false)
const pieInnerRadius = ref(0.55)
const pieShowLabels = ref(true)
const pieAnimate = ref(true)
const pieRespectRm = ref(true)
const pieCustomPalette = ref(false)
const pieHeight = ref(480)

const pieData = computed(() => pieDatasets[pieDataset.value])

const pieDataForChart = computed(() => (demoForceEmpty.value ? [] : pieData.value))

const pieColors = computed(() => (pieCustomPalette.value ? palette : undefined))

// ── Live wind (simulated anemometer) ─────────────────────────

const WIND_WINDOW = 52
/** Rolling mph buffer via library composable (see Live wind tab). */
const windStream = useStreamingSeries(WIND_WINDOW)

type WindScenarioId = 'default' | 'calm' | 'breezy' | 'front'

interface WindScenarioParams {
  baseMin: number
  baseSpan: number
  seedJitter: number
  gustP: number
  gustBias: number
  gustAmp: number
  clampMin: number
  clampMax: number
  stepJitter: number
}

const windScenarioParams: Record<WindScenarioId, WindScenarioParams> = {
  default: {
    baseMin: 9,
    baseSpan: 7,
    seedJitter: 2.4,
    gustP: 0.14,
    gustBias: -0.35,
    gustAmp: 7,
    clampMin: 2.5,
    clampMax: 42,
    stepJitter: 3.8,
  },
  calm: {
    baseMin: 4,
    baseSpan: 3,
    seedJitter: 1,
    gustP: 0.05,
    gustBias: -0.15,
    gustAmp: 2.5,
    clampMin: 1,
    clampMax: 16,
    stepJitter: 1.6,
  },
  breezy: {
    baseMin: 14,
    baseSpan: 8,
    seedJitter: 3.5,
    gustP: 0.22,
    gustBias: -0.35,
    gustAmp: 10,
    clampMin: 5,
    clampMax: 48,
    stepJitter: 4.5,
  },
  front: {
    baseMin: 6,
    baseSpan: 14,
    seedJitter: 4,
    gustP: 0.3,
    gustBias: -0.15,
    gustAmp: 14,
    clampMin: 2,
    clampMax: 55,
    stepJitter: 5.5,
  },
}

const windScenario = ref<WindScenarioId>('default')

const windUnit = ref<WindUnit>('mph')
const windPaused = ref(false)
const windIntervalMs = ref(1000)
const windShowGrid = ref(true)
const windSmooth = ref(true)
const windShowArea = ref(true)
const windAdvisory = ref(true)
/** Horizontal guides: mean of plotted buffer vs mean of last N samples (display units). */
const windShowWindowMean = ref(true)
const windShowRecentMean = ref(true)
const WIND_RECENT_MEAN_SAMPLES = 15
const windHeight = ref(440)
const windZoomable = ref(true)
const windZoomAutoY = ref(true)
/** Lerp displayed samples toward raw stream each frame (rolling-chart “mass”). */
const windEaseMotion = ref(false)
/** 1 = very smooth / slow follow, 100 = snappy */
const windEaseResponsiveness = ref(22)

const windEaseAlpha = computed(
  () => 0.04 + (windEaseResponsiveness.value / 100) * 0.32,
)

const windRenderMph = ref<number[]>([])

const windChartMph = computed(() => {
  const raw = windStream.values.value
  if (
    windEaseMotion.value
    && windRenderMph.value.length === raw.length
    && raw.length > 0
  ) {
    return windRenderMph.value
  }
  return raw
})

function mphToDisplay(mph: number, unit: WindUnit): number {
  if (unit === 'knots') return mph / 1.15077944802
  if (unit === 'ms') return mph * 0.44704
  return mph
}

const windUnitShort = computed(() =>
  windUnit.value === 'mph' ? 'mph' : windUnit.value === 'knots' ? 'kt' : 'm/s',
)

function seedWind() {
  const p = windScenarioParams[windScenario.value]
  let v = p.baseMin + Math.random() * p.baseSpan
  const next: number[] = []
  for (let i = 0; i < WIND_WINDOW; i++) {
    v = Math.max(
      p.clampMin,
      Math.min(p.clampMax, v + (Math.random() - 0.5) * p.seedJitter),
    )
    next.push(v)
  }
  windStream.setWindow(next)
  windRenderMph.value = next.slice()
}

function stepWind() {
  const p = windScenarioParams[windScenario.value]
  const prev = windStream.values.value
  if (prev.length === 0) return
  const tail = prev.slice(1)
  let last = tail[tail.length - 1]!
  const gust = Math.random() < p.gustP
    ? (Math.random() + p.gustBias) * p.gustAmp
    : 0
  last = Math.max(
    0.5,
    Math.min(p.clampMax + 4, last + (Math.random() - 0.5) * p.stepJitter + gust),
  )
  tail.push(last)
  windStream.setWindow(tail)
}

function clearWindBuffer() {
  windStream.clear()
  windRenderMph.value = []
}

const windLabels = computed(() => {
  const raw = windStream.values.value
  return raw.map((_, i) => `${raw.length - 1 - i}s`)
})

const windSeries = computed<ChartSeries[]>(() => {
  const raw = windStream.values.value
  if (raw.length === 0) return []
  const u = windUnit.value
  return [{
    name: `Wind speed (${windUnitShort.value})`,
    data: windChartMph.value.map(m => mphToDisplay(m, u)),
  }]
})

const windMeanDisplay = computed(() => {
  const mph = windChartMph.value
  if (!mph.length) return null
  const u = windUnit.value
  const sum = mph.reduce((acc, m) => acc + mphToDisplay(m, u), 0)
  return sum / mph.length
})

const windRecentMeanDisplay = computed(() => {
  const mph = windChartMph.value
  if (!mph.length) return null
  const u = windUnit.value
  const n = Math.min(WIND_RECENT_MEAN_SAMPLES, mph.length)
  const slice = mph.slice(-n)
  const sum = slice.reduce((acc, m) => acc + mphToDisplay(m, u), 0)
  return sum / n
})

const windReferenceLines = computed<ChartReferenceLine[] | undefined>(() => {
  const out: ChartReferenceLine[] = []
  const u = windUnit.value
  if (windAdvisory.value) {
    out.push({
      value: mphToDisplay(25, u),
      label: 'Advisory 25 mph',
      color: '#f59e0b',
      dashed: true,
    })
  }
  if (windShowWindowMean.value && windMeanDisplay.value != null) {
    out.push({
      value: windMeanDisplay.value,
      label: `Window mean (${windUnitShort.value})`,
      color: '#a855f7',
      dashed: true,
    })
  }
  if (windShowRecentMean.value && windRecentMeanDisplay.value != null) {
    const n = Math.min(WIND_RECENT_MEAN_SAMPLES, windChartMph.value.length)
    out.push({
      value: windRecentMeanDisplay.value,
      label: `Last ${n} avg (${windUnitShort.value})`,
      color: '#22c55e',
      dashed: true,
    })
  }
  return out.length ? out : undefined
})

const windNowMph = computed(() => {
  const a = windChartMph.value
  return a.length ? a[a.length - 1]! : 0
})

const windNowDisplay = computed(() => mphToDisplay(windNowMph.value, windUnit.value))

const windColors = ['#0ea5e9']

let windTimer: ReturnType<typeof setInterval> | null = null
let windEaseRaf: number = 0

function windEaseFrame() {
  if (activeTab.value === 'wind' && windEaseMotion.value && windStream.values.value.length > 0) {
    const tgt = windStream.values.value
    const prev = windRenderMph.value
    const a = windEaseAlpha.value
    if (prev.length !== tgt.length) {
      windRenderMph.value = tgt.slice()
    } else {
      windRenderMph.value = prev.map((v, i) => v + (tgt[i]! - v) * a)
    }
  }
  if (activeTab.value === 'wind' && windEaseMotion.value) {
    windEaseRaf = requestAnimationFrame(windEaseFrame)
  } else {
    windEaseRaf = 0
  }
}

function syncWindEaseRaf() {
  if (windEaseRaf) {
    cancelAnimationFrame(windEaseRaf)
    windEaseRaf = 0
  }
  if (activeTab.value === 'wind' && windEaseMotion.value) {
    const raw = windStream.values.value
    if (windRenderMph.value.length !== raw.length || windRenderMph.value.length === 0) {
      windRenderMph.value = raw.length ? raw.slice() : []
    }
    windEaseRaf = requestAnimationFrame(windEaseFrame)
  }
}

watch(
  windStream.values,
  (next) => {
    if (!windEaseMotion.value || next.length === 0) return
    if (windRenderMph.value.length !== next.length) {
      windRenderMph.value = next.slice()
    }
  },
  { deep: true },
)

watch(
  () => [activeTab.value, windEaseMotion.value] as const,
  () => syncWindEaseRaf(),
  { immediate: true },
)

function syncWindTimer() {
  if (windTimer) {
    clearInterval(windTimer)
    windTimer = null
  }
  if (activeTab.value !== 'wind' || windPaused.value) return
  if (windStream.values.value.length === 0) seedWind()
  windTimer = setInterval(stepWind, windIntervalMs.value)
}

watch(
  () => [activeTab.value, windPaused.value, windIntervalMs.value] as const,
  () => syncWindTimer(),
  { immediate: true },
)

watch(windScenario, () => {
  if (activeTab.value === 'wind' && windStream.values.value.length > 0) seedWind()
})

onUnmounted(() => {
  if (windTimer) clearInterval(windTimer)
  if (windEaseRaf) cancelAnimationFrame(windEaseRaf)
})
</script>

<template>
  <div
    class="lab"
    :class="{ 'lab--dark': forceDark }"
  >
    <header class="lab__top">
      <div class="lab__brand">
        <h1 class="lab__title">
          Narduk Charts
        </h1>
        <p class="lab__tag">
          Playground — one chart per mode, tune props live.
        </p>
      </div>
      <div class="lab__top-actions">
        <div
          class="lab__export"
          role="group"
          aria-label="Export visible chart"
        >
          <button
            type="button"
            class="lab__btn lab__btn--toolbar"
            @click="exportActiveSvg"
          >
            Export SVG
          </button>
          <button
            type="button"
            class="lab__btn lab__btn--toolbar"
            @click="exportActivePng"
          >
            Export PNG
          </button>
        </div>
        <label class="lab__switch">
          <input
            v-model="forceDark"
            type="checkbox"
            class="lab__switch-input"
          >
          <span class="lab__switch-track" aria-hidden="true" />
          <span class="lab__switch-label">Dark UI</span>
        </label>
      </div>
    </header>

    <nav
      class="lab__tabs"
      role="tablist"
      aria-label="Chart type"
    >
      <button
        v-for="t in tabs"
        :key="t.id"
        type="button"
        role="tab"
        class="lab__tab"
        :class="{ 'lab__tab--active': activeTab === t.id }"
        :aria-selected="activeTab === t.id"
        @click="activeTab = t.id"
      >
        {{ t.label }}
      </button>
    </nav>

    <div
      class="lab__feature-bar"
      role="region"
      aria-label="Theme and slot demos"
    >
      <label class="lab__field lab__field--bar">
        <span class="lab__field-label">Chart theme</span>
        <select
          v-model="chartTheme"
          class="lab__select lab__select--bar"
        >
          <option value="default">
            Default
          </option>
          <option value="high-contrast">
            High contrast
          </option>
          <option value="print">
            Print
          </option>
          <option value="colorblind-safe">
            Colorblind-safe
          </option>
        </select>
      </label>
      <span
        class="lab__theme-class"
        title="CSS class from chartThemeClass()"
      >{{ chartThemeClass(chartTheme) || 'root: .narduk-chart' }}</span>
      <label class="lab__chip">
        <input
          v-model="demoCustomTooltip"
          type="checkbox"
          class="lab__chip-input"
        >
        <span>Custom tooltip slot</span>
      </label>
      <label class="lab__chip">
        <input
          v-model="demoCustomLegend"
          type="checkbox"
          class="lab__chip-input"
        >
        <span>Custom legend slot</span>
      </label>
      <label class="lab__chip">
        <input
          v-model="demoCustomEmpty"
          type="checkbox"
          class="lab__chip-input"
        >
        <span>Custom empty slot</span>
      </label>
      <label class="lab__chip">
        <input
          v-model="demoForceEmpty"
          type="checkbox"
          class="lab__chip-input"
        >
        <span>Force empty data (Line / Bar / Pie)</span>
      </label>
    </div>

    <div class="lab__body">
      <!-- Line -->
      <div
        v-show="activeTab === 'line'"
        class="lab__panel"
        role="tabpanel"
      >
        <aside class="lab__dock">
          <h2 class="lab__dock-title">
            Line chart
          </h2>

          <section class="lab__group">
            <h3 class="lab__group-title">
              Dataset
            </h3>
            <label class="lab__field">
              <span class="lab__field-label">Series</span>
              <select
                v-model="lineDataset"
                class="lab__select"
              >
                <option value="dual">
                  Finance — revenue &amp; costs (12 mo)
                </option>
                <option value="subscriptions">
                  SaaS — new vs churned
                </option>
                <option value="temp">
                  Weather — high &amp; low °F by month
                </option>
                <option value="energy">
                  Grid — solar &amp; wind MWh
                </option>
                <option value="latency">
                  API — p50 / p95 / p99 latency
                </option>
                <option value="gaps">
                  Ops — uptime % with gaps
                </option>
                <option value="trend">
                  Sales — two regions (6 mo)
                </option>
                <option value="logVolume">
                  Traffic — wide dynamic range (log Y)
                </option>
              </select>
            </label>
          </section>

          <section class="lab__group">
            <h3 class="lab__group-title">
              Phase 2 — scales &amp; marks
            </h3>
            <label class="lab__row">
              <span>Dual Y-axis (temp + humidity)</span>
              <input
                v-model="lineDualYAxis"
                type="checkbox"
                class="lab__toggle"
              >
            </label>
            <label class="lab__field">
              <span class="lab__field-label">Y scale (primary / single)</span>
              <select
                v-model="lineYScaleChoice"
                class="lab__select"
                :disabled="lineDataset === 'logVolume'"
              >
                <option value="linear">
                  Linear
                </option>
                <option value="log">
                  Log
                </option>
                <option value="symlog">
                  Symlog
                </option>
              </select>
            </label>
            <label
              class="lab__field"
              :class="{ 'lab__dial--disabled': !lineDualYAxis }"
            >
              <span class="lab__field-label">Y scale (secondary)</span>
              <select
                v-model="lineYScaleSecondary"
                class="lab__select"
                :disabled="!lineDualYAxis"
              >
                <option value="linear">
                  Linear
                </option>
                <option value="log">
                  Log
                </option>
                <option value="symlog">
                  Symlog
                </option>
              </select>
            </label>
            <label class="lab__row">
              <span>Y-band overlay (15–35)</span>
              <input
                v-model="lineShowBands"
                type="checkbox"
                class="lab__toggle"
              >
            </label>
            <label class="lab__row">
              <span>Annotations (vline + point + label)</span>
              <input
                v-model="lineShowAnnotations"
                type="checkbox"
                class="lab__toggle"
              >
            </label>
          </section>

          <section class="lab__group">
            <h3 class="lab__group-title">
              Display
            </h3>
            <label class="lab__row">
              <span>Smooth curves</span>
              <input
                v-model="lineSmooth"
                type="checkbox"
                class="lab__toggle"
              >
            </label>
            <label class="lab__row">
              <span>Grid</span>
              <input
                v-model="lineShowGrid"
                type="checkbox"
                class="lab__toggle"
              >
            </label>
            <label class="lab__row">
              <span>Data points</span>
              <input
                v-model="lineShowPoints"
                type="checkbox"
                class="lab__toggle"
              >
            </label>
            <label class="lab__row">
              <span>Area fill</span>
              <input
                v-model="lineShowArea"
                type="checkbox"
                class="lab__toggle"
              >
            </label>
            <label class="lab__row">
              <span>Custom colors</span>
              <input
                v-model="lineUseCustomColors"
                type="checkbox"
                class="lab__toggle"
              >
            </label>
            <label class="lab__row">
              <span>Fixed width (narrow)</span>
              <input
                v-model="lineFixedWidth"
                type="checkbox"
                class="lab__toggle"
              >
            </label>
          </section>

          <section class="lab__group">
            <h3 class="lab__group-title">
              Reference lines
            </h3>
            <label class="lab__row">
              <span>Goal @ 35</span>
              <input
                v-model="lineRefGoal"
                type="checkbox"
                class="lab__toggle"
              >
            </label>
            <label class="lab__row">
              <span>Floor @ 12</span>
              <input
                v-model="lineRefFloor"
                type="checkbox"
                class="lab__toggle"
              >
            </label>
          </section>

          <section class="lab__group">
            <h3 class="lab__group-title">
              Motion
            </h3>
            <label class="lab__row">
              <span>Animate draw</span>
              <input
                v-model="lineAnimate"
                type="checkbox"
                class="lab__toggle"
              >
            </label>
            <label class="lab__row">
              <span>Respect reduced motion</span>
              <input
                v-model="lineRespectRm"
                type="checkbox"
                class="lab__toggle"
              >
            </label>
            <label class="lab__row">
              <span>Zoom (drag box, ⌃/⌘ wheel, ⇧ pan, dbl-click reset)</span>
              <input
                v-model="lineZoomable"
                type="checkbox"
                class="lab__toggle"
              >
            </label>
            <label class="lab__row">
              <span>Zoom: auto Y from visible window</span>
              <input
                v-model="lineZoomAutoY"
                type="checkbox"
                class="lab__toggle"
                :disabled="!lineZoomable"
              >
            </label>
          </section>

          <section class="lab__group">
            <h3 class="lab__group-title">
              Size
            </h3>
            <label class="lab__dial">
              <div class="lab__dial-top">
                <span class="lab__dial-label">Height (px)</span>
                <output class="lab__dial-value">{{ lineHeight }}</output>
              </div>
              <input
                v-model.number="lineHeight"
                type="range"
                min="320"
                max="640"
                step="20"
                class="lab__range"
              >
            </label>
          </section>
        </aside>

        <div class="lab__stage">
          <div
            ref="lineChartWrapRef"
            class="lab__chart-wrap"
          >
            <NardukLineChart
              :series="lineSeriesForChart"
              :labels="lineLabelsForChart"
              :height="lineHeight"
              :width="lineFixedWidth ? 520 : undefined"
              :smooth="lineSmooth"
              :show-grid="lineShowGrid"
              :show-points="lineShowPoints"
              :show-area="lineShowArea"
              :animate="lineAnimate"
              :respect-reduced-motion="lineRespectRm"
              :reference-lines="lineReferenceLines.length ? lineReferenceLines : undefined"
              :colors="lineUseCustomColors ? palette : undefined"
              :dark="forceDark"
              :theme="chartTheme"
              :dual-y-axis="lineDualYAxis"
              :y-scale="lineYScaleEffective"
              :y-scale-secondary="lineYScaleSecondary"
              :y-bands="lineYBands"
              :annotations="lineAnnotations"
              :zoomable="lineZoomable"
              :zoom-auto-y="lineZoomAutoY"
              class="lab__chart"
              @point-click="log('pointClick', $event)"
              @zoom="log('zoom', $event)"
            >
              <template
                v-if="demoCustomTooltip"
                #tooltip="{ title, items, visible }"
              >
                <div
                  class="lab__slot-tooltip"
                  :class="{ 'lab__slot-tooltip--hidden': !visible }"
                >
                  <div class="lab__slot-tooltip-title">
                    {{ title }}
                  </div>
                  <ul class="lab__slot-tooltip-list">
                    <li
                      v-for="it in items"
                      :key="it.label"
                      class="lab__slot-tooltip-row"
                    >
                      <span
                        class="lab__slot-tooltip-dot"
                        :style="{ background: it.color }"
                      />
                      <span class="lab__slot-tooltip-name">{{ it.label }}</span>
                      <span class="lab__slot-tooltip-val">{{ it.value }}</span>
                    </li>
                  </ul>
                </div>
              </template>
              <template
                v-if="demoCustomLegend"
                #legend-item="{ item, toggle }"
              >
                <button
                  type="button"
                  class="lab__slot-legend"
                  :class="{ 'lab__slot-legend--muted': item.hidden }"
                  @click="toggle"
                >
                  <span
                    class="lab__slot-legend-swatch"
                    :style="{
                      backgroundColor: item.hidden ? 'transparent' : item.color,
                      borderColor: item.color,
                    }"
                  />
                  {{ item.name }}
                </button>
              </template>
              <template
                v-if="demoCustomEmpty"
                #empty
              >
                <div class="lab__slot-empty">
                  <p class="lab__slot-empty-title">
                    Nothing to plot
                  </p>
                  <p class="lab__slot-empty-hint">
                    Turn off “Force empty data” to restore the sample series.
                  </p>
                  <button
                    type="button"
                    class="lab__btn lab__btn--toolbar"
                    @click="demoForceEmpty = false"
                  >
                    Restore data
                  </button>
                </div>
              </template>
            </NardukLineChart>
          </div>
        </div>
      </div>

      <!-- Bar -->
      <div
        v-show="activeTab === 'bar'"
        class="lab__panel"
        role="tabpanel"
      >
        <aside class="lab__dock">
          <h2 class="lab__dock-title">
            Bar chart
          </h2>

          <section class="lab__group">
            <h3 class="lab__group-title">
              Layout
            </h3>
            <label class="lab__row">
              <span>Stacked</span>
              <input
                v-model="barStacked"
                type="checkbox"
                class="lab__toggle"
              >
            </label>
            <label class="lab__field">
              <span class="lab__field-label">Dataset</span>
              <select
                v-if="!barStacked"
                v-model="barGroupedId"
                class="lab__select"
              >
                <option value="devices">
                  Traffic — desktop / mobile / tablet
                </option>
                <option value="regions">
                  Revenue — Americas / EMEA / APAC
                </option>
                <option value="scores">
                  Education — math vs reading by quarter
                </option>
              </select>
              <select
                v-else
                v-model="barStackedId"
                class="lab__select"
              >
                <option value="products">
                  Mix — Alpha / Beta / Gamma by quarter
                </option>
                <option value="channels">
                  Comms — email / SMS / push by month
                </option>
                <option value="runtime">
                  Day — sleep / work / other (hours)
                </option>
              </select>
            </label>
            <label class="lab__row">
              <span>Reference line (quota)</span>
              <input
                v-model="barShowRef"
                type="checkbox"
                class="lab__toggle"
              >
            </label>
            <label class="lab__row">
              <span>Custom palette</span>
              <input
                v-model="barCustomColors"
                type="checkbox"
                class="lab__toggle"
              >
            </label>
          </section>

          <section class="lab__group">
            <h3 class="lab__group-title">
              Phase 2 — Y scale &amp; guides
            </h3>
            <label class="lab__field">
              <span class="lab__field-label">Y scale</span>
              <select
                v-model="barYScale"
                class="lab__select"
              >
                <option value="linear">
                  Linear
                </option>
                <option value="log">
                  Log
                </option>
                <option value="symlog">
                  Symlog
                </option>
              </select>
            </label>
            <label class="lab__row">
              <span>Y-band (40–95)</span>
              <input
                v-model="barShowBands"
                type="checkbox"
                class="lab__toggle"
              >
            </label>
            <label class="lab__row">
              <span>Vertical guide @ index 2</span>
              <input
                v-model="barShowVlines"
                type="checkbox"
                class="lab__toggle"
              >
            </label>
          </section>

          <section class="lab__group">
            <h3 class="lab__group-title">
              Motion
            </h3>
            <label class="lab__row">
              <span>Animate grow</span>
              <input
                v-model="barAnimate"
                type="checkbox"
                class="lab__toggle"
              >
            </label>
            <label class="lab__row">
              <span>Respect reduced motion</span>
              <input
                v-model="barRespectRm"
                type="checkbox"
                class="lab__toggle"
              >
            </label>
          </section>

          <section class="lab__group">
            <h3 class="lab__group-title">
              Shape
            </h3>
            <label class="lab__dial">
              <div class="lab__dial-top">
                <span class="lab__dial-label">Bar radius (px)</span>
                <output class="lab__dial-value">{{ barRadius }}</output>
              </div>
              <input
                v-model.number="barRadius"
                type="range"
                min="0"
                max="14"
                step="1"
                class="lab__range"
              >
            </label>
          </section>

          <section class="lab__group">
            <h3 class="lab__group-title">
              Size
            </h3>
            <label class="lab__dial">
              <div class="lab__dial-top">
                <span class="lab__dial-label">Height (px)</span>
                <output class="lab__dial-value">{{ barHeight }}</output>
              </div>
              <input
                v-model.number="barHeight"
                type="range"
                min="320"
                max="640"
                step="20"
                class="lab__range"
              >
            </label>
          </section>
        </aside>

        <div class="lab__stage">
          <div
            ref="barChartWrapRef"
            class="lab__chart-wrap"
          >
            <NardukBarChart
              :series="barSeriesForChart"
              :labels="barLabelsForChart"
              :height="barHeight"
              :stacked="barStacked"
              :bar-radius="barRadius"
              :animate="barAnimate"
              :respect-reduced-motion="barRespectRm"
              :reference-lines="barRefLines.length ? barRefLines : undefined"
              :colors="barColors"
              :dark="forceDark"
              :theme="chartTheme"
              :y-scale="barYScale"
              :y-bands="barYBands"
              :annotations="barAnnotations"
              class="lab__chart"
              @bar-click="log('barClick', $event)"
            >
              <template
                v-if="demoCustomTooltip"
                #tooltip="{ title, items, visible }"
              >
                <div
                  class="lab__slot-tooltip"
                  :class="{ 'lab__slot-tooltip--hidden': !visible }"
                >
                  <div class="lab__slot-tooltip-title">
                    {{ title }}
                  </div>
                  <ul class="lab__slot-tooltip-list">
                    <li
                      v-for="it in items"
                      :key="it.label"
                      class="lab__slot-tooltip-row"
                    >
                      <span
                        class="lab__slot-tooltip-dot"
                        :style="{ background: it.color }"
                      />
                      <span class="lab__slot-tooltip-name">{{ it.label }}</span>
                      <span class="lab__slot-tooltip-val">{{ it.value }}</span>
                    </li>
                  </ul>
                </div>
              </template>
              <template
                v-if="demoCustomLegend"
                #legend-item="{ item, toggle }"
              >
                <button
                  type="button"
                  class="lab__slot-legend"
                  :class="{ 'lab__slot-legend--muted': item.hidden }"
                  @click="toggle"
                >
                  <span
                    class="lab__slot-legend-swatch"
                    :style="{
                      backgroundColor: item.hidden ? 'transparent' : item.color,
                      borderColor: item.color,
                    }"
                  />
                  {{ item.name }}
                </button>
              </template>
              <template
                v-if="demoCustomEmpty"
                #empty
              >
                <div class="lab__slot-empty">
                  <p class="lab__slot-empty-title">
                    Nothing to plot
                  </p>
                  <p class="lab__slot-empty-hint">
                    Turn off “Force empty data” to restore the sample series.
                  </p>
                  <button
                    type="button"
                    class="lab__btn lab__btn--toolbar"
                    @click="demoForceEmpty = false"
                  >
                    Restore data
                  </button>
                </div>
              </template>
            </NardukBarChart>
          </div>
        </div>
      </div>

      <!-- Pie -->
      <div
        v-show="activeTab === 'pie'"
        class="lab__panel"
        role="tabpanel"
      >
        <aside class="lab__dock">
          <h2 class="lab__dock-title">
            Pie / donut
          </h2>

          <section class="lab__group">
            <h3 class="lab__group-title">
              Dataset
            </h3>
            <label class="lab__field">
              <span class="lab__field-label">Slices</span>
              <select
                v-model="pieDataset"
                class="lab__select"
              >
                <option value="traffic">
                  Marketing — channel mix
                </option>
                <option value="budget">
                  Company — budget by team (colors)
                </option>
                <option value="browsers">
                  Analytics — browser share
                </option>
                <option value="storage">
                  Device — storage use (colors)
                </option>
                <option value="tickets">
                  Support — ticket states
                </option>
                <option value="retail">
                  Retail — sales channel (colors)
                </option>
              </select>
            </label>
          </section>

          <section class="lab__group">
            <h3 class="lab__group-title">
              Style
            </h3>
            <label class="lab__row">
              <span>Donut</span>
              <input
                v-model="pieDonut"
                type="checkbox"
                class="lab__toggle"
              >
            </label>
            <label class="lab__row">
              <span>Slice labels</span>
              <input
                v-model="pieShowLabels"
                type="checkbox"
                class="lab__toggle"
              >
            </label>
            <label class="lab__row">
              <span>Override with palette</span>
              <input
                v-model="pieCustomPalette"
                type="checkbox"
                class="lab__toggle"
              >
            </label>
          </section>

          <section class="lab__group">
            <h3 class="lab__group-title">
              Donut hole
            </h3>
            <label
              class="lab__dial"
              :class="{ 'lab__dial--disabled': !pieDonut }"
            >
              <div class="lab__dial-top">
                <span class="lab__dial-label">Inner radius (0–1)</span>
                <output class="lab__dial-value">{{ pieInnerRadius.toFixed(2) }}</output>
              </div>
              <input
                v-model.number="pieInnerRadius"
                type="range"
                min="0.25"
                max="0.78"
                step="0.03"
                class="lab__range"
                :disabled="!pieDonut"
              >
            </label>
          </section>

          <section class="lab__group">
            <h3 class="lab__group-title">
              Motion
            </h3>
            <label class="lab__row">
              <span>Animate reveal</span>
              <input
                v-model="pieAnimate"
                type="checkbox"
                class="lab__toggle"
              >
            </label>
            <label class="lab__row">
              <span>Respect reduced motion</span>
              <input
                v-model="pieRespectRm"
                type="checkbox"
                class="lab__toggle"
              >
            </label>
          </section>

          <section class="lab__group">
            <h3 class="lab__group-title">
              Size
            </h3>
            <label class="lab__dial">
              <div class="lab__dial-top">
                <span class="lab__dial-label">Height (px)</span>
                <output class="lab__dial-value">{{ pieHeight }}</output>
              </div>
              <input
                v-model.number="pieHeight"
                type="range"
                min="360"
                max="640"
                step="20"
                class="lab__range"
              >
            </label>
          </section>
        </aside>

        <div class="lab__stage lab__stage--pie">
          <div
            ref="pieChartWrapRef"
            class="lab__chart-wrap lab__chart-wrap--pie"
          >
            <NardukPieChart
              :data="pieDataForChart"
              :height="pieHeight"
              :donut="pieDonut"
              :inner-radius="pieInnerRadius"
              :show-labels="pieShowLabels"
              :animate="pieAnimate"
              :respect-reduced-motion="pieRespectRm"
              :colors="pieColors"
              :dark="forceDark"
              :theme="chartTheme"
              class="lab__chart lab__chart--pie"
              @slice-click="log('sliceClick', $event)"
            >
              <template
                v-if="demoCustomTooltip"
                #tooltip="{ title, items, visible }"
              >
                <div
                  class="lab__slot-tooltip"
                  :class="{ 'lab__slot-tooltip--hidden': !visible }"
                >
                  <div class="lab__slot-tooltip-title">
                    {{ title }}
                  </div>
                  <ul class="lab__slot-tooltip-list">
                    <li
                      v-for="it in items"
                      :key="it.label"
                      class="lab__slot-tooltip-row"
                    >
                      <span
                        class="lab__slot-tooltip-dot"
                        :style="{ background: it.color }"
                      />
                      <span class="lab__slot-tooltip-name">{{ it.label }}</span>
                      <span class="lab__slot-tooltip-val">{{ it.value }}</span>
                    </li>
                  </ul>
                </div>
              </template>
              <template
                v-if="demoCustomLegend"
                #legend-item="{ item, toggle }"
              >
                <button
                  type="button"
                  class="lab__slot-legend"
                  :class="{ 'lab__slot-legend--muted': item.hidden }"
                  @click="toggle"
                >
                  <span
                    class="lab__slot-legend-swatch"
                    :style="{
                      backgroundColor: item.hidden ? 'transparent' : item.color,
                      borderColor: item.color,
                    }"
                  />
                  {{ item.name }}
                </button>
              </template>
              <template
                v-if="demoCustomEmpty"
                #empty
              >
                <div class="lab__slot-empty">
                  <p class="lab__slot-empty-title">
                    Nothing to plot
                  </p>
                  <p class="lab__slot-empty-hint">
                    Turn off “Force empty data” to restore the sample series.
                  </p>
                  <button
                    type="button"
                    class="lab__btn lab__btn--toolbar"
                    @click="demoForceEmpty = false"
                  >
                    Restore data
                  </button>
                </div>
              </template>
            </NardukPieChart>
          </div>
        </div>
      </div>

      <!-- Live wind -->
      <div
        v-show="activeTab === 'wind'"
        class="lab__panel"
        role="tabpanel"
      >
        <aside class="lab__dock">
          <h2 class="lab__dock-title">
            Live wind
          </h2>
          <p class="lab__wind-hint">
            Simulated anemometer stream (mph internally). Samples use <code class="lab__code">useStreamingSeries({{ WIND_WINDOW }})</code> — open this tab to start the clock; pause anytime.
          </p>

          <section class="lab__group">
            <h3 class="lab__group-title">
              Scenario
            </h3>
            <label class="lab__field">
              <span class="lab__field-label">Wind regime</span>
              <select
                v-model="windScenario"
                class="lab__select"
              >
                <option value="default">
                  Default — moderate gusts
                </option>
                <option value="calm">
                  Calm air — light &amp; steady
                </option>
                <option value="breezy">
                  Breezy — higher mean, more gusts
                </option>
                <option value="front">
                  Front — volatile, strong gusts
                </option>
              </select>
            </label>
          </section>

          <div
            class="lab__readout"
            aria-live="polite"
          >
            <span class="lab__readout-label">Now</span>
            <span class="lab__readout-value">{{ windNowDisplay.toFixed(1) }}</span>
            <span class="lab__readout-unit">{{ windUnitShort }}</span>
          </div>

          <section class="lab__group">
            <h3 class="lab__group-title">
              Units
            </h3>
            <label class="lab__field">
              <span class="lab__field-label">Display</span>
              <select
                v-model="windUnit"
                class="lab__select"
              >
                <option value="mph">
                  mph
                </option>
                <option value="knots">
                  Knots
                </option>
                <option value="ms">
                  m/s
                </option>
              </select>
            </label>
          </section>

          <section class="lab__group">
            <h3 class="lab__group-title">
              Stream
            </h3>
            <label class="lab__row">
              <span>Pause updates</span>
              <input
                v-model="windPaused"
                type="checkbox"
                class="lab__toggle"
              >
            </label>
            <label class="lab__field">
              <span class="lab__field-label">Sample interval</span>
              <select
                v-model.number="windIntervalMs"
                class="lab__select"
              >
                <option :value="500">
                  0.5 s
                </option>
                <option :value="1000">
                  1 s
                </option>
                <option :value="2000">
                  2 s
                </option>
              </select>
            </label>
            <button
              type="button"
              class="lab__btn"
              @click="seedWind()"
            >
              Reseed history
            </button>
            <button
              type="button"
              class="lab__btn"
              @click="clearWindBuffer()"
            >
              Clear buffer
            </button>
          </section>

          <section class="lab__group">
            <h3 class="lab__group-title">
              Live motion
            </h3>
            <p class="lab__wind-hint lab__wind-hint--tight">
              Ease samples toward the raw stream each frame so the trace and readout glide instead of stepping.
            </p>
            <label class="lab__row">
              <span>Ease motion</span>
              <input
                v-model="windEaseMotion"
                type="checkbox"
                class="lab__toggle"
              >
            </label>
            <label
              class="lab__dial"
              :class="{ 'lab__dial--disabled': !windEaseMotion }"
            >
              <div class="lab__dial-top">
                <span class="lab__dial-label">Responsiveness</span>
                <output class="lab__dial-value">{{ windEaseResponsiveness }}</output>
              </div>
              <input
                v-model.number="windEaseResponsiveness"
                type="range"
                min="4"
                max="92"
                step="2"
                class="lab__range"
                :disabled="!windEaseMotion"
              >
              <span class="lab__dial-hint">Lower = smoother · higher = tighter to raw</span>
            </label>
          </section>

          <section class="lab__group">
            <h3 class="lab__group-title">
              Chart
            </h3>
            <label class="lab__row">
              <span>Smooth curve</span>
              <input
                v-model="windSmooth"
                type="checkbox"
                class="lab__toggle"
              >
            </label>
            <label class="lab__row">
              <span>Grid</span>
              <input
                v-model="windShowGrid"
                type="checkbox"
                class="lab__toggle"
              >
            </label>
            <label class="lab__row">
              <span>Area fill</span>
              <input
                v-model="windShowArea"
                type="checkbox"
                class="lab__toggle"
              >
            </label>
            <label class="lab__row">
              <span>25 mph advisory line</span>
              <input
                v-model="windAdvisory"
                type="checkbox"
                class="lab__toggle"
              >
            </label>
            <label class="lab__row">
              <span>Window mean (full trace)</span>
              <input
                v-model="windShowWindowMean"
                type="checkbox"
                class="lab__toggle"
              >
            </label>
            <label class="lab__row">
              <span>Recent mean (last 15 samples)</span>
              <input
                v-model="windShowRecentMean"
                type="checkbox"
                class="lab__toggle"
              >
            </label>
            <label class="lab__row">
              <span>Zoom (drag box, ⌃/⌘ wheel, ⇧ pan, dbl-click reset)</span>
              <input
                v-model="windZoomable"
                type="checkbox"
                class="lab__toggle"
              >
            </label>
            <label class="lab__row">
              <span>Zoom: auto Y from visible window</span>
              <input
                v-model="windZoomAutoY"
                type="checkbox"
                class="lab__toggle"
                :disabled="!windZoomable"
              >
            </label>
          </section>

          <section class="lab__group">
            <h3 class="lab__group-title">
              Size
            </h3>
            <label class="lab__dial">
              <div class="lab__dial-top">
                <span class="lab__dial-label">Height (px)</span>
                <output class="lab__dial-value">{{ windHeight }}</output>
              </div>
              <input
                v-model.number="windHeight"
                type="range"
                min="320"
                max="640"
                step="20"
                class="lab__range"
              >
            </label>
          </section>
        </aside>

        <div class="lab__stage">
          <div
            ref="windChartWrapRef"
            class="lab__chart-wrap"
          >
            <NardukLineChart
              :series="windSeries"
              :labels="windLabels"
              :height="windHeight"
              :smooth="windSmooth"
              :show-grid="windShowGrid"
              :show-area="windShowArea"
              :show-points="false"
              :animate="false"
              :respect-reduced-motion="true"
              :reference-lines="windReferenceLines"
              :colors="windColors"
              :dark="forceDark"
              :theme="chartTheme"
              :zoomable="windZoomable"
              :zoom-auto-y="windZoomAutoY"
              class="lab__chart"
              @point-click="log('pointClick', $event)"
              @zoom="log('zoom', $event)"
            >
              <template
                v-if="demoCustomTooltip"
                #tooltip="{ title, items, visible }"
              >
                <div
                  class="lab__slot-tooltip"
                  :class="{ 'lab__slot-tooltip--hidden': !visible }"
                >
                  <div class="lab__slot-tooltip-title">
                    {{ title }}
                  </div>
                  <ul class="lab__slot-tooltip-list">
                    <li
                      v-for="it in items"
                      :key="it.label"
                      class="lab__slot-tooltip-row"
                    >
                      <span
                        class="lab__slot-tooltip-dot"
                        :style="{ background: it.color }"
                      />
                      <span class="lab__slot-tooltip-name">{{ it.label }}</span>
                      <span class="lab__slot-tooltip-val">{{ it.value }}</span>
                    </li>
                  </ul>
                </div>
              </template>
              <template
                v-if="demoCustomLegend"
                #legend-item="{ item, toggle }"
              >
                <button
                  type="button"
                  class="lab__slot-legend"
                  :class="{ 'lab__slot-legend--muted': item.hidden }"
                  @click="toggle"
                >
                  <span
                    class="lab__slot-legend-swatch"
                    :style="{
                      backgroundColor: item.hidden ? 'transparent' : item.color,
                      borderColor: item.color,
                    }"
                  />
                  {{ item.name }}
                </button>
              </template>
              <template
                v-if="demoCustomEmpty"
                #empty
              >
                <div class="lab__slot-empty">
                  <p class="lab__slot-empty-title">
                    No wind samples yet
                  </p>
                  <p class="lab__slot-empty-hint">
                    Open this tab to seed the stream, or use Reseed / clear controls.
                  </p>
                  <button
                    type="button"
                    class="lab__btn lab__btn--toolbar"
                    @click="seedWind()"
                  >
                    Seed buffer
                  </button>
                </div>
              </template>
            </NardukLineChart>
          </div>
        </div>
      </div>
    </div>

    <footer class="lab__footer">
      <strong>Last event:</strong> {{ lastEvent ?? '— interact with the active chart' }}
    </footer>
  </div>
</template>

<style>
.lab {
  --lab-bg: #f1f5f9;
  --lab-surface: #ffffff;
  --lab-border: #e2e8f0;
  --lab-text: #0f172a;
  --lab-muted: #64748b;
  --lab-accent: #4f46e5;
  --lab-accent-soft: #e0e7ff;
  --lab-tab-inactive: #cbd5e1;

  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--lab-bg);
  color: var(--lab-text);
  font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}

.lab--dark {
  --lab-bg: #0f172a;
  --lab-surface: #1e293b;
  --lab-border: #334155;
  --lab-text: #f1f5f9;
  --lab-muted: #94a3b8;
  --lab-accent: #818cf8;
  --lab-accent-soft: #312e81;
  --lab-tab-inactive: #475569;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
}

.lab__top {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 1rem 1.25rem;
  border-bottom: 1px solid var(--lab-border);
  background: var(--lab-surface);
}

.lab__top-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem 1rem;
}

.lab__export {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.lab__title {
  margin: 0;
  font-size: 1.35rem;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.lab__tag {
  margin: 0.2rem 0 0;
  font-size: 0.8125rem;
  color: var(--lab-muted);
}

.lab__switch {
  display: inline-flex;
  align-items: center;
  gap: 0.6rem;
  cursor: pointer;
  user-select: none;
  font-size: 0.875rem;
  font-weight: 500;
}

.lab__switch-input {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
}

.lab__switch-track {
  width: 44px;
  height: 24px;
  border-radius: 999px;
  background: var(--lab-tab-inactive);
  position: relative;
  transition: background 0.2s ease;
}

.lab__switch-track::after {
  content: '';
  position: absolute;
  top: 3px;
  left: 3px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
  transition: transform 0.2s ease;
}

.lab__switch-input:checked + .lab__switch-track {
  background: var(--lab-accent);
}

.lab__switch-input:checked + .lab__switch-track::after {
  transform: translateX(20px);
}

.lab__switch-input:focus-visible + .lab__switch-track {
  outline: 2px solid var(--lab-accent);
  outline-offset: 2px;
}

.lab__tabs {
  display: flex;
  gap: 0;
  padding: 0 1rem;
  background: var(--lab-surface);
  border-bottom: 1px solid var(--lab-border);
}

.lab__tab {
  appearance: none;
  border: none;
  background: transparent;
  padding: 0.85rem 1.25rem;
  font-size: 0.9375rem;
  font-weight: 600;
  color: var(--lab-muted);
  cursor: pointer;
  border-bottom: 3px solid transparent;
  margin-bottom: -1px;
  font-family: inherit;
}

.lab__tab:hover {
  color: var(--lab-text);
}

.lab__tab--active {
  color: var(--lab-accent);
  border-bottom-color: var(--lab-accent);
}

.lab__tab:focus-visible {
  outline: 2px solid var(--lab-accent);
  outline-offset: -2px;
}

.lab__body {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.lab__panel {
  flex: 1;
  display: grid;
  grid-template-columns: minmax(260px, 300px) minmax(0, 1fr);
  gap: 0;
  min-height: min(70vh, 720px);
}

@media (max-width: 900px) {
  .lab__panel {
    grid-template-columns: 1fr;
    min-height: auto;
  }
}

.lab__dock {
  background: var(--lab-surface);
  border-right: 1px solid var(--lab-border);
  padding: 1rem 1rem 2rem;
  overflow-y: auto;
  max-height: 70vh;
}

@media (max-width: 900px) {
  .lab__dock {
    border-right: none;
    border-bottom: 1px solid var(--lab-border);
    max-height: none;
  }
}

.lab__dock-title {
  margin: 0 0 1rem;
  font-size: 1rem;
  font-weight: 700;
}

.lab__group {
  margin-bottom: 1.25rem;
}

.lab__group-title {
  margin: 0 0 0.5rem;
  font-size: 0.65rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--lab-muted);
}

.lab__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.35rem 0;
  font-size: 0.8125rem;
}

.lab__toggle {
  width: 2.75rem;
  height: 1.5rem;
  appearance: none;
  border-radius: 999px;
  background: var(--lab-tab-inactive);
  cursor: pointer;
  position: relative;
  transition: background 0.2s ease;
  flex-shrink: 0;
}

.lab__toggle::after {
  content: '';
  position: absolute;
  top: 3px;
  left: 3px;
  width: calc(50% - 5px);
  height: calc(100% - 6px);
  max-width: 20px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.15);
  transition: transform 0.2s ease;
}

.lab__toggle:checked {
  background: var(--lab-accent);
}

.lab__toggle:checked::after {
  transform: translateX(1.35rem);
}

.lab__field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.lab__field-label {
  font-size: 0.75rem;
  color: var(--lab-muted);
}

.lab__select {
  width: 100%;
  padding: 0.5rem 0.65rem;
  border-radius: 8px;
  border: 1px solid var(--lab-border);
  background: var(--lab-bg);
  color: var(--lab-text);
  font-size: 0.8125rem;
  font-family: inherit;
}

.lab__dial {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.lab__dial-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.lab__dial--disabled {
  opacity: 0.45;
  pointer-events: none;
}

.lab__dial-label {
  font-size: 0.75rem;
  color: var(--lab-muted);
}

.lab__range {
  width: 100%;
  height: 6px;
  appearance: none;
  border-radius: 999px;
  background: var(--lab-border);
  cursor: pointer;
}

.lab__range::-webkit-slider-thumb {
  appearance: none;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--lab-accent);
  border: 2px solid var(--lab-surface);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.2);
}

.lab__range::-moz-range-thumb {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--lab-accent);
  border: 2px solid var(--lab-surface);
}

.lab__dial-value {
  font-size: 0.75rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--lab-accent);
  min-width: 2.25rem;
  text-align: right;
}

.lab__stage {
  padding: 1rem 1.25rem 1.5rem;
  display: flex;
  align-items: stretch;
  min-height: 360px;
  background: var(--lab-bg);
}

.lab__stage--pie {
  align-items: center;
  justify-content: center;
}

.lab__chart-wrap {
  width: 100%;
  min-width: 0;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.lab__chart-wrap--pie {
  align-items: center;
}

.lab__chart {
  width: 100%;
  min-width: 0;
  flex: 1;
  min-height: 0;
}

.lab__chart--pie {
  max-width: min(100%, 560px);
  margin: 0 auto;
}

.lab__footer {
  padding: 0.65rem 1.25rem;
  font-size: 0.75rem;
  border-top: 1px solid var(--lab-border);
  background: var(--lab-surface);
  color: var(--lab-muted);
  word-break: break-word;
}

.lab__wind-hint {
  margin: -0.25rem 0 1rem;
  font-size: 0.75rem;
  line-height: 1.45;
  color: var(--lab-muted);
}

.lab__wind-hint--tight {
  margin: 0 0 0.65rem;
}

.lab__dial-hint {
  font-size: 0.65rem;
  color: var(--lab-muted);
  line-height: 1.35;
}

.lab__readout {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.35rem 0.5rem;
  padding: 0.85rem 1rem;
  margin-bottom: 1.25rem;
  border-radius: 12px;
  background: var(--lab-accent-soft);
  border: 1px solid var(--lab-border);
}

.lab__readout-label {
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--lab-muted);
  width: 100%;
}

.lab__readout-value {
  font-size: 2.25rem;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.03em;
  line-height: 1;
  color: var(--lab-text);
}

.lab__readout-unit {
  font-size: 1rem;
  font-weight: 600;
  color: var(--lab-muted);
}

.lab__btn {
  margin-top: 0.5rem;
  width: 100%;
  padding: 0.5rem 0.75rem;
  border-radius: 8px;
  border: 1px solid var(--lab-border);
  background: var(--lab-bg);
  color: var(--lab-text);
  font-size: 0.8125rem;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
}

.lab__btn:hover {
  border-color: var(--lab-accent);
  color: var(--lab-accent);
}

.lab__btn:focus-visible {
  outline: 2px solid var(--lab-accent);
  outline-offset: 2px;
}

.lab__btn--toolbar {
  margin-top: 0;
  width: auto;
  padding: 0.45rem 0.85rem;
}

.lab__feature-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.65rem 1rem;
  padding: 0.65rem 1rem;
  background: var(--lab-surface);
  border-bottom: 1px solid var(--lab-border);
  font-size: 0.8125rem;
}

.lab__field--bar {
  flex-direction: row;
  align-items: center;
  gap: 0.5rem;
  margin: 0;
}

.lab__select--bar {
  width: auto;
  min-width: 10rem;
}

.lab__theme-class {
  font-size: 0.7rem;
  color: var(--lab-muted);
  font-family: ui-monospace, monospace;
  max-width: 16rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lab__chip {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  cursor: pointer;
  user-select: none;
  color: var(--lab-text);
}

.lab__chip-input {
  width: 1rem;
  height: 1rem;
  accent-color: var(--lab-accent);
  cursor: pointer;
}

.lab__code {
  font-family: ui-monospace, monospace;
  font-size: 0.72em;
  padding: 0.1em 0.35em;
  border-radius: 4px;
  background: var(--lab-bg);
  border: 1px solid var(--lab-border);
}

.lab__slot-tooltip {
  padding: 0.5rem 0.65rem;
  border-radius: 8px;
  background: var(--lab-surface);
  border: 2px solid var(--lab-accent);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.12);
  min-width: 10rem;
}

.lab--dark .lab__slot-tooltip {
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.45);
}

.lab__slot-tooltip--hidden {
  visibility: hidden;
  pointer-events: none;
}

.lab__slot-tooltip-title {
  font-size: 0.65rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--lab-muted);
  margin-bottom: 0.35rem;
}

.lab__slot-tooltip-list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.lab__slot-tooltip-row {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.75rem;
  padding: 0.15rem 0;
}

.lab__slot-tooltip-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.lab__slot-tooltip-name {
  flex: 1;
  color: var(--lab-text);
}

.lab__slot-tooltip-val {
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  color: var(--lab-accent);
}

.lab__slot-legend {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  margin: 0 0.35rem 0.35rem 0;
  padding: 0.35rem 0.55rem;
  border-radius: 8px;
  border: 1px solid var(--lab-border);
  background: var(--lab-bg);
  color: var(--lab-text);
  font-size: 0.75rem;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
}

.lab__slot-legend--muted {
  opacity: 0.55;
}

.lab__slot-legend-swatch {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  border: 2px solid transparent;
  flex-shrink: 0;
}

.lab__slot-empty {
  text-align: center;
  padding: 2rem 1.25rem;
  max-width: 22rem;
  margin: 0 auto;
}

.lab__slot-empty-title {
  margin: 0 0 0.35rem;
  font-size: 1rem;
  font-weight: 700;
  color: var(--lab-text);
}

.lab__slot-empty-hint {
  margin: 0 0 1rem;
  font-size: 0.8125rem;
  color: var(--lab-muted);
  line-height: 1.45;
}
</style>
