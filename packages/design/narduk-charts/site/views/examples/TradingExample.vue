<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import {
  NardukCandleChart,
  NardukChartStack,
  NardukLineChart,
  useCandleStream,
  candleIndexAtTime,
  candleTimeAtIndex,
  rsi,
  recommendMaxDrawBars,
  suggestCandleRenderStrategy,
  aggregateCandlesToResolution,
  resolutionMsFromId,
  CANDLE_RESOLUTION_LABEL,
} from '@narduk-enterprises/narduk-charts'
import type {
  CandleBar,
  CandleDrawing,
  CandleResolutionId,
  CandleTimeDomain,
  ChartSeries,
} from '@narduk-enterprises/narduk-charts'
import ExamplePage from '../../components/ExamplePage.vue'
import TradingDemoToolbar from '../../components/TradingDemoToolbar.vue'
import TradingChartOverlay from '../../components/TradingChartOverlay.vue'
import { createSeededRandom, hasUiAuditFlag } from '../../utils/demoMode'

const uiAuditMode = hasUiAuditFlag()

/** Futures-style random walk with wicks and volume spikes. */
function seedHistory(count: number, seedPrice: number): CandleBar[] {
  let price = seedPrice
  const stepMs = 60_000
  // In audit mode use a fixed anchor date + seeded RNG for determinism.
  // In normal mode anchor to the recent past so the demo always looks "current".
  const t0 = uiAuditMode
    ? Date.UTC(2026, 0, 15, 14, 0, 0)
    : Date.now() - count * stepMs
  const rand = uiAuditMode ? createSeededRandom(17_031) : Math.random
  const out: CandleBar[] = []
  for (let i = 0; i < count; i++) {
    const o = price
    const drift = (rand() - 0.49) * 14
    const c = Math.max(0.01, o + drift)
    const h = Math.max(o, c) + rand() * 10
    const l = Math.min(o, c) - rand() * 10
    const v = 800 + rand() * 9000 + (Math.abs(c - o) > 6 ? 4000 : 0)
    out.push({
      t: t0 + i * stepMs,
      o,
      h,
      l,
      c,
      v: Math.round(v),
    })
    price = c
  }
  return out
}

const BASE_STEP_MS = 60_000

const STREAM_CAP = 420
const { bars: candleBars, pushBar } = useCandleStream(STREAM_CAP, seedHistory(320, 21_180))

const sharedDomain = ref<CandleTimeDomain | null>(null)
const terminalDark = ref(true)
const useLogScale = ref(false)
const drawings = ref<CandleDrawing[]>([])
const drawMode = ref<'off' | 'trend' | 'horizontal' | 'fib_retracement' | 'range'>('off')
const selectedResolution = ref<CandleResolutionId>('1m')

const drawingTool = computed(() => (drawMode.value === 'off' ? null : drawMode.value))

const timeframeLabel = computed(() => CANDLE_RESOLUTION_LABEL[selectedResolution.value])

const chartBars = computed(() => {
  const ms = resolutionMsFromId(selectedResolution.value)
  if (ms === BASE_STEP_MS) return candleBars.value
  return aggregateCandlesToResolution(candleBars.value, ms)
})

const maxDraw = recommendMaxDrawBars({ plotWidthPx: 720 })
const renderHint = suggestCandleRenderStrategy(STREAM_CAP, maxDraw)

const lineXWindow = computed({
  get() {
    if (!sharedDomain.value || chartBars.value.length < 2) return undefined
    return {
      start: candleIndexAtTime(chartBars.value, sharedDomain.value.start),
      end: candleIndexAtTime(chartBars.value, sharedDomain.value.end),
    }
  },
  set(w: { start: number; end: number } | undefined) {
    if (!w || chartBars.value.length < 2) return
    sharedDomain.value = {
      start: candleTimeAtIndex(chartBars.value, w.start),
      end: candleTimeAtIndex(chartBars.value, w.end),
    }
  },
})

const rsiLabels = computed(() => chartBars.value.map((b) => formatShortTime(b.t)))

const rsiSeries = computed<ChartSeries[]>(() => [
  {
    name: 'RSI(14)',
    data: rsi(
      chartBars.value.map((b) => b.c),
      14
    ),
  },
])

const latestBar = computed(() => chartBars.value[chartBars.value.length - 1] ?? null)
const firstBar = computed(() => chartBars.value[0] ?? null)

const sessionChange = computed(() => {
  const first = firstBar.value
  const latest = latestBar.value
  if (!first || !latest) return 0
  return latest.c - first.o
})

const sessionChangePct = computed(() => {
  const first = firstBar.value
  if (!first || first.o === 0) return 0
  return (sessionChange.value / first.o) * 100
})

const sessionChangeTone = computed<'up' | 'down' | 'flat'>(() => {
  if (sessionChange.value > 0.01) return 'up'
  if (sessionChange.value < -0.01) return 'down'
  return 'flat'
})

const sessionOpen = computed(() => firstBar.value?.o ?? 0)

const sessionRange = computed(() => {
  if (chartBars.value.length === 0) return { high: 0, low: 0 }
  let high = Number.NEGATIVE_INFINITY
  let low = Number.POSITIVE_INFINITY
  for (const bar of chartBars.value) {
    high = Math.max(high, bar.h)
    low = Math.min(low, bar.l)
  }
  return { high, low }
})

const openingRange = computed(() => {
  const sample = chartBars.value.slice(0, Math.min(15, chartBars.value.length))
  if (sample.length === 0) return { high: 0, low: 0 }
  let high = Number.NEGATIVE_INFINITY
  let low = Number.POSITIVE_INFINITY
  for (const bar of sample) {
    high = Math.max(high, bar.h)
    low = Math.min(low, bar.l)
  }
  return { high, low }
})

const averageVolume = computed(() => {
  let total = 0
  let count = 0
  for (const bar of chartBars.value) {
    if (bar.v == null) continue
    total += bar.v
    count += 1
  }
  return count > 0 ? total / count : 0
})

const sessionVwap = computed(() => {
  let weighted = 0
  let totalVolume = 0
  for (const bar of chartBars.value) {
    const volume = Math.max(1, bar.v ?? 0)
    const typicalPrice = (bar.h + bar.l + bar.c) / 3
    weighted += typicalPrice * volume
    totalVolume += volume
  }
  if (totalVolume === 0) return latestBar.value?.c ?? 0
  return weighted / totalVolume
})

let liveTimer: ReturnType<typeof setInterval> | null = null
const liveRandom = createSeededRandom(44_219)

function pushNextBar() {
  const b = candleBars.value
  const last = b[b.length - 1]
  if (!last) return
  const stepMs = 60_000
  const t = last.t + stepMs
  const o = last.c
  const drift = (liveRandom() - 0.5) * 8
  const c = Math.max(0.01, o + drift)
  const h = Math.max(o, c) + liveRandom() * 6
  const l = Math.min(o, c) - liveRandom() * 6
  const v = Math.round(1200 + liveRandom() * 7000)
  pushBar({ t, o, h, l, c, v })
}

onMounted(() => {
  if (uiAuditMode) return
  liveTimer = setInterval(pushNextBar, 1800)
})

onUnmounted(() => {
  if (liveTimer) clearInterval(liveTimer)
})

function formatTime(ms: number) {
  const d = new Date(ms)
  return d.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
    day: 'numeric',
  })
}

function formatShortTime(ms: number) {
  const d = new Date(ms)
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

function formatPrice(n: number) {
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function formatSignedPrice(n: number) {
  const sign = n > 0 ? '+' : ''
  return `${sign}${formatPrice(n)}`
}

function formatSignedPercent(n: number) {
  const sign = n > 0 ? '+' : ''
  return `${sign}${n.toFixed(2)}%`
}

function formatCompactVolume(n: number) {
  return new Intl.NumberFormat(undefined, {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(n)
}
</script>

<template>
  <ExamplePage
    title="Stock & futures trading charts"
    kicker="Advanced OHLC"
    enable-chart-fullscreen
  >
    <template #intro>
      <p>
        Production-style candlesticks with <strong>volume</strong>, a
        <strong>brush minimap</strong>, <strong>pinch zoom</strong> (touch),
        <strong>Ctrl/Cmd + wheel</strong> zoom, <strong>Shift + drag</strong> pan, and
        <strong>drag-to-box</strong> zoom.
        <code class="rounded bg-slate-100 px-1 dark:bg-slate-800">NardukChartStack</code> groups
        panes that share
        <code class="rounded bg-slate-100 px-1 dark:bg-slate-800">v-model:domain</code>; study rows
        use <code class="rounded bg-slate-100 px-1 dark:bg-slate-800">NardukLineChart</code> with
        <code class="rounded bg-slate-100 px-1 dark:bg-slate-800">v-model:x-window</code> mapped
        through <code class="rounded bg-slate-100 px-1 dark:bg-slate-800">candleIndexAtTime</code> /
        <code class="rounded bg-slate-100 px-1 dark:bg-slate-800">candleTimeAtIndex</code>.
      </p>
      <p>
        Bars stream in on a timer via
        <code class="rounded bg-slate-100 px-1 dark:bg-slate-800">useCandleStream</code> (rolling
        buffer, same open time replaces the forming bar). Perf gate:
        <code class="rounded bg-slate-100 px-1 dark:bg-slate-800">recommendMaxDrawBars</code>
        suggests <strong>{{ maxDraw }}</strong> buckets for ~720px width; strategy hint for this
        demo size: <strong>{{ renderHint }}</strong
        >.
      </p>
      <ul class="mt-3 list-disc pl-5 text-sm text-[var(--color-ns-muted)]">
        <li>
          Crosshair (linear / log / symlog Y), magnetic X, axis time tag, OHLC HUD, optional
          drawings (trend, horizontal, Fib retracement, range box). Toolbar resamples 1m feed to
          higher timeframes via <code class="rounded bg-slate-100 px-1 dark:bg-slate-800">aggregateCandlesToResolution</code>.
        </li>
        <li>
          Last-price line, forming-bar highlight,
          <code class="rounded bg-slate-100 px-1 dark:bg-slate-800">overlay</code> slot +
          <code class="rounded bg-slate-100 px-1 dark:bg-slate-800">getCandlePlotMetrics()</code>
          for custom SVG layers.
        </li>
        <li>
          Keyboard: arrows scrub;
          <kbd class="rounded border border-slate-300 px-1 dark:border-slate-600">Delete</kbd>
          clears drawings; double-click resets zoom.
        </li>
      </ul>
    </template>

    <template #default="{ fullscreenChartHeight }">
      <div class="ns-terminal-shell">
        <TradingDemoToolbar
          symbol="NQ1!"
          venue="CME Futures"
          :timeframe="timeframeLabel"
          :resolution="selectedResolution"
          :last-price-text="formatPrice(latestBar?.c ?? 0)"
          :change-text="formatSignedPrice(sessionChange)"
          :change-pct-text="formatSignedPercent(sessionChangePct)"
          :change-tone="sessionChangeTone"
          :vwap-text="formatPrice(sessionVwap)"
          :avg-volume-text="formatCompactVolume(averageVolume)"
          :session-range-text="`${formatPrice(sessionRange.low)} – ${formatPrice(sessionRange.high)}`"
          :terminal-dark="terminalDark"
          :use-log-scale="useLogScale"
          :draw-mode="drawMode"
          @update:terminal-dark="terminalDark = $event"
          @update:use-log-scale="useLogScale = $event"
          @update:draw-mode="drawMode = $event"
          @update:resolution="selectedResolution = $event"
        />

        <NardukChartStack v-model:domain="sharedDomain">
          <div class="flex flex-col gap-3">
            <div class="ns-terminal-panel">
              <p class="mb-2 text-[0.65rem] font-bold uppercase tracking-[0.12em] text-slate-600">
                NQ1! · {{ timeframeLabel }} — primary
              </p>
              <NardukCandleChart
                :chart-title="`NQ — ${timeframeLabel}`"
                chart-description="Demo data. Zoom and pan; domain syncs RSI row and secondary pane."
                :bars="chartBars"
                candle-style="bar"
                :height="fullscreenChartHeight ?? 380"
                class="w-full min-w-0"
                :dark="terminalDark"
                :zoomable="true"
                :y-scale="useLogScale ? 'log' : 'linear'"
                :highlight-forming-bar="true"
                :drawings="drawings"
                :drawing-tool="drawingTool"
                :show-volume="true"
                :show-brush="true"
                :show-session-grid="true"
                :max-draw-bars="maxDraw"
                bull-color="#26a69a"
                bear-color="#ef5350"
                v-model:domain="sharedDomain"
                :format-time="formatTime"
                :format-price="formatPrice"
                @update:drawings="drawings = $event"
              >
                <template #overlay="{ metrics }">
                  <TradingChartOverlay
                    :metrics="metrics"
                    :vwap="sessionVwap"
                    :session-open="sessionOpen"
                    :opening-range-high="openingRange.high"
                    :opening-range-low="openingRange.low"
                  />
                </template>
              </NardukCandleChart>
            </div>

            <div class="ns-terminal-panel">
              <p class="mb-2 text-[0.65rem] font-bold uppercase tracking-[0.12em] text-slate-600">
                RSI(14)
              </p>
              <NardukLineChart
                chart-title="RSI study"
                chart-description="Linked X window via fractional indices mapped to bar times."
                :series="rsiSeries"
                :labels="rsiLabels"
                :height="
                  fullscreenChartHeight
                    ? Math.max(128, Math.min(196, Math.round(fullscreenChartHeight * 0.2)))
                    : 168
                "
                class="w-full min-w-0"
                :dark="terminalDark"
                :zoomable="false"
                :show-grid="true"
                :show-points="false"
                v-model:x-window="lineXWindow"
              />
            </div>

            <div class="ns-terminal-panel">
              <p class="mb-2 text-[0.65rem] font-bold uppercase tracking-[0.12em] text-slate-600">
                Linked secondary pane
              </p>
              <NardukCandleChart
                chart-title="Linked window (same feed)"
                chart-description="v-model:domain binds both charts to the same visible time range in milliseconds."
                :bars="chartBars"
                :height="
                  fullscreenChartHeight
                    ? Math.max(224, Math.round(fullscreenChartHeight * 0.38))
                    : 300
                "
                class="w-full min-w-0"
                :dark="terminalDark"
                :zoomable="true"
                :show-volume="true"
                :show-brush="true"
                :show-session-grid="true"
                :max-draw-bars="maxDraw"
                bull-color="#26a69a"
                bear-color="#ef5350"
                v-model:domain="sharedDomain"
                :format-time="formatTime"
                :format-price="formatPrice"
              />
            </div>
          </div>
        </NardukChartStack>
      </div>
    </template>
  </ExamplePage>
</template>
