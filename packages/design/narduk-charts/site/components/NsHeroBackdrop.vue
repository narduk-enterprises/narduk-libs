<script setup lang="ts">
/**
 * Parametric hero backdrop: chart grid + sparklines in SVG (no bitmaps).
 * Coordinates are viewBox-local; scales with the hero section.
 */
const vbW = 1200
const vbH = 640
</script>

<template>
  <div
    class="pointer-events-none absolute inset-0 z-0 overflow-hidden"
    aria-hidden="true"
  >
    <svg
      class="h-full w-full min-h-[420px]"
      :viewBox="`0 0 ${vbW} ${vbH}`"
      preserveAspectRatio="xMidYMid slice"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient
          id="ns-hero-fade"
          x1="0"
          y1="0"
          x2="0"
          y2="1"
        >
          <stop
            offset="0%"
            stop-color="white"
            stop-opacity="0"
          />
          <stop
            offset="100%"
            stop-color="white"
            stop-opacity="0.85"
          />
        </linearGradient>
        <pattern
          id="ns-hero-grid"
          width="40"
          height="40"
          patternUnits="userSpaceOnUse"
        >
          <path
            d="M 40 0 L 0 0 0 40"
            fill="none"
            stroke="currentColor"
            stroke-width="0.75"
            opacity="0.35"
          />
        </pattern>
        <pattern
          id="ns-hero-grid-major"
          width="200"
          height="200"
          patternUnits="userSpaceOnUse"
        >
          <path
            d="M 200 0 L 0 0 0 200"
            fill="none"
            stroke="currentColor"
            stroke-width="1.1"
            opacity="0.5"
          />
        </pattern>
      </defs>
      <!-- Base wash -->
      <rect
        :width="vbW"
        :height="vbH"
        fill="#f8fafc"
      />
      <g
        class="text-[var(--color-ns-accent)]"
        opacity="0.11"
      >
        <rect
          :width="vbW"
          :height="vbH"
          fill="url(#ns-hero-grid-major)"
        />
        <rect
          :width="vbW"
          :height="vbH"
          fill="url(#ns-hero-grid)"
        />
      </g>
      <!-- Soft cyan / indigo fields (built from shapes, not photos) -->
      <circle
        cx="180"
        cy="120"
        r="280"
        fill="#06b6d4"
        opacity="0.07"
      />
      <circle
        cx="980"
        cy="80"
        r="320"
        fill="#6366f1"
        opacity="0.06"
      />
      <circle
        cx="720"
        cy="520"
        r="260"
        fill="#0891b2"
        opacity="0.05"
      />
      <!-- Abstract “series” polylines (same vocabulary as the library) -->
      <g
        fill="none"
        stroke-width="3.2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <polyline
          points="40,420 120,380 200,400 280,340 360,360 440,300 520,320 600,260 680,280 760,220 840,240 920,190 1000,210 1080,160 1160,180"
          stroke="#0891b2"
          opacity="0.45"
        />
        <polyline
          points="40,480 140,440 220,460 300,400 400,420 500,360 580,380 660,330 760,350 860,300 960,320 1060,270 1160,290"
          stroke="#6366f1"
          opacity="0.4"
        />
      </g>
      <!-- Mini candlesticks: rects + wicks (decorative) -->
      <g
        stroke="#0f172a"
        stroke-opacity="0.12"
        stroke-width="1.2"
      >
        <line
          x1="902"
          y1="200"
          x2="902"
          y2="248"
        />
        <rect
          x="894"
          y="212"
          width="16"
          height="28"
          rx="2"
          fill="#22c55e"
          fill-opacity="0.2"
          stroke="none"
        />
        <line
          x1="942"
          y1="188"
          x2="942"
          y2="256"
        />
        <rect
          x="934"
          y="218"
          width="16"
          height="32"
          rx="2"
          fill="#ef4444"
          fill-opacity="0.18"
          stroke="none"
        />
        <line
          x1="982"
          y1="205"
          x2="982"
          y2="252"
        />
        <rect
          x="974"
          y="220"
          width="16"
          height="22"
          rx="2"
          fill="#22c55e"
          fill-opacity="0.2"
          stroke="none"
        />
      </g>
      <!-- Bottom fade so content stays readable -->
      <rect
        :width="vbW"
        :height="vbH"
        fill="url(#ns-hero-fade)"
      />
    </svg>
  </div>
</template>
