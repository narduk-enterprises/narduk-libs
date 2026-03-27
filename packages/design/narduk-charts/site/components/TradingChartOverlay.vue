<script setup lang="ts">
import { computed } from 'vue'
import type { CandlePlotMetrics } from 'narduk-charts'

const props = defineProps<{
  metrics: CandlePlotMetrics
  vwap: number
  sessionOpen: number
  openingRangeHigh: number
  openingRangeLow: number
}>()

const plotLeft = computed(() => props.metrics.padding.left)
const plotRight = computed(() => props.metrics.chartWidth - props.metrics.padding.right)
const plotWidth = computed(() => props.metrics.plotWidth)
const tagX = computed(() => plotRight.value - 72)

const openingBand = computed(() => {
  const high = props.metrics.priceYFromRaw(props.openingRangeHigh)
  const low = props.metrics.priceYFromRaw(props.openingRangeLow)
  return {
    y: Math.min(high, low),
    height: Math.max(0, Math.abs(low - high)),
  }
})

const overlayLines = computed(() => [
  {
    key: 'vwap',
    label: 'VWAP',
    y: props.metrics.priceYFromRaw(props.vwap),
    lineClass: 'td-overlay__line td-overlay__line--vwap',
    tagClass: 'td-overlay__tag td-overlay__tag--vwap',
    textClass: 'td-overlay__tag-text td-overlay__tag-text--vwap',
  },
  {
    key: 'open',
    label: 'OPEN',
    y: props.metrics.priceYFromRaw(props.sessionOpen),
    lineClass: 'td-overlay__line td-overlay__line--open',
    tagClass: 'td-overlay__tag td-overlay__tag--open',
    textClass: 'td-overlay__tag-text',
  },
])
</script>

<template>
  <g class="td-overlay" pointer-events="none">
    <g
      v-if="openingBand.height > 0"
      role="img"
      aria-label="Opening range"
    >
      <rect
        class="td-overlay__opening-band"
        :x="plotLeft"
        :y="openingBand.y"
        :width="plotWidth"
        :height="openingBand.height"
        rx="12"
      />
      <text
        class="td-overlay__caption"
        :x="plotLeft + 10"
        :y="Math.max(props.metrics.padding.top + 16, openingBand.y + 13)"
        aria-hidden="true"
      >
        OR
      </text>
    </g>

    <g
      v-for="line in overlayLines"
      :key="line.key"
    >
      <line
        :class="line.lineClass"
        :x1="plotLeft"
        :x2="plotRight - 76"
        :y1="line.y"
        :y2="line.y"
      />
      <rect
        :class="line.tagClass"
        :x="tagX"
        :y="line.y - 10"
        width="64"
        height="20"
        rx="10"
      />
      <text
        :class="line.textClass"
        :x="tagX + 32"
        :y="line.y"
        text-anchor="middle"
        dominant-baseline="middle"
      >
        {{ line.label }}
      </text>
    </g>
  </g>
</template>

<style scoped>
.td-overlay__opening-band {
  fill: rgba(99, 102, 241, 0.06);
  stroke: rgba(129, 140, 248, 0.2);
  stroke-dasharray: 6 8;
  stroke-width: 1;
}

.td-overlay__caption {
  fill: rgba(165, 180, 252, 0.75);
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.td-overlay__line {
  stroke-width: 1;
  stroke-dasharray: 5 6;
  stroke-linecap: round;
}

.td-overlay__line--vwap {
  stroke: rgba(45, 212, 191, 0.85);
  filter: drop-shadow(0 0 4px rgba(45, 212, 191, 0.35));
}

.td-overlay__line--open {
  stroke: rgba(148, 163, 184, 0.6);
}

.td-overlay__tag {
  stroke-width: 1;
}

.td-overlay__tag--vwap {
  fill: rgba(6, 30, 28, 0.9);
  stroke: rgba(45, 212, 191, 0.5);
  filter: drop-shadow(0 2px 8px rgba(45, 212, 191, 0.2));
}

.td-overlay__tag--open {
  fill: rgba(15, 20, 36, 0.85);
  stroke: rgba(100, 116, 139, 0.28);
}

.td-overlay__tag-text {
  fill: rgba(203, 213, 225, 0.92);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.09em;
}

.td-overlay__tag-text--vwap {
  fill: rgba(94, 234, 212, 0.96);
}
</style>
