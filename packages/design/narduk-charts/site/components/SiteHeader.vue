<script setup lang="ts">
import { RouterLink, useRoute } from 'vue-router'

const route = useRoute()

const examples = [
  { to: '/examples/aapl', label: 'AAPL' },
  { to: '/examples/trading', label: 'Trading' },
  { to: '/examples/line', label: 'Line' },
  { to: '/examples/bar', label: 'Bar' },
  { to: '/examples/pie', label: 'Pie' },
  { to: '/examples/scatter', label: 'Scatter' },
  { to: '/examples/histogram', label: 'Histogram' },
  { to: '/examples/streaming', label: 'Streaming' },
] as const

function navActive(path: string) {
  return route.path === path || route.path.startsWith(`${path}/`)
}
</script>

<template>
  <header
    class="sticky top-0 z-40 border-b border-[var(--color-ns-border)] bg-[var(--color-ns-surface)]/95 backdrop-blur-sm"
  >
    <div class="ns-container flex flex-wrap items-center justify-between gap-3 py-3">
      <div class="flex items-center gap-6">
        <RouterLink
          to="/"
          class="text-lg font-bold tracking-tight text-[var(--color-ns-text)] no-underline rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ns-accent)]"
        >
          Narduk Charts
        </RouterLink>
        <nav
          class="hidden flex-wrap gap-1 md:flex"
          aria-label="Examples"
        >
          <RouterLink
            v-for="ex in examples"
            :key="ex.to"
            :to="ex.to"
            class="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md px-2.5 py-2 text-sm font-medium no-underline transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ns-accent)]"
            :class="
              navActive(ex.to)
                ? 'bg-indigo-50 text-[var(--color-ns-accent)]'
                : 'text-[var(--color-ns-muted)] hover:bg-slate-50 hover:text-[var(--color-ns-text)]'
            "
          >
            {{ ex.label }}
          </RouterLink>
        </nav>
      </div>
      <div class="flex items-center gap-2">
        <RouterLink
          to="/playground"
          class="ns-btn ns-btn--ghost text-sm"
        >
          Playground
        </RouterLink>
        <a
          class="ns-btn ns-btn--ghost text-sm"
          href="https://github.com/narduk-enterprises/charts"
          target="_blank"
          rel="noopener noreferrer"
        >
          Product site
        </a>
        <a
          class="ns-btn ns-btn--primary text-sm"
          href="https://github.com/narduk-enterprises/narduk-charts"
          target="_blank"
          rel="noopener noreferrer"
        >
          Library repo
        </a>
      </div>
    </div>
    <div
      class="ns-container flex gap-1 overflow-x-auto pb-2 md:hidden"
      aria-label="Examples mobile"
    >
      <RouterLink
        v-for="ex in examples"
        :key="ex.to"
        :to="ex.to"
        class="inline-flex min-h-11 shrink-0 items-center rounded-full border border-[var(--color-ns-border)] px-3.5 py-2 text-xs font-medium no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ns-accent)]"
        :class="navActive(ex.to) ? 'border-indigo-300 bg-indigo-50 text-[var(--color-ns-accent)]' : 'text-[var(--color-ns-muted)]'"
      >
        {{ ex.label }}
      </RouterLink>
    </div>
  </header>
</template>
