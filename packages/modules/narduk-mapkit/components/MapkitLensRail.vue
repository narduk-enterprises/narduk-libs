<script setup lang="ts">
import { computed } from 'vue'

import MapkitIcon from './MapkitIcon.vue'

export interface MapkitLensRailOption {
  /** Full accessible name for the icon-only button. */
  ariaLabel: string
  icon: string
  key: string
  /** Short visible text -- shown in the current-lens tag, not on the button. */
  label: string
}

/**
 * The desktop lens control (board `Main.dc.html`): a 44 px vertical icon
 * rail, five 36x36 buttons deep, with the active lens's short name as a
 * small ink tag to its left. Icon-only, so each button's accessible name is
 * its own `ariaLabel`, not visible text.
 *
 * The tag is absolutely placed beside the SELECTED button (buoys #207), not
 * centred on the whole rail: 4 px rail padding, 36 px buttons and 2 px gaps
 * put button `i`'s centre at `22 + 38i`, so a 28 px tag whose top is
 * `8 + 38i` centres on it. Every other button carries a white hover label
 * (`.mk-tip`, `assets/css/map-controls.css`); the selected one does not,
 * because its tag is already there.
 */
const props = defineProps<{
  label: string
  options: MapkitLensRailOption[]
}>()

const modelValue = defineModel<string>({ required: true })

const currentIndex = computed(() =>
  props.options.findIndex((option) => option.key === modelValue.value),
)
const current = computed(() => props.options[currentIndex.value] ?? null)
/** Rail padding (4) + button offset (38 per step) + half the 36-28 difference (4). */
const tagTop = computed(() => `${8 + 38 * currentIndex.value}px`)

function select(key: string) {
  modelValue.value = key
}
</script>

<template>
  <div class="rail-group">
    <span v-if="current" class="tag" data-testid="lens-tag" :style="{ top: tagTop }">{{
      current.label
    }}</span>
    <div :aria-label="label" class="rail" role="group">
      <button
        v-for="option in options"
        :key="option.key"
        :aria-label="option.ariaLabel"
        :aria-pressed="option.key === modelValue"
        class="icon-button mk-ctl"
        :class="{ 'is-on': option.key === modelValue }"
        type="button"
        @click="select(option.key)"
      >
        <MapkitIcon :d="option.icon" />
        <span v-if="option.key !== modelValue" aria-hidden="true" class="mk-tip">{{
          option.label
        }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.rail-group {
  /* The caller positions the group; the tag hangs off it, out of flow. */
  width: 44px;
  font-family: var(--mk-font-sans);
}

.tag {
  position: absolute;
  /* 8 px clear of the 44 px rail. */
  right: 52px;
  height: 28px;
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  padding: 0 10px;
  border-radius: 6px;
  background: var(--mk-ink, #0e1418);
  color: #ffffff;
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  pointer-events: none;
  /* buoys#207: the card (`right: 76px`, painted later) covered the tag; the
     tag is a transient label, so it takes the popover layer. */
  z-index: var(--mk-z-popover, 50);
  transition: top 0.18s cubic-bezier(0.2, 0.7, 0.2, 1);
}

/* The 5 px caret pointing at the selected button. */
.tag::after {
  content: '';
  position: absolute;
  top: 50%;
  left: 100%;
  margin-top: -5px;
  border: 5px solid transparent;
  border-right: 0;
  border-left-color: var(--mk-ink, #0e1418);
}

.rail {
  width: 44px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 4px;
  border-radius: 12px;
  background: var(--mk-surface);
  box-shadow: var(--mk-elev-2);
}

.icon-button {
  width: 36px;
  height: 36px;
  flex: none;
  display: grid;
  place-items: center;
  border-radius: 8px;
}

@media (prefers-reduced-motion: reduce) {
  .tag {
    transition: none;
  }
}
</style>
