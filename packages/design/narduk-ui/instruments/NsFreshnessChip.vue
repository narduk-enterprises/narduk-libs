<script setup lang="ts">
/**
 * The estate's freshness chip. Replaces LakeStat's FreshnessChip, Border Wait's
 * FreshnessBadge and River Status' RiverFreshnessBadge, which rendered the same
 * four states three different ways.
 *
 * Either pass an explicit `state`, or pass `observedAt` plus the source's own
 * `intervalMinutes` and let the chip classify. The second form is preferred:
 * it keeps the definition of "fresh" in one place rather than in each caller.
 */
import { computed } from "vue";

import { classifySignal, formatAge, SIGNALS, type SignalState } from "../_core/signal";

const props = withDefaults(
  defineProps<{
    /** The source's own publishing interval, not an arbitrary threshold. */
    intervalMinutes?: number;
    /** Injectable clock, for deterministic tests and stories. */
    now?: Date;
    observedAt?: Date | string | null;
    /** Append the age, e.g. "STALE · 3 d". The design system requires a stale
     *  value to be shown with its age rather than hidden. */
    showAge?: boolean;
    /** Explicit state. Omit to derive from observedAt + intervalMinutes. */
    state?: SignalState;
  }>(),
  { showAge: false },
);

const resolved = computed<SignalState>(() => {
  if (props.state) return props.state;
  if (props.intervalMinutes == null) return "void";
  return classifySignal(props.observedAt, props.intervalMinutes, props.now ?? new Date());
});

const descriptor = computed(() => SIGNALS[resolved.value]);

const age = computed(() =>
  props.showAge && props.observedAt != null
    ? formatAge(props.observedAt, props.now ?? new Date())
    : null,
);
</script>

<template>
  <span class="ns-chip" :class="`ns-chip--${resolved}`" :title="descriptor.meaning">
    <span class="ns-chip__dot" aria-hidden="true" />
    <span>{{ descriptor.label }}</span>
    <span v-if="age" class="ns-chip__age">· {{ age }}</span>
    <span class="ns-chip__sr">{{ descriptor.meaning }}</span>
  </span>
</template>

<style scoped>
.ns-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 9px;
  border-radius: var(--ns-r-xs);
  font-family: var(--ns-font-mono);
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  white-space: nowrap;
}

.ns-chip__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentcolor;
  flex: none;
}

.ns-chip__age {
  opacity: 0.8;
}

/* Visible to assistive technology only: colour alone must not carry the state. */
.ns-chip__sr {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}

.ns-chip--live {
  color: var(--ns-live);
  background: var(--ns-live-bg);
  box-shadow: inset 0 0 0 1px var(--ns-live-ring);
}

.ns-chip--aging {
  color: var(--ns-aging);
  background: var(--ns-aging-bg);
  box-shadow: inset 0 0 0 1px var(--ns-aging-ring);
}

.ns-chip--stale {
  color: var(--ns-stale);
  background: var(--ns-stale-bg);
  box-shadow: inset 0 0 0 1px var(--ns-stale-ring);
}

.ns-chip--void {
  color: var(--ns-void);
  background: var(--ns-void-bg);
  box-shadow: inset 0 0 0 1px var(--ns-void-ring);
}
</style>
