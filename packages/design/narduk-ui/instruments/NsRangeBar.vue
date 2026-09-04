<script setup lang="ts">
/**
 * Chart 02 — Range bar.
 *
 * The design system's answer to "charts that don't make sense": every value is
 * shown against a reference. The shaded band is what normal looks like for this
 * station in this month; the marker is now. A bare progress bar tells you a
 * reservoir is 47% full, which is not information until you know that 55-88% is
 * normal for July.
 *
 * `band` is required, not optional. A range bar without a reference is exactly
 * the progress bar this component exists to retire — so the type system stops
 * you rather than rendering a misleading one.
 *
 * Missing values keep an identical footprint and take the hatch material, so a
 * directory does not reflow as data arrives.
 */
import { computed } from "vue";

import { type Band, bandGeometry, formatValue, MISSING, positionPercent } from "../_core/measure";

const props = withDefaults(
  defineProps<{
    /** The reference this value is read against. Required by design. */
    band: Band;
    decimals?: number;
    /** Optional forecast peak, drawn as a hollow marker. */
    forecast?: number | null;
    label?: string;
    max?: number;
    min?: number;
    /** Why the value is missing. Required reading when value is null. */
    missingReason?: string;
    unit?: string;
    /** The current observation. Null renders the missing variant. */
    value: number | null | undefined;
  }>(),
  { min: 0, max: 100, decimals: 1 },
);

defineOptions({ inheritAttrs: false });

const present = computed(() => props.value != null && Number.isFinite(props.value));

const geometry = computed(() => bandGeometry(props.band, props.min, props.max));
const valuePercent = computed(() =>
  present.value ? positionPercent(props.value as number, props.min, props.max) : 0,
);
const forecastPercent = computed(() =>
  props.forecast != null && Number.isFinite(props.forecast)
    ? positionPercent(props.forecast, props.min, props.max)
    : null,
);

const readout = computed(() =>
  present.value
    ? formatValue(props.value, { decimals: props.decimals, unit: props.unit })
    : MISSING,
);

const description = computed(() => {
  if (!present.value) return props.missingReason || "Not published";
  const band = `${props.band.low}–${props.band.high}`;
  const where =
    (props.value as number) < props.band.low
      ? "below"
      : (props.value as number) > props.band.high
        ? "above"
        : "within";
  return `${readout.value}, ${where} the ${props.band.label ?? "normal"} band of ${band}`;
});
</script>

<template>
  <div v-bind="$attrs" class="ns-range" :class="{ 'ns-range--missing': !present }">
    <span v-if="label" class="ns-range__label">{{ label }}</span>

    <div class="ns-range__track" role="img" :aria-label="description">
      <span
        class="ns-range__band"
        :style="{ left: `${geometry.leftPercent}%`, width: `${geometry.widthPercent}%` }"
      />
      <template v-if="present">
        <span class="ns-range__fill" :style="{ width: `${valuePercent}%` }" />
        <span
          v-if="forecastPercent !== null"
          class="ns-range__forecast"
          :style="{ left: `${forecastPercent}%` }"
        />
        <span class="ns-range__marker" :style="{ left: `${valuePercent}%` }" />
      </template>
      <span v-else class="ns-range__hatch" />
    </div>

    <span class="ns-range__value">{{ readout }}</span>
  </div>

  <p v-if="!present && missingReason" class="ns-range__reason">{{ missingReason }}</p>
</template>

<style scoped>
.ns-range {
  display: grid;
  grid-template-columns: var(--ns-range-label, 108px) 1fr var(--ns-range-value, 72px);
  gap: 14px;
  align-items: center;
}

.ns-range__label {
  font-family: var(--ns-font-text);
  font-size: 12.5px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* The recessed well. Depth comes from the inset shadow, not from a border. */
.ns-range__track {
  position: relative;
  height: 18px;
  border-radius: var(--ns-r-xs);
  background: var(--ns-sunk);
  box-shadow: var(--ns-well);
}

.ns-range__band {
  position: absolute;
  top: 0;
  bottom: 0;
  background: color-mix(in oklab, var(--ns-accent) 18%, var(--ns-surface));
  box-shadow: inset 0 0 0 1px rgb(14 20 24 / 0.05);
}

.ns-range__fill {
  position: absolute;
  top: 50%;
  left: 0;
  height: 3px;
  transform: translateY(-50%);
  border-radius: 2px;
  background: var(--ns-accent);
}

/* Now. Ink, not accent — the reading is structure, the band is data ink. */
.ns-range__marker {
  position: absolute;
  top: -2px;
  bottom: -2px;
  width: 3px;
  border-radius: 2px;
  background: var(--ns-ink-2);
  box-shadow: 0 0 0 2px rgb(255 255 255 / 0.9);
  transform: translateX(-1.5px);
}

/* Forecast peak reads as provisional: hollow, never solid. */
.ns-range__forecast {
  position: absolute;
  top: 1px;
  bottom: 1px;
  width: 3px;
  border-radius: 2px;
  background: var(--ns-surface);
  box-shadow: inset 0 0 0 1.5px var(--ns-ink-3);
  transform: translateX(-1.5px);
}

.ns-range__hatch {
  position: absolute;
  inset: 0;
  border-radius: var(--ns-r-xs);
  background-image: var(--ns-hatch);
}

.ns-range__value {
  font-family: var(--ns-font-mono);
  font-size: 12.5px;
  font-weight: 600;
  text-align: right;
  font-variant-numeric: tabular-nums;
  color: var(--ns-ink-2);
}

.ns-range--missing .ns-range__value {
  color: var(--ns-void);
  font-weight: 500;
}

.ns-range__reason {
  margin: 4px 0 0;
  font-family: var(--ns-font-mono);
  font-size: 10.5px;
  line-height: 1.6;
  color: var(--ns-text-mute);
}
</style>
