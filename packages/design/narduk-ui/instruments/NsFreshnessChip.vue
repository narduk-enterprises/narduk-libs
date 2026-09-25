<script setup lang="ts">
/**
 * The estate's freshness chip. Replaces LakeStat's FreshnessChip, Border Wait's
 * FreshnessBadge and River Status' RiverFreshnessBadge, which rendered the same
 * four states three different ways.
 *
 * Either pass an explicit `state`, or pass `observedAt` plus the source's own
 * `intervalMinutes` and let the chip classify. The second form is preferred:
 * it keeps the definition of "fresh" in one place rather than in each caller.
 *
 * Classification and age both need a clock. Reading `new Date()` during SSR
 * is the hydration bug `narduk-shell/format` exists to prevent — workerd and
 * the browser disagree near thresholds, minute boundaries, and whenever
 * `showAge` is on. So:
 *
 * - `now` is the SSR-stable path. Tests, stories, and any first paint that
 *   must already say Live/Stale inject it.
 * - Explicit `state` still classifies on the server (no clock). `showAge`
 *   without `now` still waits for mount.
 * - `observedAt` + `intervalMinutes` without `now` renders a stable
 *   `ns-chip--pending` placeholder on the server and on the client's first
 *   paint, then classifies in `onMounted`. Existing `state` / `now` callers
 *   are unchanged.
 * - Without `now`, the chip's own clock ticks every 30 s after mount, so a
 *   producer that stops publishing moves from LIVE to AGING to STALE while
 *   the page stays open (narduk-libs#936). An injected `now` never ticks: the
 *   caller owns that clock.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";

import { classifySignal, formatAge, SIGNALS, type SignalState } from "../_core/signal";

const props = withDefaults(
  defineProps<{
    /** The source's own publishing interval, not an arbitrary threshold. */
    intervalMinutes?: number;
    /** Injectable clock. Pass this for a classified first paint; omit for a stable placeholder until mount. */
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

const PENDING_LABEL = "…";
const PENDING_MEANING = "Waiting to classify this observation against a clock.";

/** How often the chip's own clock advances. Signal thresholds are minutes. */
const TICK_MS = 30_000;

/** Null until mount, so the server and the first client paint agree. */
const ownClock = ref<Date | null>(null);
let mounted = false;
let ticker: ReturnType<typeof setInterval> | undefined;

function stopTicking(): void {
  if (ticker === undefined) return;
  clearInterval(ticker);
  ticker = undefined;
}

function syncClock(): void {
  if (props.now) {
    stopTicking();
    return;
  }
  ownClock.value = new Date();
  ticker ??= setInterval(() => {
    ownClock.value = new Date();
  }, TICK_MS);
}

onMounted(() => {
  mounted = true;
  syncClock();
});
watch(
  () => props.now,
  () => {
    if (mounted) syncClock();
  },
);
onBeforeUnmount(stopTicking);

const clock = computed<Date | null>(() => props.now ?? ownClock.value);

function isDateable(value: Date | string | null | undefined): boolean {
  if (value == null) return false;
  const observed = value instanceof Date ? value : new Date(value);
  return Number.isFinite(observed.getTime());
}

const resolved = computed<SignalState | null>(() => {
  if (props.state) return props.state;
  const interval = props.intervalMinutes;
  if (interval == null || !(interval > 0) || !isDateable(props.observedAt)) return "void";
  if (clock.value == null) return null;
  return classifySignal(props.observedAt, interval, clock.value);
});

const appearance = computed(() => {
  if (resolved.value == null) {
    return { stateClass: "pending", label: PENDING_LABEL, meaning: PENDING_MEANING };
  }
  const descriptor = SIGNALS[resolved.value];
  return { stateClass: resolved.value, label: descriptor.label, meaning: descriptor.meaning };
});

const age = computed(() =>
  props.showAge && props.observedAt != null && clock.value != null
    ? formatAge(props.observedAt, clock.value)
    : null,
);
</script>

<template>
  <span
    class="ns-chip"
    :class="`ns-chip--${appearance.stateClass}`"
    :title="appearance.meaning"
    :aria-busy="resolved == null ? 'true' : undefined"
  >
    <span class="ns-chip__dot" aria-hidden="true" />
    <span>{{ appearance.label }}</span>
    <span v-if="age" class="ns-chip__age">· {{ age }}</span>
    <span class="ns-chip__sr">{{ appearance.meaning }}</span>
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

.ns-chip--void,
.ns-chip--pending {
  color: var(--ns-void);
  background: var(--ns-void-bg);
  box-shadow: inset 0 0 0 1px var(--ns-void-ring);
}
</style>
