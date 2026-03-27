<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { NardukCandleChart, useChartFullscreen } from '@narduk-enterprises/narduk-charts'
import type { CandleBar, CandleDrawing } from '@narduk-enterprises/narduk-charts'
import SiteHeader from '../components/SiteHeader.vue'
import SiteFooter from '../components/SiteFooter.vue'
import NsHeroBackdrop from '../components/NsHeroBackdrop.vue'

const { targetRef: heroChartPanelRef, isFullscreen: heroFullscreen, toggle: toggleHeroFullscreen } =
  useChartFullscreen()

const viewportH = ref(typeof window !== 'undefined' ? window.innerHeight : 800)

function syncViewport() {
  if (typeof window !== 'undefined') viewportH.value = window.innerHeight
}

const heroChartHeight = computed(() =>
  heroFullscreen.value ? Math.max(400, viewportH.value - 140) : 300,
)

onMounted(() => {
  syncViewport()
  window.addEventListener('resize', syncViewport)
})

onUnmounted(() => {
  window.removeEventListener('resize', syncViewport)
})

/** Deterministic demo series for the hero (no live timer). */
function makeHeroCandleBars(): CandleBar[] {
  const stepMs = 60_000
  const t0 = Date.UTC(2026, 0, 15, 14, 0, 0)
  let p = 21_400
  const out: CandleBar[] = []
  for (let i = 0; i < 96; i++) {
    const drift = Math.sin(i / 11) * 8 + Math.cos(i / 7) * 4
    const o = p
    const c = Math.max(0.01, o + drift)
    const h = Math.max(o, c) + 6
    const l = Math.min(o, c) - 6
    out.push({
      t: t0 + i * stepMs,
      o,
      h,
      l,
      c,
      v: 2000 + (i % 40) * 120,
    })
    p = c
  }
  return out
}

const heroCandleBars = makeHeroCandleBars()

/** Static showcase: range + Fib + trend on the hero series (no draw tool needed). */
function makeHeroDrawings(bars: CandleBar[]): CandleDrawing[] {
  // Max index used below is iTrend1 (78); need length >= 79.
  if (bars.length < 79) return []
  const iTrend0 = 12
  const iTrend1 = 78
  const lo = 28
  const hi = 52
  const slice = bars.slice(lo, hi + 1)
  let top = Number.NEGATIVE_INFINITY
  let bot = Number.POSITIVE_INFINITY
  for (const x of slice) {
    top = Math.max(top, x.h)
    bot = Math.min(bot, x.l)
  }
  return [
    {
      id: 'hero-range',
      type: 'range',
      tStart: bars[lo]!.t,
      tEnd: bars[hi]!.t,
      priceTop: top,
      priceBottom: bot,
    },
    {
      id: 'hero-fib',
      type: 'fib_retracement',
      tStart: bars[8]!.t,
      priceStart: bars[8]!.h,
      tEnd: bars[38]!.t,
      priceEnd: bars[38]!.l,
    },
    {
      id: 'hero-trend',
      type: 'trend',
      tStart: bars[iTrend0]!.t,
      priceStart: bars[iTrend0]!.l,
      tEnd: bars[iTrend1]!.t,
      priceEnd: bars[iTrend1]!.h,
    },
  ]
}

const heroDrawings = makeHeroDrawings(heroCandleBars)

function formatHeroTime(ms: number) {
  const d = new Date(ms)
  return d.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
    day: 'numeric',
  })
}

/** Public marketing site (Nuxt); this repo ships the library only. */
const MARKETING = 'https://charts.nard.uk' as const

const useCases = [
  {
    href: `${MARKETING}/docs/examples/aapl`,
    title: 'AAPL flagship demo',
    desc: 'Stonx WebSocket with auto-reconnect + history backfill, toolbar timeframe resampling (1m→1D), hollow candles, Fib/range/trend drawings, RSI row, volume, brush.',
    tag: 'Flagship',
  },
  {
    href: `${MARKETING}/showcase/candle`,
    title: 'Trading & OHLC',
    desc: 'Candlestick showcase: bar styles, price scale, volume, brush, crosshair — pair with chart stack for multi-pane layouts.',
    tag: 'Markets',
  },
  {
    href: `${MARKETING}/showcase/line`,
    title: 'Line & trends',
    desc: 'Multi-series, dual Y, zoom, annotations, log scale, and live streaming.',
    tag: 'Analytics',
  },
  {
    href: `${MARKETING}/showcase/bar`,
    title: 'Bar & composition',
    desc: 'Grouped and stacked bars, reference lines, and Y-band guides.',
    tag: 'Reporting',
  },
  {
    href: `${MARKETING}/showcase/pie`,
    title: 'Pie & donut',
    desc: 'Part-to-whole breakdowns with keyboard-accessible slices.',
    tag: 'Dashboards',
  },
  {
    href: `${MARKETING}/showcase/scatter`,
    title: 'Scatter & correlation',
    desc: 'Numeric X/Y with multiple series and clean axes.',
    tag: 'Science',
  },
  {
    href: `${MARKETING}/showcase/histogram`,
    title: 'Histogram',
    desc: 'Distribution of values with adjustable bins.',
    tag: 'Stats',
  },
  {
    href: `${MARKETING}/showcase/capabilities/realtime`,
    title: 'Live metrics',
    desc: 'Rolling window with useStreamingSeries — ideal for IoT and ops.',
    tag: 'Realtime',
  },
] as const

const heroStats = [
  {
    label: 'Flagship surface',
    value: 'Trading-grade OHLC',
    copy: 'Hollow / bar / classic bodies, resampled timeframes, Fib & range drawings, live WebSocket path (AAPL).',
  },
  {
    label: 'Accessibility',
    value: 'Keyboard-first defaults',
    copy: 'Focus states, live regions, and screen-reader-friendly chart descriptions.',
  },
  {
    label: 'Ship size',
    value: 'Per-chart entry points',
    copy: 'Import only line, bar, pie, candle, or studies when you need them.',
  },
] as const
</script>

<template>
  <div class="min-h-screen flex flex-col">
    <SiteHeader />
    <main
      id="main-content"
      class="flex-1"
      tabindex="-1"
    >
      <section class="ns-hero-section relative overflow-hidden border-b border-[var(--color-ns-border)]">
        <NsHeroBackdrop />
        <div class="ns-container relative z-10 py-16 md:py-24">
          <div class="grid items-center gap-10 lg:grid-cols-2 lg:gap-12">
            <div class="min-w-0 relative">
              <p class="mb-3 text-sm font-semibold uppercase tracking-[0.14em] text-[var(--color-ns-accent)]">
                NardukCharts · developer gallery
              </p>
              <h1
                class="ns-font-display max-w-3xl text-4xl font-extrabold tracking-tight text-[var(--color-ns-text)] md:text-5xl md:leading-tight"
              >
                Trading-grade charts for Vue
              </h1>
              <p class="mt-5 max-w-2xl text-lg text-[var(--color-ns-muted)]">
                Routed examples and OHLC surfaces for validating the library. Narrative marketing, enterprise pages, and SEO for the Narduk product line live in the companion
                <a
                  class="font-semibold text-[var(--color-ns-accent)] no-underline hover:underline"
                  href="https://github.com/narduk-enterprises/charts"
                  target="_blank"
                  rel="noopener noreferrer"
                >Narduk marketing site</a>
                —this repo is the chart engine and gallery.
              </p>
              <div class="mt-8 flex flex-wrap gap-3">
                <a
                  :href="`${MARKETING}/docs/examples/aapl`"
                  class="ns-btn ns-btn--primary"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  AAPL demo
                </a>
                <a
                  :href="`${MARKETING}/showcase/candle`"
                  class="ns-btn ns-btn--ghost"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Trading OHLC
                </a>
                <a
                  :href="`${MARKETING}/showcase`"
                  class="ns-btn ns-btn--ghost"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Showcase
                </a>
                <a
                  class="ns-btn ns-btn--ghost"
                  href="https://github.com/narduk-enterprises/narduk-charts"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Library source
                </a>
              </div>
              <div class="ns-signal-grid mt-8 max-w-3xl">
                <article
                  v-for="stat in heroStats"
                  :key="stat.label"
                  class="ns-signal-card"
                >
                  <p class="ns-signal-label">{{ stat.label }}</p>
                  <p class="ns-signal-value">{{ stat.value }}</p>
                  <p class="ns-signal-copy">{{ stat.copy }}</p>
                </article>
              </div>
            </div>
            <div class="min-w-0">
              <div
                ref="heroChartPanelRef"
                class="ns-chart-panel ns-hero-chart-card rounded-[1.4rem] border border-[var(--color-ns-border)] p-4 md:p-5"
              >
                <div class="mb-3 flex flex-wrap items-start justify-between gap-3">
                  <div class="min-w-0 text-center sm:text-left">
                    <p class="m-0 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-ns-muted)]">
                      Interactive sample
                    </p>
                    <p class="mt-1 m-0 text-sm font-medium text-[var(--color-ns-text)]">
                      Static series · hollow candles · volume · brush · drawings
                    </p>
                  </div>
                  <button
                    type="button"
                    class="ns-btn ns-btn--ghost ns-btn--compact shrink-0"
                    :aria-pressed="heroFullscreen"
                    :aria-label="heroFullscreen ? 'Exit full screen chart' : 'View chart full screen'"
                    @click="() => void toggleHeroFullscreen()"
                  >
                    {{ heroFullscreen ? 'Exit full screen' : 'Full screen' }}
                  </button>
                </div>
                <NardukCandleChart
                  chart-description="Pinch or scroll to zoom. Shift-drag to pan, or drag on the plot to zoom a range. Hero shows static Fib, range, and trend overlays."
                  :bars="heroCandleBars"
                  :height="heroChartHeight"
                  class="w-full min-w-0"
                  :zoomable="true"
                  :zoom-wheel-free="true"
                  candle-style="hollow"
                  :drawings="heroDrawings"
                  :show-volume="true"
                  :volume-fraction="0.17"
                  :show-brush="true"
                  :max-draw-bars="256"
                  :show-session-grid="true"
                  :format-time="formatHeroTime"
                />
                <p class="mt-3 text-center text-xs text-[var(--color-ns-muted)]">
                  <a
                    :href="`${MARKETING}/docs/examples/aapl`"
                    class="font-medium text-[var(--color-ns-accent)] no-underline hover:underline"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    AAPL + Stonx stream
                  </a>
                  ·
                  <a
                    :href="`${MARKETING}/showcase/candle`"
                    class="font-medium text-[var(--color-ns-accent)] no-underline hover:underline"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Candle showcase
                  </a>
                  ·
                  <a
                    :href="`${MARKETING}/showcase`"
                    class="font-medium text-[var(--color-ns-accent)] no-underline hover:underline"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    All showcases
                  </a>
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section class="ns-container py-14">
        <h2 class="mb-2 text-2xl font-bold text-[var(--color-ns-text)]">
          Example routes
        </h2>
        <p class="mb-10 max-w-2xl text-[var(--color-ns-muted)]">
          Runnable demos and SEO pages live on the public
          <a
            :href="MARKETING"
            class="font-medium text-[var(--color-ns-accent)] no-underline hover:underline"
            target="_blank"
            rel="noopener noreferrer"
          >Narduk Charts site</a>
          (<code class="text-[var(--color-ns-text)]">/showcase/*</code>). Each card opens the matching route in a new tab.
        </p>
        <ul class="m-0 grid list-none gap-5 p-0 sm:grid-cols-2 lg:grid-cols-3">
          <li
            v-for="u in useCases"
            :key="u.href"
          >
            <a
              :href="u.href"
              target="_blank"
              rel="noopener noreferrer"
              class="ns-card block h-full no-underline transition-shadow hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ns-accent)]"
            >
              <span class="text-xs font-bold uppercase tracking-wide text-[var(--color-ns-accent)]">{{ u.tag }}</span>
              <h3 class="mt-2 text-lg font-bold text-[var(--color-ns-text)]">
                {{ u.title }}
              </h3>
              <p class="mt-2 text-sm leading-relaxed text-[var(--color-ns-muted)]">
                {{ u.desc }}
              </p>
              <span class="mt-4 inline-block text-sm font-semibold text-[var(--color-ns-accent)]">
                View example →
              </span>
            </a>
          </li>
        </ul>
      </section>

      <section class="border-t border-[var(--color-ns-border)] bg-[var(--color-ns-surface)] py-14">
        <div class="ns-container">
          <h2 class="mb-4 text-2xl font-bold text-[var(--color-ns-text)]">
            Quick start
          </h2>
          <pre class="overflow-x-auto rounded-lg border border-[var(--color-ns-border)] bg-slate-50 p-4 text-left text-sm leading-relaxed text-slate-800"><code>npm install @narduk-enterprises/narduk-charts vue</code></pre>
          <pre class="mt-4 overflow-x-auto rounded-lg border border-[var(--color-ns-border)] bg-slate-900 p-4 text-left text-sm leading-relaxed text-slate-100"><code>import { NardukLineChart } from '@narduk-enterprises/narduk-charts'
import '@narduk-enterprises/narduk-charts/style.css'</code></pre>
        </div>
      </section>
    </main>
    <SiteFooter />
  </div>
</template>
