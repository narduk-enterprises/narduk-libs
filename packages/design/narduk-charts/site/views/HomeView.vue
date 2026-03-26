<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { NardukCandleChart, useChartFullscreen } from 'narduk-charts'
import type { CandleBar } from 'narduk-charts'
import SiteHeader from '../components/SiteHeader.vue'
import SiteFooter from '../components/SiteFooter.vue'

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

function formatHeroTime(ms: number) {
  const d = new Date(ms)
  return d.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
    day: 'numeric',
  })
}

const useCases = [
  {
    to: '/examples/aapl',
    title: 'AAPL flagship demo',
    desc: 'Real-time AAPL candles from the Stonx stream. Linked panes, RSI study, volume, brush, drawings, and crosshair — best showcase of every advanced feature.',
    tag: 'Flagship',
  },
  {
    to: '/examples/trading',
    title: 'Trading & OHLC',
    desc: 'Dual synced panes, live stream, volume, brush, pinch zoom, domain lock — pro-terminal patterns.',
    tag: 'Markets',
  },
  {
    to: '/examples/line',
    title: 'Line & trends',
    desc: 'Multi-series, dual Y, zoom, annotations, log scale, and live streaming.',
    tag: 'Analytics',
  },
  {
    to: '/examples/bar',
    title: 'Bar & composition',
    desc: 'Grouped and stacked bars, reference lines, and Y-band guides.',
    tag: 'Reporting',
  },
  {
    to: '/examples/pie',
    title: 'Pie & donut',
    desc: 'Part-to-whole breakdowns with keyboard-accessible slices.',
    tag: 'Dashboards',
  },
  {
    to: '/examples/scatter',
    title: 'Scatter & correlation',
    desc: 'Numeric X/Y with multiple series and clean axes.',
    tag: 'Science',
  },
  {
    to: '/examples/histogram',
    title: 'Histogram',
    desc: 'Distribution of values with adjustable bins.',
    tag: 'Stats',
  },
  {
    to: '/examples/streaming',
    title: 'Live metrics',
    desc: 'Rolling window with useStreamingSeries — ideal for IoT and ops.',
    tag: 'Realtime',
  },
] as const

const heroStats = [
  {
    label: 'Flagship surface',
    value: 'Trading-grade OHLC',
    copy: 'Linked panes, brush navigation, streaming candles, and drawing overlays.',
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
    <main class="flex-1">
      <section class="relative overflow-hidden border-b border-[var(--color-ns-border)]">
        <div
          class="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(49,88,255,0.18),transparent_34%),radial-gradient(circle_at_85%_14%,rgba(8,145,178,0.14),transparent_24%),linear-gradient(180deg,rgba(255,255,255,0.82),rgba(243,245,251,0.62))]"
        />
        <div class="ns-container py-16 md:py-24">
          <div class="grid items-center gap-10 lg:grid-cols-2 lg:gap-12">
            <div class="min-w-0 relative">
              <p class="mb-3 text-sm font-semibold uppercase tracking-[0.14em] text-[var(--color-ns-accent)]">
                Vue 3 · SVG · TypeScript
              </p>
              <h1 class="max-w-3xl text-4xl font-extrabold tracking-tight text-[var(--color-ns-text)] md:text-5xl md:leading-tight">
                Charts that feel at home in your product
              </h1>
              <p class="mt-5 max-w-2xl text-lg text-[var(--color-ns-muted)]">
                Accessible, themeable components with tooltips, export helpers, and optional per-chart bundles.
                <strong class="font-semibold text-[var(--color-ns-text)]">Trading charts</strong> include synced viewports, streaming candles, and depth-friendly zoom.
              </p>
              <div class="mt-8 flex flex-wrap gap-3">
                <RouterLink
                  to="/examples/aapl"
                  class="ns-btn ns-btn--primary"
                >
                  See AAPL live demo
                </RouterLink>
                <RouterLink
                  to="/examples/trading"
                  class="ns-btn ns-btn--ghost"
                >
                  See trading charts
                </RouterLink>
                <RouterLink
                  to="/playground"
                  class="ns-btn ns-btn--ghost"
                >
                  Open playground
                </RouterLink>
                <a
                  class="ns-btn ns-btn--ghost"
                  href="https://github.com/narduk-enterprises/narduk-charts"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  View on GitHub
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
                      Live preview
                    </p>
                    <p class="mt-1 m-0 text-sm font-medium text-[var(--color-ns-text)]">
                      OHLC chart · volume · navigator
                    </p>
                  </div>
                  <button
                    type="button"
                    class="ns-btn ns-btn--ghost ns-btn--compact shrink-0"
                    :aria-pressed="heroFullscreen"
                    @click="toggleHeroFullscreen"
                  >
                    {{ heroFullscreen ? 'Exit full screen' : 'Full screen' }}
                  </button>
                </div>
                <NardukCandleChart
                  chart-description="Pinch or scroll to zoom. Shift-drag to pan, or drag on the plot to zoom a range."
                  :bars="heroCandleBars"
                  :height="heroChartHeight"
                  class="w-full min-w-0"
                  :zoomable="true"
                  :zoom-wheel-free="true"
                  :show-volume="true"
                  :volume-fraction="0.17"
                  :show-brush="true"
                  :max-draw-bars="256"
                  :show-session-grid="true"
                  :format-time="formatHeroTime"
                />
                <p class="mt-3 text-center text-xs text-[var(--color-ns-muted)]">
                  <RouterLink
                    to="/examples/trading"
                    class="font-medium text-[var(--color-ns-accent)] no-underline hover:underline"
                  >
                    Full trading example
                  </RouterLink>
                  — RSI, linked panes, drawings, log scale.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section class="ns-container py-14">
        <h2 class="mb-2 text-2xl font-bold text-[var(--color-ns-text)]">
          Examples by use case
        </h2>
        <p class="mb-10 max-w-2xl text-[var(--color-ns-muted)]">
          Each page is a minimal, copy-paste-friendly setup. The playground adds every control in one place.
        </p>
        <ul class="m-0 grid list-none gap-5 p-0 sm:grid-cols-2 lg:grid-cols-3">
          <li
            v-for="u in useCases"
            :key="u.to"
          >
            <RouterLink
              :to="u.to"
              class="ns-card block h-full no-underline transition-shadow hover:shadow-md"
            >
              <span class="text-xs font-bold uppercase tracking-wide text-indigo-600">{{ u.tag }}</span>
              <h3 class="mt-2 text-lg font-bold text-[var(--color-ns-text)]">
                {{ u.title }}
              </h3>
              <p class="mt-2 text-sm leading-relaxed text-[var(--color-ns-muted)]">
                {{ u.desc }}
              </p>
              <span class="mt-4 inline-block text-sm font-semibold text-[var(--color-ns-accent)]">
                View example →
              </span>
            </RouterLink>
          </li>
        </ul>
      </section>

      <section class="border-t border-[var(--color-ns-border)] bg-[var(--color-ns-surface)] py-14">
        <div class="ns-container">
          <h2 class="mb-4 text-2xl font-bold text-[var(--color-ns-text)]">
            Quick start
          </h2>
          <pre class="overflow-x-auto rounded-lg border border-[var(--color-ns-border)] bg-slate-50 p-4 text-left text-sm leading-relaxed text-slate-800"><code>npm install narduk-charts vue</code></pre>
          <pre class="mt-4 overflow-x-auto rounded-lg border border-[var(--color-ns-border)] bg-slate-900 p-4 text-left text-sm leading-relaxed text-slate-100"><code>import { NardukLineChart } from 'narduk-charts'
import 'narduk-charts/style.css'</code></pre>
        </div>
      </section>
    </main>
    <SiteFooter />
  </div>
</template>
