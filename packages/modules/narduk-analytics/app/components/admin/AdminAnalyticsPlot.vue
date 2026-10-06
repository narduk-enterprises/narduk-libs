<script setup lang="ts">
import { computed } from 'vue'

import {
  adminAxisIndices,
  adminBarPercent,
  adminChartScale,
  adminIndexFromOffset,
  adminShownValue,
  adminSlotCentre,
  adminSlotInProgress,
  adminSlotLabel,
  adminStepIndex,
  adminTrendPolygon,
  adminValueY,
} from '../../utils/analyticsAdminChart'
import { adminFormatCount } from '../../utils/analyticsAdminRange'

import type { AdminChartBucket } from '../../utils/analyticsAdminChart'

/**
 * The drawn chart: bars or a trend, its axes, and the pointer and keyboard
 * reading. The reading itself is the `active` index, which the parent shows.
 */
const props = defineProps<{
  bucket: AdminChartBucket
  /** The drawn series' name, for the plot's accessible label. */
  label: string
  nowMs: number
  slots: Array<{ endMs: number; key: string; startMs: number }>
  tz: string
  /** Per-slot values; `null` is "not measured", never zero. */
  values: Array<number | null>
  view: 'bars' | 'trend'
}>()

const active = defineModel<number>('active', { required: true })

const scale = computed(() => adminChartScale(Math.max(0, ...props.values.map((v) => v ?? 0))))
const slotLabel = (index: number, style: 'axis' | 'full') => {
  const slot = props.slots[index]
  return slot ? adminSlotLabel(slot, props.bucket, props.tz, style) : ''
}

const bars = computed(() =>
  props.slots.map((slot, index) => ({
    gap: props.values[index] === null,
    height: adminBarPercent(props.values[index] ?? 0, scale.value.max),
    inProgress: adminSlotInProgress(slot, props.nowMs),
    key: slot.key,
  })),
)
const ticks = computed(() =>
  scale.value.ticks.map((tick) => ({
    bottom: `${(tick / scale.value.max) * 100}%`,
    text: adminFormatCount(tick),
    tick,
  })),
)
const xTicks = computed(() =>
  adminAxisIndices(props.slots.length, 6).map((index) => ({
    index,
    left: `${adminSlotCentre(index, props.slots.length)}%`,
    text: slotLabel(index, 'axis'),
  })),
)
const trendLine = computed(() => adminTrendPolygon(props.values, scale.value.max))
const trendFill = computed(() => adminTrendPolygon(props.values, scale.value.max, 2))
const dot = computed(() => {
  const value = props.values[active.value]
  if (value === null || value === undefined) return null
  return {
    left: `${adminSlotCentre(active.value, props.values.length)}%`,
    top: `${adminValueY(value, scale.value.max)}%`,
  }
})
const plotLabel = computed(
  () =>
    `${props.label} per ${props.bucket === '1d' ? 'day' : 'bucket'}. Use the arrow keys to read each one.`,
)
const valueText = computed(() =>
  active.value < 0
    ? undefined
    : `${slotLabel(active.value, 'full')}: ${adminShownValue(props.values[active.value])}`,
)

function pointer(event: PointerEvent) {
  const box = (event.currentTarget as HTMLElement).getBoundingClientRect()
  active.value = adminIndexFromOffset(event.clientX - box.left, box.width, props.slots.length)
}
function leave(event: PointerEvent) {
  if (event.pointerType === 'mouse') active.value = -1
}
function keydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    active.value = -1
    return
  }
  const next = adminStepIndex(event.key, active.value, props.slots.length)
  if (next === null) return
  event.preventDefault()
  active.value = next
}
</script>

<template>
  <div class="ne-an-chart">
    <div class="ne-an-yaxis" aria-hidden="true">
      <span
        v-for="item in ticks"
        :key="item.tick"
        class="ne-an-ytick"
        :style="{ bottom: item.bottom }"
      >
        {{ item.text }}
      </span>
    </div>
    <div
      class="ne-an-plot"
      role="slider"
      tabindex="0"
      :aria-label="plotLabel"
      aria-valuemin="1"
      :aria-valuemax="slots.length"
      :aria-valuenow="active >= 0 ? active + 1 : undefined"
      :aria-valuetext="valueText"
      @pointermove="pointer"
      @pointerdown="pointer"
      @pointerleave="leave"
      @keydown="keydown"
      @blur="active = -1"
    >
      <span
        v-for="item in ticks"
        :key="item.tick"
        class="ne-an-gridline"
        :style="{ bottom: item.bottom }"
      />
      <div v-if="view === 'bars'" class="ne-an-bars">
        <span
          v-for="(bar, index) in bars"
          :key="bar.key"
          class="ne-an-slot"
          :data-active="active === index"
          :data-open="bar.inProgress"
          :data-gap="bar.gap"
        >
          <span class="ne-an-bar" :style="{ height: `${bar.height}%` }" />
        </span>
      </div>
      <template v-else>
        <span class="ne-an-trend" :style="{ clipPath: trendLine }" />
        <span class="ne-an-trend ne-an-trend--fill" :style="{ clipPath: trendFill }" />
        <span v-if="dot" class="ne-an-dot" :style="dot" />
      </template>
    </div>
    <div class="ne-an-xaxis" aria-hidden="true">
      <span
        v-for="item in xTicks"
        :key="item.index"
        class="ne-an-xtick"
        :style="{ left: item.left }"
      >
        {{ item.text }}
      </span>
    </div>
  </div>
</template>
