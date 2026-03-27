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
} from 'narduk-charts'
import type { CandleBar, CandleDrawing, CandleTimeDomain, ChartSeries } from 'narduk-charts'
import ExamplePage from '../../components/ExamplePage.vue'
import TradingDemoToolbar from '../../components/TradingDemoToolbar.vue'
import TradingChartOverlay from '../../components/TradingChartOverlay.vue'
import { createSeededRandom, hasUiAuditFlag } from '../../utils/demoMode'

// ─── Stonx stream ────────────────────────────────────────────────────────────
const STREAM_URL = 'wss://stonx.app/ws/stream'
const STREAM_CHANNEL = 'price:AAPL'
const uiAuditMode = hasUiAuditFlag()

const streamStatus = ref<'connecting' | 'connected' | 'offline'>('connecting')
const livePrice = ref<number | null>(null)
const liveTimestamp = ref<number | null>(null)

let ws: WebSocket | null = null
let fallbackTimer: ReturnType<typeof setTimeout> | null = null

function connectStonx() {
  if (typeof WebSocket === 'undefined') {
    streamStatus.value = 'offline'
    return
  }
  try {
    ws = new WebSocket(STREAM_URL)

    ws.addEventListener('open', () => {
      ws!.send(JSON.stringify({ type: 'subscribe', channels: [STREAM_CHANNEL] }))
    })

    ws.addEventListener('message', (event: MessageEvent) => {
      let msg: Record<string, unknown>
      try {
        msg = JSON.parse(event.data as string) as Record<string, unknown>
      } catch {
        return
      }
      const type = msg.type as string | undefined
      if (type === 'connected') {
        streamStatus.value = 'connected'
        stopDemoTimer()
        clearFallbackTimer()
      } else if (type === 'price_update') {
        streamStatus.value = 'connected'
        stopDemoTimer()
        clearFallbackTimer()
        const data = (
          msg.data as Array<{
            symbol: string
            price: number
            change: number | null
            changePercent: number | null
            lastUpdated: number
          }>
        )[0]
        if (data && data.symbol === 'AAPL' && typeof data.price === 'number') {
          livePrice.value = data.price
          liveTimestamp.value =
            typeof data.lastUpdated === 'number'
              ? data.lastUpdated
              : typeof msg.timestamp === 'number'
                ? msg.timestamp
                : Date.now()
          ingestLivePrice(data.price)
        }
      } else if (type === 'pong') {
        // keep-alive acknowledged — no-op
      } else if (type === 'error') {
        console.warn('[stonx] stream error', msg)
      }
    })

    ws.addEventListener('error', () => {
      streamStatus.value = 'offline'
    })

    ws.addEventListener('close', () => {
      if (streamStatus.value !== 'offline') {
        streamStatus.value = 'offline'
      }
    })
  } catch {
    streamStatus.value = 'offline'
  }
}

function disconnectStonx() {
  if (!ws) return
  try {
    ws.send(JSON.stringify({ type: 'unsubscribe', channels: [STREAM_CHANNEL] }))
  } catch {
    // ignore send errors on close
  }
  ws.close()
  ws = null
}

// ─── Seed history ─────────────────────────────────────────────────────────────
const SEED_PRICE = 213.5
const STEP_MS = 60_000
const SEED_COUNT = 320
const offlineRandom = createSeededRandom(26_031)

function seedAaplHistory(count: number, startPrice: number): CandleBar[] {
  // In audit mode use a fixed anchor date + seeded RNG for determinism.
  // In normal mode anchor to the recent past so the demo looks "live".
  const t0 = uiAuditMode
    ? Date.UTC(2026, 0, 15, 14, 0, 0)
    : Date.now() - count * STEP_MS
  const rand = uiAuditMode ? createSeededRandom(88_031) : Math.random
  let price = startPrice
  const out: CandleBar[] = []
  for (let i = 0; i < count; i++) {
    const o = price
    const drift = Math.sin(i / 13) * 1.4 + Math.cos(i / 7) * 0.8 + (rand() - 0.49) * 1.2
    const c = Math.max(0.01, o + drift)
    const h = Math.max(o, c) + rand() * 0.9
    const l = Math.min(o, c) - rand() * 0.9
    const v = Math.round(450_000 + rand() * 800_000 + (Math.abs(c - o) > 1.1 ? 300_000 : 0))
    out.push({ t: t0 + i * STEP_MS, o, h, l, c, v })
    price = c
  }
  return out
}

const STREAM_CAP = 420
const { bars: candleBars, pushBar } = useCandleStream(
  STREAM_CAP,
  seedAaplHistory(SEED_COUNT, SEED_PRICE)
)

let lastBarTime = 0

function ingestLivePrice(price: number) {
  const bars = candleBars.value
  const last = bars[bars.length - 1]
  if (!last) return
  const now = Date.now()
  const nextT = last.t + STEP_MS
  if (now >= nextT && now - lastBarTime >= STEP_MS) {
    // open a new candle
    pushBar({
      t: nextT,
      o: last.c,
      h: Math.max(last.c, price),
      l: Math.min(last.c, price),
      c: price,
      v: 500_000,
    })
    lastBarTime = now
  } else {
    // update forming bar
    pushBar({
      t: last.t,
      o: last.o,
      h: Math.max(last.h, price),
      l: Math.min(last.l, price),
      c: price,
      v: (last.v ?? 0) + 10_000,
    })
  }
}

// ─── Offline demo timer (when WebSocket is unavailable) ──────────────────────
let demoTimer: ReturnType<typeof setInterval> | null = null

function clearFallbackTimer() {
  if (fallbackTimer) {
    clearTimeout(fallbackTimer)
    fallbackTimer = null
  }
}

function stopDemoTimer() {
  if (demoTimer) {
    clearInterval(demoTimer)
    demoTimer = null
  }
}

function startDemoTimer() {
  if (demoTimer || uiAuditMode) return
  demoTimer = setInterval(() => {
    const bars = candleBars.value
    const last = bars[bars.length - 1]
    if (!last) return
    const o = last.c
    const drift = (offlineRandom() - 0.49) * 1.1
    const c = Math.max(0.01, o + drift)
    const h = Math.max(o, c) + offlineRandom() * 0.6
    const l = Math.min(o, c) - offlineRandom() * 0.6
    const v = Math.round(550_000 + offlineRandom() * 700_000)
    pushBar({ t: last.t + STEP_MS, o, h, l, c, v })
  }, 3_000)
}

// ─── Viewport / chart state ───────────────────────────────────────────────────
const sharedDomain = ref<CandleTimeDomain | null>(null)
const terminalDark = ref(true)
const useLogScale = ref(false)
const drawings = ref<CandleDrawing[]>([])
const drawMode = ref<'off' | 'trend' | 'horizontal'>('off')

const drawingTool = computed(() => (drawMode.value === 'off' ? null : drawMode.value))

const maxDraw = recommendMaxDrawBars({ plotWidthPx: 720 })

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

const rsiLabels = computed(() => candleBars.value.map((b) => formatShortTime(b.t)))

const rsiSeries = computed<ChartSeries[]>(() => [
  {
    name: 'RSI(14)',
    data: rsi(
      candleBars.value.map((b) => b.c),
      14
    ),
  },
])

const latestBar = computed(() => candleBars.value[candleBars.value.length - 1] ?? null)
const firstBar = computed(() => candleBars.value[0] ?? null)

const displayPrice = computed(() => livePrice.value ?? latestBar.value?.c ?? SEED_PRICE)

const sessionChange = computed(() => {
  const first = firstBar.value
  if (!first) return 0
  return displayPrice.value - first.o
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
  if (candleBars.value.length === 0) return { high: 0, low: 0 }
  let high = Number.NEGATIVE_INFINITY
  let low = Number.POSITIVE_INFINITY
  for (const bar of candleBars.value) {
    high = Math.max(high, bar.h)
    low = Math.min(low, bar.l)
  }
  return { high, low }
})

const openingRange = computed(() => {
  const sample = candleBars.value.slice(0, Math.min(15, candleBars.value.length))
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
  for (const bar of candleBars.value) {
    if (bar.v == null) continue
    total += bar.v
    count += 1
  }
  return count > 0 ? total / count : 0
})

const sessionVwap = computed(() => {
  let weighted = 0
  let totalVolume = 0
  for (const bar of candleBars.value) {
    const volume = Math.max(1, bar.v ?? 0)
    const typicalPrice = (bar.h + bar.l + bar.c) / 3
    weighted += typicalPrice * volume
    totalVolume += volume
  }
  if (totalVolume === 0) return latestBar.value?.c ?? 0
  return weighted / totalVolume
})

// ─── Lifecycle ────────────────────────────────────────────────────────────────
onMounted(() => {
  if (uiAuditMode) {
    streamStatus.value = 'offline'
    return
  }
  connectStonx()
  // Fall back to demo timer after 5s if no connection
  fallbackTimer = setTimeout(() => {
    if (streamStatus.value !== 'connected') {
      streamStatus.value = 'offline'
      startDemoTimer()
    }
  }, 5_000)
})

onUnmounted(() => {
  disconnectStonx()
  clearFallbackTimer()
  stopDemoTimer()
})

// ─── Formatters ───────────────────────────────────────────────────────────────
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
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
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
  <ExamplePage title="AAPL — Apple Inc." kicker="Flagship demo · Real-time" enable-chart-fullscreen>
    <template #intro>
      <p>
        Live candles for <strong>AAPL</strong> (<strong>Apple Inc.</strong>) powered by the
        <a
          href="https://stonx.app"
          target="_blank"
          rel="noopener noreferrer"
          class="font-medium text-[var(--color-ns-accent)] no-underline hover:underline"
          >Stonx</a
        >
        market-data stream at
        <code class="rounded bg-slate-100 px-1 dark:bg-slate-800">wss://stonx.app/ws/stream</code>.
        Demonstrates <strong>linked panes</strong>, volume, brush navigation,
        <strong>RSI(14)</strong> study row, drawing tools, and crosshair — all inside
        <code class="rounded bg-slate-100 px-1 dark:bg-slate-800">NardukChartStack</code>.
      </p>
      <p class="mt-2 flex items-center gap-2 text-sm">
        <span
          class="inline-block h-2 w-2 rounded-full"
          :class="{
            'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]': streamStatus === 'connected',
            'bg-amber-400 animate-pulse': streamStatus === 'connecting',
            'bg-rose-400': streamStatus === 'offline',
          }"
          aria-hidden="true"
        />
        <span v-if="streamStatus === 'connected'" class="text-emerald-600 font-semibold"
          >Stream live</span
        >
        <span v-else-if="streamStatus === 'connecting'" class="text-amber-600"
          >Connecting to stream…</span
        >
        <span v-else class="text-rose-500 font-semibold">Offline / delayed — demo data</span>
      </p>
    </template>

    <template #default="{ fullscreenChartHeight }">
      <div class="ns-terminal-shell">
        <TradingDemoToolbar
          symbol="AAPL"
          venue="NASDAQ · Apple Inc."
          timeframe="1 minute"
          :last-price-text="formatPrice(displayPrice)"
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
        />

        <NardukChartStack v-model:domain="sharedDomain">
          <div class="flex flex-col gap-3">
            <div class="ns-terminal-panel">
              <p class="mb-2 text-[0.65rem] font-bold uppercase tracking-[0.12em] text-slate-600">
                AAPL · 1 min
              </p>
              <NardukCandleChart
                chart-title="AAPL — 1 minute"
                chart-description="Apple Inc. (AAPL) candlestick chart. Zoom and pan; domain syncs RSI pane."
                :bars="candleBars"
                :height="fullscreenChartHeight ?? 400"
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
                chart-title="RSI(14) study"
                chart-description="Relative Strength Index linked to the AAPL candle viewport."
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
          </div>
        </NardukChartStack>
      </div>
    </template>
  </ExamplePage>
</template>
