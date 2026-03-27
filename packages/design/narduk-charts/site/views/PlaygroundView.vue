<script setup lang="ts">
import { RouterLink } from 'vue-router'
import PlaygroundLab from '../../playground/App.vue'
</script>

<template>
  <div class="playground-route">
    <div
      class="sticky top-0 z-50 border-b border-[var(--color-ns-border)] bg-[var(--color-ns-surface)] px-4 py-2"
    >
      <RouterLink
        to="/"
        class="text-sm font-semibold text-[var(--color-ns-accent)] no-underline hover:underline"
      >
        ← Marketing site
      </RouterLink>
    </div>
    <p class="ns-container border-b border-[var(--color-ns-border)] py-3 text-sm text-[var(--color-ns-muted)]">
      The <strong class="font-semibold text-[var(--color-ns-text)]">OHLC</strong> tab demonstrates candle styles, drawing tools, timeframe resampling, price display modes, and a rolling candle buffer — same primitives as the AAPL and Trading marketing examples.
    </p>
    <PlaygroundLab />
  </div>
</template>
