<script setup lang="ts">
import { computed } from 'vue'

import MapkitInstrumentKey from './MapkitInstrumentKey.vue'

import type { InstrumentKey } from '@narduk-enterprises/narduk-mapkit/instrument-marks'

export interface MapkitScaleBand {
  color: string
  count: number | null
  label: string
  sub: string
}

export interface MapkitScaleLegendItem {
  kind: 'aging' | 'live' | 'pip' | 'stale' | 'void'
  label: string
  tag?: string
}

const props = withDefaults(
  defineProps<{
    bands?: MapkitScaleBand[]
    classLabels?: string[]
    description: string
    /** High end of the fixed range with its short unit, e.g. `35+ kt`. */
    hi?: string
    /** Specimens of what the lens draws, in place of the graduated dots. */
    instrumentKey?: InstrumentKey
    legend?: MapkitScaleLegendItem[]
    /** Low end of the fixed range with its short unit, e.g. `0 kt`. */
    lo?: string
    ramp?: string[]
    title: string
    unit?: string
    variant?: 'compact' | 'strip'
  }>(),
  {
    variant: 'strip',
  },
)

function edgeRadius(index: number, length: number, half: number): string {
  if (length <= 1) return `${half}px`
  if (index === 0) return `${half}px 0 0 ${half}px`
  if (index === length - 1) return `0 ${half}px ${half}px 0`
  return '0'
}

const radii = computed<string[]>(() => {
  const half = props.variant === 'compact' ? 4 : 5
  const length = props.bands?.length ?? props.ramp?.length ?? 0
  return Array.from({ length }, (_, index) => edgeRadius(index, length, half))
})

// One cell count drives every grid's track list and swatch style, whichever
// source (bands or ramp) is active — the strip and compact widget alike.
const cellStyles = computed(() => {
  const colors = props.bands?.map((band) => band.color) ?? props.ramp ?? []
  return colors.map((color, index) => ({
    borderRadius: radii.value[index] ?? '0',
    background: color,
  }))
})

/** An older reading's dashed outline is drawn in its ramp colour on the map. */
function keyStyle(kind: MapkitScaleLegendItem['kind']): Record<string, string> {
  const ramp = props.ramp ?? []
  const mid = ramp[Math.floor((ramp.length - 1) / 2)]
  return kind === 'stale' && mid ? { borderColor: mid } : {}
}

/** The fixed board range, falling back to the first/last class label. */
const range = computed(() => ({
  hi: props.hi ?? props.classLabels?.at(-1),
  lo: props.lo ?? props.classLabels?.[0],
}))

const trackStyle = computed(() => ({
  gridTemplateColumns: `repeat(${cellStyles.value.length}, minmax(0, 1fr))`,
}))
</script>

<template>
  <div v-if="variant === 'strip'" role="group" aria-label="Legend" class="scale-strip">
    <template v-if="bands && bands.length > 0">
      <span v-for="(band, index) in bands" :key="index" class="pill-item">
        <span class="pill-dot" :style="{ background: band.color }" />
        {{ band.label }}
      </span>
    </template>
    <template v-else>
      <MapkitInstrumentKey v-if="instrumentKey" :instrument-key="instrumentKey" />
      <span class="pill-range">
        <span>{{ range.lo }}</span
        ><span class="pill-arrow">→</span><span>{{ range.hi }}</span>
      </span>
      <span class="pill-divider" aria-hidden="true" />
      <span class="pill-ramp" :style="trackStyle">
        <span
          v-for="(color, index) in ramp ?? []"
          :key="index"
          class="swatch"
          :style="cellStyles[index]"
        />
      </span>
      <span v-if="unit && !hi" class="pill-unit">{{ unit }}</span>
      <template v-if="legend && legend.length > 0">
        <span class="pill-divider" aria-hidden="true" />
        <span v-for="item in legend" :key="item.kind" class="pill-item mk-key">
          <span
            class="mk-key-mark"
            :class="`mk-key-mark--${item.kind}`"
            aria-hidden="true"
            :style="keyStyle(item.kind)"
          />
          {{ item.label }}
        </span>
      </template>
    </template>

    <p class="mk-sr-only">{{ description }}</p>
  </div>

  <div v-else role="img" :aria-label="description" class="scale-strip scale-strip--compact">
    <span class="compact-label">
      <b>{{ title }}</b>
      <span v-if="unit">{{ unit }}</span>
    </span>
    <span class="compact-cells" aria-hidden="true" :style="trackStyle">
      <span v-for="(cell, index) in cellStyles" :key="index" class="compact-cell" :style="cell" />
    </span>
  </div>
</template>

<style scoped>
.scale-strip {
  box-sizing: border-box;
  font-family: var(--mk-font-sans);
}
.scale-strip:not(.scale-strip--compact) {
  /*
   * One 44 px pill (board `Main.dc.html`): dots + range/ramp/unit for the
   * value lenses, dot + label per band for the status lens. Content-sized,
   * not the old fixed-width title/legend panel.
   */
  height: 44px;
  padding: 0 14px;
  display: flex;
  align-items: center;
  gap: 14px;
  border-radius: var(--mk-radius-panel);
  background: var(--mk-surface);
  box-shadow: var(--mk-elev-2);
  white-space: nowrap;
}
.pill-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--mk-ink-2);
}
.pill-dot {
  width: 10px;
  height: 10px;
  flex: none;
  border-radius: 50%;
}
.pill-range {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: var(--mk-font-mono);
  font-size: 12px;
  color: var(--mk-ink-2);
}
.pill-arrow {
  color: var(--mk-ink-4);
}
.pill-divider {
  width: 1px;
  height: 20px;
  flex: none;
  background: var(--mk-line-faint);
}
.pill-ramp {
  display: grid;
  gap: 2px;
}
.swatch {
  width: 14px;
  height: 10px;
}
.pill-unit {
  font-size: 12px;
  color: var(--mk-ink-2);
}
.scale-strip--compact {
  width: 262px;
  height: 40px;
  padding: 0 10px;
  display: flex;
  align-items: center;
  gap: 10px;
  border-radius: 10px;
  background: var(--mk-surface);
  box-shadow: var(--mk-elev-2);
}
.compact-label {
  flex: none;
  min-width: 38px;
  display: flex;
  flex-direction: column;
  font-size: 13px;
  line-height: 15px;
}
.compact-label b {
  font-weight: 600;
  color: var(--mk-ink);
}
.compact-label span {
  color: var(--mk-ink-3);
}
.compact-cells {
  flex: 1 1 auto;
  min-width: 0;
  display: grid;
  gap: 1px;
}
.compact-cell {
  height: 8px;
}
</style>
