<script setup lang="ts">
import UButton from '@nuxt/ui/components/Button.vue'
import { computed, nextTick, onMounted, ref, useId, watch } from 'vue'

import { formatNumber } from '../../format'

import type { NeTimelineHeroProps } from './ne-hall-of-fame-types'

const props = withDefaults(defineProps<NeTimelineHeroProps>(), {
  description: undefined,
  eyebrow: undefined,
  modelValue: undefined,
  suffix: undefined,
  timelineLabel: 'Period',
})
const emit = defineEmits<{ 'update:modelValue': [id: string] }>()
const titleId = useId()

defineSlots<{ media?(): unknown; source?(): unknown }>()

// Invalid quantities have the same honest gap treatment as null. Zero stays zero.
const readings = computed(() =>
  props.periods.map((period) => ({
    ...period,
    reported: period.value !== null && Number.isFinite(period.value) && period.value >= 0,
  })),
)
const ceiling = computed(() =>
  Math.max(0, ...readings.value.map((period) => (period.reported ? period.value! : 0))),
)
const strip = ref<HTMLElement | null>(null)
function revealSelection() {
  const container = strip.value
  const selected = container?.querySelector<HTMLElement>('[aria-pressed="true"]')
  if (!container || !selected) return
  // Scroll this strip only: scrollIntoView would move the whole document on refresh.
  const parent = container.getBoundingClientRect()
  const child = selected.getBoundingClientRect()
  container.scrollLeft += child.left - parent.left - (container.clientWidth - child.width) / 2
}
onMounted(revealSelection)
watch(
  () => [props.modelValue, props.periods],
  async () => {
    await nextTick()
    revealSelection()
  },
)
</script>

<template>
  <section :aria-labelledby="titleId" data-ne-timeline-hero class="ne-timeline-hero">
    <div class="ne-timeline-hero__layout" :class="{ 'has-media': $slots.media }">
      <div class="ne-timeline-hero__copy">
        <p v-if="eyebrow" class="ne-timeline-hero__eyebrow">{{ eyebrow }}</p>
        <h1 :id="titleId">
          {{ subject }} {{ verb }} <em>{{ value ?? 'Not reported' }}</em> {{ suffix }}
        </h1>
        <p v-if="description">{{ description }}</p>
        <div ref="strip" role="group" :aria-label="timelineLabel" class="ne-timeline-hero__strip">
          <UButton
            v-for="period in readings"
            :key="period.id"
            color="neutral"
            variant="link"
            class="ne-timeline-hero__period"
            :aria-pressed="modelValue === period.id"
            :aria-label="`${period.label}, ${period.reported ? (period.valueLabel ?? formatNumber(period.value)) : 'Not reported'}${period.partial ? ', partial period' : ''}`"
            @click="emit('update:modelValue', period.id)"
          >
            <span class="ne-timeline-hero__number">{{
              period.reported ? (period.valueLabel ?? formatNumber(period.value)) : '—'
            }}</span>
            <span class="ne-timeline-hero__track" aria-hidden="true">
              <span
                v-if="period.reported"
                class="ne-timeline-hero__bar"
                :class="{ 'is-partial': period.partial }"
                :style="{ height: `${ceiling ? (period.value! / ceiling) * 100 : 0}%` }"
              />
              <span v-else class="ne-timeline-hero__gap">?</span>
            </span>
            <span>{{ period.label }}</span>
            <span v-if="period.partial" class="ne-timeline-hero__qualifier">Partial</span>
            <span v-else-if="!period.reported" class="ne-timeline-hero__qualifier"
              >Not reported</span
            >
          </UButton>
        </div>
        <p v-if="!periods.length" class="ne-timeline-hero__empty">No periods reported.</p>
        <div v-if="$slots.source" class="ne-timeline-hero__source"><slot name="source" /></div>
      </div>
      <div v-if="$slots.media" class="ne-timeline-hero__media"><slot name="media" /></div>
    </div>
  </section>
</template>

<style scoped>
.ne-timeline-hero {
  padding: 2rem 1rem;
  background: var(--ne-structure);
  color: var(--ne-structure-ink);
  font-family: var(--ne-font-sans);
}
.ne-timeline-hero__layout {
  max-width: var(--ne-container);
  margin-inline: auto;
  display: grid;
  gap: 2rem;
}
.ne-timeline-hero__copy {
  min-width: 0;
  display: grid;
  gap: 1rem;
}
.ne-timeline-hero h1 {
  margin: 0;
  font-size: clamp(var(--ne-text-title), 5vw, calc(var(--ne-text-display) * 2));
  line-height: var(--ne-leading-tight);
  letter-spacing: var(--ne-tracking-tight);
  overflow-wrap: anywhere;
}
.ne-timeline-hero h1 em {
  font-family: var(--ne-font-mono);
}
.ne-timeline-hero p {
  margin: 0;
}
.ne-timeline-hero__eyebrow,
.ne-timeline-hero__source {
  font-size: var(--ne-text-small);
}
.ne-timeline-hero__strip {
  display: flex;
  gap: 0.5rem;
  overflow-x: auto;
  padding: 0.25rem;
}
.ne-timeline-hero__period {
  flex: 1 0 4.5rem;
  min-width: 44px;
  min-height: 44px;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  padding: 0.25rem;
  color: inherit;
  white-space: normal;
  text-align: center;
  border-bottom: 2px solid transparent;
  border-radius: var(--ne-radius-control);
}
.ne-timeline-hero__period:hover,
.ne-timeline-hero__period:focus-visible {
  color: inherit;
  outline: 2px solid currentColor;
  outline-offset: -2px;
}
.ne-timeline-hero__period[aria-pressed='true'] {
  border-bottom-color: currentColor;
}
.ne-timeline-hero__number,
.ne-timeline-hero__qualifier {
  font-size: var(--ne-text-label);
  font-family: var(--ne-font-mono);
}
.ne-timeline-hero__track {
  display: flex;
  align-items: flex-end;
  width: 100%;
  height: 5rem;
}
.ne-timeline-hero__bar {
  width: 100%;
  background: currentColor;
  opacity: 0.45;
  transform-origin: bottom;
}
.ne-timeline-hero__period[aria-pressed='true'] .ne-timeline-hero__bar {
  opacity: 1;
}
.ne-timeline-hero__bar.is-partial {
  background: repeating-linear-gradient(135deg, currentColor 0 3px, transparent 3px 6px);
}
.ne-timeline-hero__gap {
  width: 100%;
  align-self: stretch;
  display: grid;
  place-items: center;
  border: 1px dashed currentColor;
}
.ne-timeline-hero__media {
  min-width: 0;
}
@media (min-width: 64rem) {
  .ne-timeline-hero {
    padding: 3rem 2rem;
  }
  .ne-timeline-hero__layout.has-media {
    grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
    align-items: center;
  }
}
@media (prefers-reduced-motion: no-preference) {
  .ne-timeline-hero h1 {
    animation: ne-timeline-arrive var(--ne-feel-base) var(--ne-ease-out) both;
  }
  .ne-timeline-hero__bar {
    transition:
      height var(--ne-feel-base) var(--ne-ease-out),
      opacity var(--ne-feel-fast) var(--ne-ease-out);
  }
  @keyframes ne-timeline-arrive {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
  }
}
</style>
