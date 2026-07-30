<script setup lang="ts">
/**
 * Chart 01 — Level well.
 *
 * A recessed well with a machined tick edge at 10% intervals and a dashed
 * long-term median. Percent of conservation pool for a reservoir, but the shape
 * generalises to any bounded level.
 *
 * `median` is required for the same reason `band` is required on NsRangeBar: a
 * fill with nothing to compare against is decoration. Missing wells are hatched
 * with an em-dash, never rendered empty — an empty well reads as "zero", which
 * is a measurement we do not have.
 */
import { computed } from "vue";

import { formatValue, MISSING, positionPercent } from "../_core/measure";

const props = withDefaults(
  defineProps<{
    decimals?: number;
    max?: number;
    /** Long-term median for this station, drawn as the dashed reference. */
    median: number;
    /** Label for the dashed line, e.g. "MED" or "30-YR". */
    medianLabel?: string;
    min?: number;
    missingReason?: string;
    name?: string;
    unit?: string;
    value: number | null | undefined;
  }>(),
  { min: 0, max: 100, decimals: 1, medianLabel: "MED", unit: "%" },
);

const present = computed(() => props.value != null && Number.isFinite(props.value));
const fillPercent = computed(() =>
  present.value ? positionPercent(props.value as number, props.min, props.max) : 0,
);
const medianPercent = computed(() => positionPercent(props.median, props.min, props.max));
const readout = computed(() =>
  present.value
    ? formatValue(props.value, { decimals: props.decimals }) + (props.unit ?? "")
    : MISSING,
);

const description = computed(() =>
  present.value
    ? `${readout.value}, median ${props.median}${props.unit ?? ""}`
    : props.missingReason || "Not published",
);
</script>

<template>
  <div class="ns-well" :class="{ 'ns-well--missing': !present }">
    <div class="ns-well__body" role="img" :aria-label="description">
      <template v-if="present">
        <span class="ns-well__fill" :style="{ height: `${fillPercent}%` }" />
        <span class="ns-well__median" :style="{ bottom: `${medianPercent}%` }" />
        <span class="ns-well__median-label" :style="{ bottom: `calc(${medianPercent}% + 2px)` }">
          {{ medianLabel }}
        </span>
        <!-- Machined tick edge at 10% intervals. -->
        <span class="ns-well__ticks" aria-hidden="true" />
      </template>
      <span v-else class="ns-well__hatch">{{ MISSING }}</span>
    </div>

    <span class="ns-well__value">{{ readout }}</span>
    <span v-if="name" class="ns-well__name">{{ name }}</span>
  </div>
</template>

<style scoped>
.ns-well {
  display: grid;
  gap: 10px;
  justify-items: center;
  min-width: 0;
}

.ns-well__body {
  position: relative;
  width: 100%;
  height: var(--ns-well-height, 168px);
  border-radius: var(--ns-r-sm);
  background: var(--ns-sunk);
  box-shadow: var(--ns-well);
  overflow: hidden;
}

.ns-well__fill {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  background: linear-gradient(0deg, var(--ns-accent-deep), var(--ns-accent));
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.5);
}

.ns-well__median {
  position: absolute;
  right: 0;
  left: 0;
  height: 0;
  border-top: 1px dashed rgb(14 20 24 / 0.38);
}

.ns-well__median-label {
  position: absolute;
  right: 3px;
  font-family: var(--ns-font-mono);
  font-size: 8.5px;
  letter-spacing: 0.06em;
  color: var(--ns-text);
}

.ns-well__ticks {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: 5px;
  background-image: repeating-linear-gradient(
    to bottom,
    rgb(14 20 24 / 0.18) 0 1px,
    transparent 1px 10%
  );
}

.ns-well__hatch {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  background-image: var(--ns-hatch);
  font-family: var(--ns-font-mono);
  font-size: 20px;
  color: var(--ns-void);
}

.ns-well__value {
  font-family: var(--ns-font-mono);
  font-size: 13px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--ns-ink-2);
}

.ns-well--missing .ns-well__value {
  font-weight: 500;
  color: var(--ns-void);
}

.ns-well__name {
  width: 100%;
  overflow: hidden;
  font-family: var(--ns-font-text);
  font-size: 12px;
  font-weight: 500;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ns-text);
}
</style>
