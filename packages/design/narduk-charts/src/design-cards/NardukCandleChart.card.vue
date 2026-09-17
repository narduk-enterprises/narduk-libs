<script setup lang="ts">
/*
 * NE Base design card for NardukCandleChart — components backlog item 22
 * (narduk-libs#269). See NardukLineChart.card.vue for why this is not yet
 * wired into design-system-build's gallery.
 */
import NardukCandleChart from '../components/NardukCandleChart.vue'

import type { CandleBar } from '../types'

const start = Date.UTC(2026, 4, 14, 20, 0)
const bars: CandleBar[] = Array.from({ length: 24 }, (_, i) => {
  const base = 100 + Math.sin(i / 4) * 3
  return {
    t: start + i * 60 * 60 * 1000,
    o: base,
    h: base + 2,
    l: base - 2,
    c: base + 0.5,
  }
})
</script>

<template>
  <section
    class="preview-card"
    data-design-card="narduk-candle-chart"
    data-name="Candle chart"
    data-group="Charts"
  >
    <h2>Candle chart</h2>
    <p>
      OHLCV time-series with zoom, volume and domain sync. Default time labels are
      <code>en-US</code> in <code>UTC</code> so SSR and the browser agree.
    </p>
    <div class="preview-row">
      <NardukCandleChart :bars="bars" :width="420" :height="220" :animate="false" />
    </div>
  </section>
</template>
