<script setup lang="ts" generic="T extends NeSegmentValue">
/**
 * NeSegmented — one choice among a few: a range (1D / 1W / 1M), a unit, a map
 * layer, 2D / 3D. A filter or a setting, not navigation (that is NeTabs or
 * NeBottomTabBar).
 *
 * Five apps hand-rolled this (austin-rising-runners, stonx ×3, narduk-farm).
 * What each had to get right, here once:
 *
 * - **A radiogroup.** `role="radiogroup"` named by `label` or `labelledby`,
 *   each segment a `role="radio"` button with `aria-checked`.
 * - **Roving focus.** One Tab stop (the chosen segment, or the first enabled
 *   one when none is chosen). ArrowLeft / ArrowRight (and Up / Down) move and
 *   choose, wrapping, skipping disabled segments; Home and End jump.
 * - **Disabled is offered, not hidden**, with its reason as the title.
 * - **Tap targets.** 2.75rem tall below `md` or under a coarse pointer, 2.25rem
 *   under a desktop pointer. Choosing never moves a segment.
 *
 * Styling contract: tokens only.
 */
import { computed, nextTick, ref } from 'vue'

import type { NeSegmentedProps, NeSegmentOption, NeSegmentValue } from './ne-segmented-types'

const props = withDefaults(defineProps<NeSegmentedProps<T>>(), {
  label: undefined,
  labelledby: undefined,
  variant: 'track',
  layout: 'fill',
  mono: false,
})

const emit = defineEmits<{ 'update:modelValue': [value: T] }>()

defineSlots<{
  /** A segment's content, in place of its label and count. */
  option?(props: { checked: boolean; option: NeSegmentOption<T> }): unknown
}>()

const buttons = ref<HTMLButtonElement[]>([])

const checkedIndex = computed(() =>
  props.options.findIndex((option) => option.value === props.modelValue),
)

/** The single Tab stop: the chosen segment, else the first enabled one. */
const tabStop = computed(() => {
  const chosen = checkedIndex.value
  if (chosen !== -1 && !props.options[chosen]?.disabled) return chosen
  return props.options.findIndex((option) => !option.disabled)
})

const segments = computed(() =>
  props.options.map((option, index) => ({
    option,
    checked: index === checkedIndex.value,
    tabindex: index === tabStop.value ? 0 : -1,
    title: option.disabled ? option.disabledReason : undefined,
  })),
)

function choose(option: NeSegmentOption<T>) {
  if (option.disabled || option.value === props.modelValue) return
  emit('update:modelValue', option.value)
}

function step(from: number, delta: 1 | -1): number {
  const count = props.options.length
  for (let offset = 1; offset <= count; offset += 1) {
    const candidate = (from + delta * offset + count * count) % count
    if (!props.options[candidate]?.disabled) return candidate
  }
  return -1
}

function targetFor(key: string, from: number): number | null {
  if (key === 'ArrowRight' || key === 'ArrowDown') return step(from, 1)
  if (key === 'ArrowLeft' || key === 'ArrowUp') return step(from, -1)
  if (key === 'Home') return props.options.findIndex((option) => !option.disabled)
  if (key === 'End') return props.options.map((option) => !option.disabled).lastIndexOf(true)
  return null
}

function onKeydown(event: KeyboardEvent, index: number) {
  const target = targetFor(event.key, index)
  if (target === null) return
  event.preventDefault()
  const option = props.options[target]
  if (target === -1 || !option) return
  choose(option)
  void nextTick(() => buttons.value[target]?.focus())
}
</script>

<template>
  <div
    class="ne-segmented"
    role="radiogroup"
    :aria-label="labelledby ? undefined : label"
    :aria-labelledby="labelledby"
    :data-variant="variant"
    :data-layout="layout"
    :data-mono="mono ? '' : undefined"
  >
    <button
      v-for="(segment, index) in segments"
      :key="String(segment.option.value)"
      ref="buttons"
      type="button"
      role="radio"
      class="ne-segmented__segment"
      :aria-checked="segment.checked"
      :tabindex="segment.tabindex"
      :disabled="segment.option.disabled"
      :title="segment.title"
      @click="choose(segment.option)"
      @keydown="onKeydown($event, index)"
    >
      <slot name="option" :option="segment.option" :checked="segment.checked">
        <span class="ne-segmented__label">{{ segment.option.label }}</span>
        <span v-if="segment.option.count !== undefined" class="ne-segmented__count">{{
          segment.option.count
        }}</span>
      </slot>
    </button>
  </div>
</template>

<style scoped>
.ne-segmented {
  display: flex;
  max-width: 100%;
  gap: 0.125rem;
}

.ne-segmented[data-variant='track'] {
  padding: 0.125rem;
  background: var(--ne-surface-muted);
  border: 1px solid var(--ne-hairline);
  border-radius: var(--ne-radius-control);
}

.ne-segmented[data-variant='chips'] {
  gap: 0.375rem;
}

.ne-segmented[data-layout='wrap'] {
  flex-wrap: wrap;
}

.ne-segmented[data-layout='scroll'] {
  overflow-x: auto;
  overscroll-behavior-x: contain;
  scrollbar-width: none;
}

.ne-segmented__segment {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  gap: 0.375rem;
  min-height: 2.75rem;
  padding: 0 0.875rem;
  background: transparent;
  border: 1px solid transparent;
  border-radius: calc(var(--ne-radius-control) - 0.125rem);
  color: var(--ne-ink-muted);
  font: inherit;
  font-size: var(--ne-text-small);
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
  transition:
    color var(--ne-feel-fast) var(--ne-ease-out),
    background-color var(--ne-feel-fast) var(--ne-ease-out);
}

.ne-segmented[data-layout='fill'] .ne-segmented__segment {
  flex: 1 1 0;
  min-width: 0;
}

.ne-segmented[data-mono] .ne-segmented__segment {
  font-family: var(--ne-font-mono);
  font-variant-numeric: tabular-nums;
}

.ne-segmented__segment:hover:not(:disabled, [aria-checked='true']) {
  color: var(--ne-ink);
}

.ne-segmented[data-variant='track'] .ne-segmented__segment[aria-checked='true'] {
  background: var(--ne-surface);
  box-shadow: var(--ne-shadow-1);
  color: var(--ne-ink);
}

.ne-segmented[data-variant='chips'] .ne-segmented__segment {
  border-color: var(--ne-hairline);
  border-radius: var(--ne-radius-tag);
}

.ne-segmented[data-variant='chips'] .ne-segmented__segment[aria-checked='true'] {
  background: var(--ne-surface-inverted);
  border-color: var(--ne-surface-inverted);
  color: var(--ne-ink-inverted);
}

.ne-segmented__segment:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.ne-segmented__segment:focus-visible {
  outline: 2px solid var(--ne-accent);
  outline-offset: 2px;
}

.ne-segmented__count {
  min-width: 1.25rem;
  padding: 0 0.375rem;
  border-radius: var(--ne-radius-tag);
  background: var(--ne-hairline);
  color: var(--ne-ink);
  font-size: var(--ne-text-label);
}

/* A desktop pointer gets the denser 2.25rem row. */
@media (min-width: 48rem) and (pointer: fine) {
  .ne-segmented__segment {
    min-height: 2.25rem;
  }
}
</style>
