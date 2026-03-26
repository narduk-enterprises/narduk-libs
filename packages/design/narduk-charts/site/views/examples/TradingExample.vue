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
} from 'narduk-charts'
import type { CandleBar, CandleDrawing, CandleTimeDomain, ChartSeries } from 'narduk-charts'
import ExamplePage from '../../components/ExamplePage.vue'

/** Futures-style random walk with wicks and volume spikes. */
function seedHistory(count: number, seedPrice: number): CandleBar[] {
  let price = seedPrice
  const stepMs = 60_000
  const t0 = Date.now() - count * stepMs
  const out: CandleBar[] = []
  for (let i = 0; i < count; i++) {
    const o = price
    const drift = (Math.random() - 0.49) * 14
    const c = Math.max(0.01, o + drift)
    const h = Math.max(o, c) + Math.random() * 10
    const l = Math.min(o, c) - Math.random() * 10
    const v = 800 + Math.random() * 9000 + (Math.abs(c - o) > 6 ? 4000 : 0)
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

const STREAM_CAP = 420
const { bars: candleBars, pushBar } = useCandleStream(STREAM_CAP, seedHistory(320, 21_180))

const sharedDomain = ref<CandleTimeDomain | null>(null)
const terminalDark = ref(true)
const useLogScale = ref(false)
const drawings = ref<CandleDrawing[]>([])
const drawMode = ref<'off' | 'trend' | 'horizontal'>('off')

const drawingTool = computed(() =>
  drawMode.value === 'off' ? null : drawMode.value,
)

const maxDraw = recommendMaxDrawBars({ plotWidthPx: 720 })
const renderHint = suggestCandleRenderStrategy(STREAM_CAP, maxDraw)

const lineXWindow = computed({
  get() {
    if (!sharedDomain.value || candleBars.value.length < 2) return undefined
    return {
      start: candleIndexAtTime(candleBars.value, sharedDomain.value.start),
      end: candleIndexAtTime(candleBars.value, sharedDomain.value.end),
    }
  },
  set(w: { start: number; end: number } | undefined) {
    if (!w || candleBars.value.length < 2) return
    sharedDomain.value = {
      start: candleTimeAtIndex(candleBars.value, w.start),
      end: candleTimeAtIndex(candleBars.value, w.end),
    }
  },
})

const rsiLabels = computed(() =>
  candleBars.value.map(b => formatShortTime(b.t)),
)

const rsiSeries = computed<ChartSeries[]>(() => [
  {
    name: 'RSI(14)',
    data: rsi(candleBars.value.map(b => b.c), 14),
  },
])

let liveTimer: ReturnType<typeof setInterval> | null = null

function pushNextBar() {
  const b = candleBars.value
  const last = b[b.length - 1]
  if (!last) return
  const stepMs = 60_000
  const t = last.t + stepMs
  const o = last.c
  const drift = (Math.random() - 0.5) * 8
  const c = Math.max(0.01, o + drift)
  const h = Math.max(o, c) + Math.random() * 6
  const l = Math.min(o, c) - Math.random() * 6
  const v = Math.round(1200 + Math.random() * 7000)
  pushBar({ t, o, h, l, c, v })
}

onMounted(() => {
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
</script>

<template>
  <ExamplePage
    title="Stock & futures trading charts"
    kicker="Advanced OHLC"
    enable-chart-fullscreen
  >
    <template #intro>
      <p>
        Production-style candlesticks with <strong>volume</strong>, a <strong>brush minimap</strong>,
        <strong>pinch zoom</strong> (touch), <strong>Ctrl/Cmd + wheel</strong> zoom,
        <strong>Shift + drag</strong> pan, and <strong>drag-to-box</strong> zoom.
        <code class="rounded bg-slate-100 px-1 dark:bg-slate-800">NardukChartStack</code> groups panes that share
        <code class="rounded bg-slate-100 px-1 dark:bg-slate-800">v-model:domain</code>; study rows use
        <code class="rounded bg-slate-100 px-1 dark:bg-slate-800">NardukLineChart</code> with
        <code class="rounded bg-slate-100 px-1 dark:bg-slate-800">v-model:x-window</code> mapped through
        <code class="rounded bg-slate-100 px-1 dark:bg-slate-800">candleIndexAtTime</code> /
        <code class="rounded bg-slate-100 px-1 dark:bg-slate-800">candleTimeAtIndex</code>.
      </p>
      <p>
        Bars stream in on a timer via <code class="rounded bg-slate-100 px-1 dark:bg-slate-800">useCandleStream</code>
        (rolling buffer, same open time replaces the forming bar).
        Perf gate: <code class="rounded bg-slate-100 px-1 dark:bg-slate-800">recommendMaxDrawBars</code> suggests
        <strong>{{ maxDraw }}</strong> buckets for ~720px width; strategy hint for this demo size:
        <strong>{{ renderHint }}</strong>.
      </p>
      <ul class="mt-3 list-disc pl-5 text-sm text-[var(--color-ns-muted)]">
        <li>Crosshair (linear / log / symlog Y), magnetic X, axis time tag, OHLC HUD, optional drawings (trend / horizontal).</li>
        <li>Last-price line, forming-bar highlight, <code class="rounded bg-slate-100 px-1 dark:bg-slate-800">overlay</code> slot + <code class="rounded bg-slate-100 px-1 dark:bg-slate-800">getCandlePlotMetrics()</code> for custom SVG layers.</li>
        <li>Keyboard: arrows scrub; <kbd class="rounded border border-slate-300 px-1 dark:border-slate-600">Delete</kbd> clears drawings; double-click resets zoom.</li>
      </ul>
      <div class="mt-4 flex flex-wrap items-center gap-4 text-sm font-medium text-[var(--color-ns-text)]">
        <label class="flex cursor-pointer items-center gap-2">
          <input
            v-model="terminalDark"
            type="checkbox"
            class="h-4 w-4 rounded border-slate-300 accent-indigo-600"
          >
          Terminal dark surface
        </label>
        <label class="flex cursor-pointer items-center gap-2">
          <input
            v-model="useLogScale"
            type="checkbox"
            class="h-4 w-4 rounded border-slate-300 accent-indigo-600"
          >
          Log Y (absolute prices)
        </label>
        <span class="text-[var(--color-ns-muted)]">Draw tool:</span>
        <select
          v-model="drawMode"
          class="rounded border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-900"
        >
          <option value="off">
            Off (zoom box)
          </option>
          <option value="trend">
            Trend line (drag)
          </option>
          <option value="horizontal">
            Horizontal (click)
          </option>
        </select>
      </div>
    </template>

    <template #default="{ fullscreenChartHeight }">
      <NardukChartStack v-model:domain="sharedDomain">
        <div class="flex flex-col gap-8">
          <div class="rounded-lg border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-700 dark:bg-slate-900/40">
            <p class="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Primary — NQ-style continuous (1m, demo)
            </p>
            <NardukCandleChart
              chart-title="NQ — 1 minute"
              chart-description="Demo data. Zoom and pan; domain syncs RSI row and secondary pane."
              :bars="candleBars"
              :height="fullscreenChartHeight ?? 340"
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
              v-model:domain="sharedDomain"
              :format-time="formatTime"
              :format-price="formatPrice"
              @update:drawings="drawings = $event"
            />
          </div>

          <div class="rounded-lg border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-700 dark:bg-slate-900/40">
            <p class="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
              RSI(14) — same viewport (<code class="font-mono text-[10px]">v-model:x-window</code>)
            </p>
            <NardukLineChart
              chart-title="RSI study"
              chart-description="Linked X window via fractional indices mapped to bar times."
              :series="rsiSeries"
              :labels="rsiLabels"
              :height="fullscreenChartHeight ? Math.max(120, Math.min(200, Math.round(fullscreenChartHeight * 0.2))) : 160"
              class="w-full min-w-0"
              :dark="terminalDark"
              :zoomable="false"
              :show-grid="true"
              :show-points="false"
              v-model:x-window="lineXWindow"
            />
          </div>

          <div class="rounded-lg border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-700 dark:bg-slate-900/40">
            <p class="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Secondary — same series, synced viewport
            </p>
            <NardukCandleChart
              chart-title="Linked window (same feed)"
              chart-description="v-model:domain binds both charts to the same visible time range in milliseconds."
              :bars="candleBars"
              :height="fullscreenChartHeight ? Math.max(240, Math.round(fullscreenChartHeight * 0.38)) : 300"
              class="w-full min-w-0"
              :dark="terminalDark"
              :zoomable="true"
              :show-volume="true"
              :show-brush="true"
              :show-session-grid="true"
              :max-draw-bars="maxDraw"
              v-model:domain="sharedDomain"
              :format-time="formatTime"
              :format-price="formatPrice"
            />
          </div>
        </div>
      </NardukChartStack>
    </template>
  </ExamplePage>
</template>
