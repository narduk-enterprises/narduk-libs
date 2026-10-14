<script setup lang="ts">
/**
 * NeAbsent — the cell-level mark for a value nothing produced: the hatch, named
 * "not reported", inside a table cell, a card field or a KPI value. The
 * component-sized half of the unreported treatment (README § The unreported
 * treatment); `NeMeter` and `NeKpiTile` already draw it for their own figures,
 * and `NeStatePanel` covers a whole panel. This is the part in between, for
 * markup the suite does not own.
 *
 * It is geometry with texture and no magnitude: the `--ne-hatch` material over
 * a slot of fixed size, so a row does not reflow when data arrives, and never an
 * empty cell, a `0` or a blank — each of which reads as a measurement.
 *
 * `cell` (the default) carries no words: it is `role="img"` named
 * `<label>: not reported`, and `data-ne-empty`, which tells `NeCollectionTable`'s
 * phone card that this cell has nothing to say so the card drops it rather than
 * drawing a label beside a mark. `block` names the field in words and takes a
 * default slot for the one action that belongs beside it (a link to where the
 * missing producer is tracked); the words are the name, so it adds no `img`.
 *
 * A plain element with a scoped stylesheet of token reads, like `NeMeter`.
 */
import { computed } from 'vue'

import { NE_UNREPORTED_TEXT } from '../utils/unreported'

import { absentName } from './ne-absent-types'

import type { NeAbsentProps } from './ne-absent-types'

const props = withDefaults(defineProps<NeAbsentProps>(), {
  label: undefined,
  variant: 'cell',
  word: NE_UNREPORTED_TEXT,
})

defineSlots<{
  /** `block` only: content after the words, typically one link. Ignored by `cell`. */
  default?(): unknown
}>()

const name = computed(() => absentName(props.label))

/** `block`'s visible words: `<label> · <word>`, either half optional. */
const text = computed(() => [props.label, props.word].filter(Boolean).join(' · '))
</script>

<template>
  <span
    v-if="variant === 'cell'"
    class="ne-absent ne-absent--cell"
    data-testid="ne-absent"
    data-state="unreported"
    data-ne-empty
    role="img"
    :aria-label="name"
    :title="label || undefined"
  />
  <div v-else class="ne-absent ne-absent--block" data-testid="ne-absent" data-state="unreported">
    <span class="ne-absent__text">{{ text }}</span>
    <slot />
  </div>
</template>

<style scoped>
/*
 * Token reads only (README § Styling contract). The hatch is `--ne-hatch`, over
 * the surface, with the same outline `NeMeter`'s unreported track wears, so the
 * two read as one material. Spacing is plain rem, as there is no NE space scale.
 */
.ne-absent {
  background-color: var(--ne-surface);
  background-image: var(--ne-hatch);
  outline: 1px solid var(--ne-line-strong);
  outline-offset: -1px;
  color: var(--ne-ink-muted);
}

.ne-absent--cell {
  display: inline-block;
  width: 2.5rem;
  max-width: 100%;
  height: 0.875rem;
  vertical-align: middle;
  border-radius: var(--ne-radius-tag);
}

.ne-absent--block {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.25rem 0.75rem;
  min-height: 3.5rem;
  padding: 0.5rem 0.75rem;
  border-radius: var(--ne-radius-control);
  font-size: var(--ne-text-small);
}

.ne-absent__text {
  min-width: 0;
  overflow-wrap: anywhere;
}

/* Forced colours drop background images; keep the slot visible. */
@media (forced-colors: active) {
  .ne-absent {
    outline-color: CanvasText;
  }
}
</style>
