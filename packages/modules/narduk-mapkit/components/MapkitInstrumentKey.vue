<script setup lang="ts">
import type { InstrumentKey } from '@narduk-enterprises/narduk-mapkit/instrument-marks'

/**
 * A legend key drawn as the instruments themselves: each specimen is the same
 * layer stack a map mark paints -- a hairline track, the instrument, then the
 * dot -- laid along one strip. Every path and colour arrives in the key, so
 * this component names no reading (#232's rule for the ramp swatches, applied
 * to the shapes that replaced them).
 */
defineProps<{ instrumentKey: InstrumentKey }>()

const INSTRUMENT_KEY_HEIGHT = 18
</script>

<template>
  <svg
    aria-hidden="true"
    class="key"
    :height="INSTRUMENT_KEY_HEIGHT"
    :viewBox="`0 0 ${instrumentKey.width} ${INSTRUMENT_KEY_HEIGHT}`"
    :width="instrumentKey.width"
  >
    <g
      v-for="(mark, index) in instrumentKey.marks"
      :key="index"
      :transform="`translate(${mark.x} ${INSTRUMENT_KEY_HEIGHT / 2})`"
    >
      <path v-if="mark.track" class="track" :d="mark.track" />
      <path
        v-if="mark.body"
        class="body"
        :d="mark.body"
        :fill="mark.bodyFill"
        :stroke="mark.bodyStroke"
        :stroke-width="mark.bodyWidth"
      />
      <circle class="dot" :fill="mark.dotFill" :r="mark.dotRadius" />
    </g>
  </svg>
</template>

<style scoped>
.key {
  display: block;
  flex: none;
  overflow: visible;
}

.track {
  fill: none;
  stroke: rgb(14 20 24 / 0.22);
  stroke-width: 1.2;
}

.body {
  stroke-linecap: round;
  stroke-linejoin: round;
}

.dot {
  stroke: #ffffff;
  stroke-width: 1.2;
}
</style>
