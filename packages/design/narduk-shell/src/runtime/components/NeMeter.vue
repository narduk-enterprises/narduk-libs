<script setup lang="ts">
/**
 * NeMeter — one value against a known ceiling: a filled track with the figure
 * beside it (narduk-libs#601), and the suite's first consumer of the
 * unreported treatment (narduk-libs#602).
 *
 * `value` may be `null`. A meter whose value has no producer renders the
 * `--ne-hatch` track and an em-dash — geometry with texture and no magnitude —
 * never an empty bar, because an empty bar says "the answer is zero" and that
 * is a measurement nobody took. The component takes the `null` itself rather
 * than leaving the caller to remember a CSS class, so the distinction cannot be
 * forgotten at a call site.
 *
 * A plain element, not a Nuxt UI primitive. `UProgress` is the nearest one and
 * it is the wrong one twice over: it is a `progressbar` (a task advancing to
 * completion), not a `meter` (a quantity inside a known range), and its
 * `null` value is the animated indeterminate state — "working on it" — which
 * is exactly the reading an unreported figure must not give. So this is a
 * scoped stylesheet of token reads, like narduk-ui's instruments, and nothing
 * in it depends on a consuming app's Tailwind scanning this package.
 *
 * Numbers go through `./format`'s `formatNumber` (fixed `en-US`), so the
 * server and the browser print the same digits on the first paint.
 */
import { computed } from 'vue'

import { formatNumber } from '../../format'
import { NE_UNREPORTED_TEXT } from '../utils/unreported'

import { readMeter } from './ne-meter-types'

import type { NeMeterProps } from './ne-meter-types'

const props = withDefaults(defineProps<NeMeterProps>(), {
  label: '',
  value: null,
  variant: 'block',
})

const reading = computed(() => readMeter(props.value, props.max))

/** Width of the fill, in percent. Rounded so the inline style is stable. */
const percent = computed(() =>
  reading.value.reported ? Math.round(reading.value.fraction * 10_000) / 100 : 0,
)

/** The real value, unclamped — geometry clamps, the figure never lies. */
const valueText = computed(() => formatNumber(reading.value.reported ? props.value : null))
const maxText = computed(() => formatNumber(props.max))

/**
 * The root carries the semantics; its children are presentational (both
 * `meter` and `img` have presentational children). A reported figure is a
 * `meter` with its range; an unreported one has no `aria-valuenow` to give —
 * ARIA requires one on a `meter`, and a `0` would be the lie this component
 * exists to avoid — so it is an `img` whose name says so.
 */
const semantics = computed(() => {
  if (!reading.value.reported) {
    const unreported = props.label
      ? `${props.label}: ${NE_UNREPORTED_TEXT.toLowerCase()}`
      : NE_UNREPORTED_TEXT
    return { role: 'img', 'aria-label': unreported }
  }
  const valueTextFull = `${valueText.value} of ${maxText.value}`
  return {
    role: 'meter',
    'aria-label': props.label || valueTextFull,
    'aria-valuemin': 0,
    'aria-valuemax': reading.value.ceiling,
    'aria-valuenow': reading.value.now,
    'aria-valuetext': valueTextFull,
  }
})
</script>

<template>
  <div
    class="ne-meter"
    :class="[`ne-meter--${variant}`, { 'ne-meter--unreported': !reading.reported }]"
    data-testid="ne-meter"
    :data-state="reading.reported ? 'reported' : 'unreported'"
    v-bind="semantics"
  >
    <span v-if="label" class="ne-meter__label">{{ label }}</span>
    <span class="ne-meter__track">
      <span v-if="reading.reported" class="ne-meter__fill" :style="{ width: `${percent}%` }" />
    </span>
    <span class="ne-meter__figure"
      ><span class="ne-meter__value">{{ valueText }}</span
      ><span class="ne-meter__ceiling"> / {{ maxText }}</span></span
    >
  </div>
</template>

<style scoped>
/*
 * Token reads only (README § Styling contract): colour, radius and font come
 * from `--ne-*`, and the unreported track is `--ne-hatch` — see README
 * § The unreported treatment. Spacing is plain rem, as there is no NE space
 * scale.
 */
.ne-meter {
  min-width: 0;
  color: var(--ne-ink-body);
}

.ne-meter--block {
  display: grid;
  grid-template-areas:
    'label figure'
    'track track';
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: baseline;
  column-gap: 0.75rem;
  row-gap: 0.375rem;
}

.ne-meter--block .ne-meter__label {
  grid-area: label;
}

.ne-meter--block .ne-meter__figure {
  grid-area: figure;
}

.ne-meter--block .ne-meter__track {
  grid-area: track;
}

.ne-meter--inline {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.ne-meter--inline .ne-meter__label {
  flex: 0 1 auto;
  max-width: 40%;
}

.ne-meter--inline .ne-meter__track {
  flex: 1 1 4rem;
  min-width: 4rem;
}

.ne-meter__label {
  min-width: 0;
  overflow: hidden;
  font-size: var(--ne-text-small);
  color: var(--ne-ink-muted);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ne-meter__figure {
  font-family: var(--ne-font-mono);
  font-size: var(--ne-text-small);
  font-variant-numeric: tabular-nums;
  color: var(--ne-ink);
  text-align: end;
  white-space: nowrap;
}

.ne-meter__ceiling {
  color: var(--ne-ink-muted);
}

/* The slot. Same footprint reported or not, so a row never reflows. */
.ne-meter__track {
  position: relative;
  display: block;
  align-self: center;
  height: 0.5rem;
  overflow: hidden;
  border-radius: var(--ne-radius-tag);
  background-color: var(--ne-surface-accented);
}

.ne-meter__fill {
  position: absolute;
  inset-block: 0;
  inset-inline-start: 0;
  background-color: var(--ne-accent);
}

/* The unreported treatment: texture, no magnitude, and an em-dash figure. */
.ne-meter--unreported .ne-meter__track {
  background-color: var(--ne-surface);
  background-image: var(--ne-hatch);
  outline: 1px solid var(--ne-line-strong);
  outline-offset: -1px;
}

.ne-meter--unreported .ne-meter__value {
  color: var(--ne-ink-muted);
}

/* Forced colours drop background colours; keep the fill and the slot visible. */
@media (forced-colors: active) {
  .ne-meter__track {
    outline: 1px solid CanvasText;
    outline-offset: -1px;
  }

  .ne-meter__fill {
    background-color: Highlight;
    forced-color-adjust: none;
  }
}
</style>
