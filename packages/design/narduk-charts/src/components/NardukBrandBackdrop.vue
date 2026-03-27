<script setup lang="ts">
/**
 * Full-bleed decorative SVG: chart grid, polylines, and candle hints.
 * Uses `chart.css` tokens so it tracks app theming — no bitmap assets.
 */
const vbW = 1200
const vbH = 640
</script>

<template>
  <div
    class="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
    aria-hidden="true"
  >
    <svg
      class="h-full w-full min-h-[min(420px,50vh)]"
      :viewBox="`0 0 ${vbW} ${vbH}`"
      preserveAspectRatio="xMidYMid slice"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient
          id="narduk-brand-backdrop-fade"
          x1="0"
          y1="0"
          x2="0"
          y2="1"
        >
          <stop
            offset="0%"
            stop-color="var(--color-chart-surface)"
            stop-opacity="0"
          />
          <stop
            offset="100%"
            stop-color="var(--color-chart-surface)"
            stop-opacity="0.92"
          />
        </linearGradient>
        <pattern
          id="narduk-brand-grid"
          width="40"
          height="40"
          patternUnits="userSpaceOnUse"
        >
          <path
            d="M 40 0 L 0 0 0 40"
            fill="none"
            stroke="var(--color-chart-grid)"
            stroke-width="0.75"
            opacity="0.65"
          />
        </pattern>
        <pattern
          id="narduk-brand-grid-major"
          width="200"
          height="200"
          patternUnits="userSpaceOnUse"
        >
          <path
            d="M 200 0 L 0 0 0 200"
            fill="none"
            stroke="var(--color-chart-axis)"
            stroke-width="1"
            opacity="0.45"
          />
        </pattern>
      </defs>

      <rect
        :width="vbW"
        :height="vbH"
        fill="var(--color-chart-plot-tint)"
      />
      <rect
        :width="vbW"
        :height="vbH"
        fill="url(#narduk-brand-grid-major)"
        opacity="0.35"
      />
      <rect
        :width="vbW"
        :height="vbH"
        fill="url(#narduk-brand-grid)"
        opacity="0.4"
      />

      <circle
        cx="200"
        cy="100"
        r="260"
        fill="var(--color-chart-accent)"
        opacity="0.06"
      />
      <circle
        cx="960"
        cy="60"
        r="300"
        fill="var(--color-chart-accent)"
        opacity="0.045"
      />

      <g
        fill="none"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <polyline
          points="40,420 120,380 200,400 280,340 360,360 440,300 520,320 600,260 680,280 760,220 840,240 920,190 1000,210 1080,160 1160,180"
          stroke="var(--color-chart-accent)"
          stroke-width="3"
          opacity="0.35"
        />
        <polyline
          points="40,480 140,440 220,460 300,400 400,420 500,360 580,380 660,330 760,350 860,300 960,320 1060,270 1160,290"
          stroke="var(--color-chart-muted)"
          stroke-width="2.75"
          opacity="0.45"
        />
      </g>

      <g stroke="var(--color-chart-axis)">
        <line
          x1="902"
          y1="200"
          x2="902"
          y2="248"
          stroke-width="1.2"
          opacity="0.5"
        />
        <rect
          x="894"
          y="212"
          width="16"
          height="28"
          rx="2"
          fill="var(--color-chart-up)"
          fill-opacity="0.22"
          stroke="none"
        />
        <line
          x1="942"
          y1="188"
          x2="942"
          y2="256"
          stroke-width="1.2"
          opacity="0.5"
        />
        <rect
          x="934"
          y="218"
          width="16"
          height="32"
          rx="2"
          fill="var(--color-chart-down)"
          fill-opacity="0.2"
          stroke="none"
        />
      </g>

      <rect
        :width="vbW"
        :height="vbH"
        fill="url(#narduk-brand-backdrop-fade)"
      />
    </svg>
  </div>
</template>
