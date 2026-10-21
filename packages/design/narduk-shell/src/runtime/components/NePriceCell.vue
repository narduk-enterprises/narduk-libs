<script setup lang="ts">
/**
 * NePriceCell — a figure that changes without moving anything around it.
 *
 * Live prices, deltas and P&L re-render every few seconds. If `$99.99` becoming
 * `$100.01` is one character wider, the whole row nudges, and a table of them
 * shimmers. This cell takes the three steps that stop it, once:
 *
 *   1. a reserved width in `ch` (`chars`, default 8), so the cell is as wide as
 *      its largest likely value from the first paint;
 *   2. tabular figures (`font-variant-numeric: tabular-nums`), so every digit is
 *      the same width and `1111` and `8888` occupy the same space;
 *   3. a tint that changes `color` and nothing else. Never width, weight, border
 *      or padding, so a tinted cell and an untinted one measure the same.
 *
 * Colour is never the only cue: `signed` writes the sign into the text. A
 * missing figure draws `NeAbsent` (the suite's "nothing produced this" mark) in
 * the same reserved width, not a blank and not a `0`.
 *
 * `tint="flash"` is the live-price mode: nothing at rest, then up or down for
 * `flashMs` in the direction of the move. It runs only in the browser and only
 * after the first render, so the server markup and hydration agree. Under
 * `prefers-reduced-motion` the tint still shows; only the fade collapses.
 *
 * Styling contract: tokens only; status colours come from Nuxt UI's
 * `--ui-success` / `--ui-error`, as `NeStatusBadge` does.
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'

import { NE_PRICE_CELL_CHARS, NE_PRICE_CELL_FLASH_MS, priceCellText } from './ne-price-cell-types'
import NeAbsent from './NeAbsent.vue'

import type { NePriceCellProps } from './ne-price-cell-types'

const props = withDefaults(defineProps<NePriceCellProps>(), {
  kind: 'number',
  currency: undefined,
  digits: undefined,
  signed: false,
  input: 'fraction',
  locale: undefined,
  chars: NE_PRICE_CELL_CHARS,
  align: 'end',
  tint: 'none',
  flashMs: NE_PRICE_CELL_FLASH_MS,
  label: undefined,
})

const text = computed(() => priceCellText(props))

/** The direction of the last change, while a `flash` tint is showing. */
const flashed = ref<'down' | 'up' | null>(null)
let timer: ReturnType<typeof setTimeout> | undefined

watch(
  () => props.value,
  (next, previous) => {
    if (props.tint !== 'flash') return
    if (typeof next !== 'number' || typeof previous !== 'number' || next === previous) return
    flashed.value = next > previous ? 'up' : 'down'
    clearTimeout(timer)
    timer = setTimeout(() => {
      flashed.value = null
    }, props.flashMs)
  },
)

onBeforeUnmount(() => clearTimeout(timer))

const tone = computed<'down' | 'up' | null>(() => {
  if (text.value === undefined) return null
  if (props.tint === 'flash') return flashed.value
  if (props.tint !== 'sign' || typeof props.value !== 'number') return null
  if (props.value > 0) return 'up'
  if (props.value < 0) return 'down'
  return null
})
</script>

<template>
  <span
    class="ne-price-cell"
    :data-align="align"
    :data-tone="tone"
    :style="{ '--ne-price-cell-chars': chars }"
  >
    <NeAbsent v-if="text === undefined" :label="label" />
    <template v-else>{{ text }}</template>
  </span>
</template>

<style scoped>
/*
 * Width, figures, then colour. The only property any state changes is `color`
 * (the transition below names it), which is the whole contract: a cell that is
 * tinted, flashing or at rest is the same box.
 */
.ne-price-cell {
  display: inline-block;
  min-width: calc(var(--ne-price-cell-chars) * 1ch);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  text-align: end;
  transition: color var(--ne-feel-base) var(--ne-ease-out);
}

.ne-price-cell[data-align='start'] {
  text-align: start;
}

.ne-price-cell[data-tone='up'] {
  color: var(--ui-color-success-800, var(--ui-success));
}

.ne-price-cell[data-tone='down'] {
  color: var(--ui-color-error-800, var(--ui-error));
}

/* Light uses the 800 step of the ramp for contrast; dark uses the readable alias. */
:global(.dark) .ne-price-cell[data-tone='up'] {
  color: var(--ui-success);
}

:global(.dark) .ne-price-cell[data-tone='down'] {
  color: var(--ui-error);
}

@media (prefers-color-scheme: dark) {
  :global(:root[data-ne-scheme='auto']) .ne-price-cell[data-tone='up'] {
    color: var(--ui-success);
  }

  :global(:root[data-ne-scheme='auto']) .ne-price-cell[data-tone='down'] {
    color: var(--ui-error);
  }
}
</style>
