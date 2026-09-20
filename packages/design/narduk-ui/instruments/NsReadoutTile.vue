<script setup lang="ts">
/**
 * The readout tile: label above, value in mono, change below.
 *
 * The rule that matters here is footprint. The missing variant must occupy
 * exactly the same space as the present one — same padding, same line count,
 * same height — so a grid of tiles does not reflow as measurements arrive or
 * drop out. That is why the delta line renders even when empty.
 */
import { computed } from "vue";

import { deltaDirection, formatDelta, formatValue, MISSING } from "../_core/measure";

const props = withDefaults(
  defineProps<{
    decimals?: number;
    /** Change over the stated window, e.g. +0.32 ft / 24 h. */
    delta?: number | null;
    deltaUnit?: string;
    deltaWindow?: string;
    label: string;
    /** Why the value is missing. Shown in place of the delta line. */
    missingReason?: string;
    size?: "md" | "lg";
    unit?: string;
    value: number | null | undefined;
  }>(),
  { decimals: 1, size: "md" },
);

const present = computed(() => props.value != null && Number.isFinite(props.value));
const readout = computed(() =>
  present.value ? formatValue(props.value, { decimals: props.decimals }) : MISSING,
);
const direction = computed(() => deltaDirection(props.delta));
const deltaText = computed(() => {
  if (!present.value) return props.missingReason || "Not published";
  if (props.delta == null) return "";
  const arrow = direction.value === "up" ? "▲" : direction.value === "down" ? "▼" : "";
  const magnitude = formatDelta(props.delta, { unit: props.deltaUnit });
  return [arrow, magnitude, props.deltaWindow ? `/ ${props.deltaWindow}` : ""]
    .filter(Boolean)
    .join(" ");
});
</script>

<template>
  <div class="ns-tile" :class="[`ns-tile--${size}`, { 'ns-tile--missing': !present }]">
    <span class="ns-tile__label">{{ label }}</span>
    <div class="ns-tile__value">
      {{ readout }}<span v-if="present && unit" class="ns-tile__unit">{{ unit }}</span>
    </div>
    <!-- Rendered even when empty so present and missing tiles are the same height. -->
    <div class="ns-tile__delta" :class="direction ? `ns-tile__delta--${direction}` : null">
      {{ deltaText }}&nbsp;
    </div>
  </div>
</template>

<style scoped>
.ns-tile {
  padding: 14px;
  border-radius: var(--ns-r-md);
  background: var(--ns-surface);
  box-shadow: var(--ns-e1);
}

.ns-tile--missing {
  background-color: var(--ns-sunk);
  background-image: var(--ns-hatch-soft);
  box-shadow: inset 0 0 0 1px rgb(var(--ns-ink-rgb) / 0.07);
}

.ns-tile__label {
  display: block;
  font-family: var(--ns-font-mono);
  font-size: 9.5px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--ns-text-mute);
}

.ns-tile__value {
  margin-top: 8px;
  font-family: var(--ns-font-mono);
  font-size: 26px;
  font-weight: 600;
  line-height: 1;
  letter-spacing: -0.03em;
  font-variant-numeric: tabular-nums;
  color: var(--ns-ink-2);
}

.ns-tile--lg .ns-tile__value {
  font-size: var(--ns-readout-xl-size);
  letter-spacing: var(--ns-readout-xl-track);
}

.ns-tile--missing .ns-tile__value {
  font-weight: 500;
  color: var(--ns-void);
}

.ns-tile__unit {
  /* Spaced with margin, not a literal space: Vue's default whitespace
     condensing strips a leading space inside an interpolated span, which
     rendered "909.68ft". */
  margin-left: 0.28em;
  font-size: 13px;
  font-weight: 500;
  color: var(--ns-text-mute);
}

.ns-tile--lg .ns-tile__unit {
  font-size: 20px;
}

.ns-tile__delta {
  margin-top: 8px;
  font-family: var(--ns-font-mono);
  font-size: 10px;
  line-height: 1.4;
  color: var(--ns-text-mute);
}

/* Rise and fall are not good and bad — a rising river is not good news. These
   are the estate's signal tokens used for direction only. */
.ns-tile__delta--up {
  color: var(--ns-live);
}

.ns-tile__delta--down {
  color: var(--ns-stale);
}
</style>
