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
const labelX = computed(() => plotRight.value - 76)

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
  },
  {
    key: 'open',
    label: 'OPEN',
    y: props.metrics.priceYFromRaw(props.sessionOpen),
    lineClass: 'td-overlay__line td-overlay__line--open',
    tagClass: 'td-overlay__tag td-overlay__tag--open',
  },
])
</script>

<template>
  <g class="td-overlay" pointer-events="none">
    <rect
      v-if="openingBand.height > 0"
      class="td-overlay__opening-band"
      :x="plotLeft"
      :y="openingBand.y"
      :width="plotWidth"
      :height="openingBand.height"
      rx="10"
    />
    <text
      v-if="openingBand.height > 0"
      class="td-overlay__caption"
      :x="plotLeft + 12"
      :y="Math.max(props.metrics.padding.top + 16, openingBand.y + 14)"
    >
      Opening range
    </text>

    <g
      v-for="line in overlayLines"
      :key="line.key"
    >
      <line
        :class="line.lineClass"
        :x1="plotLeft"
        :x2="plotRight"
        :y1="line.y"
        :y2="line.y"
      />
      <rect
        :class="line.tagClass"
        :x="labelX"
        :y="line.y - 9"
        width="60"
        height="18"
        rx="9"
      />
      <text
        class="td-overlay__tag-text"
        :x="labelX + 30"
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
  fill: rgba(99, 102, 241, 0.08);
  stroke: rgba(129, 140, 248, 0.24);
  stroke-dasharray: 8 8;
}

.td-overlay__caption {
  fill: rgba(165, 180, 252, 0.95);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.td-overlay__line {
  stroke-width: 1.15;
  stroke-dasharray: 6 6;
}

.td-overlay__line--vwap {
  stroke: rgba(45, 212, 191, 0.92);
}

.td-overlay__line--open {
  stroke: rgba(148, 163, 184, 0.74);
}

.td-overlay__tag {
  stroke-width: 1;
}

.td-overlay__tag--vwap {
  fill: rgba(15, 23, 42, 0.86);
  stroke: rgba(45, 212, 191, 0.44);
}

.td-overlay__tag--open {
  fill: rgba(15, 23, 42, 0.82);
  stroke: rgba(148, 163, 184, 0.3);
}

.td-overlay__tag-text {
  fill: rgba(248, 250, 252, 0.95);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.08em;
}
</style>
