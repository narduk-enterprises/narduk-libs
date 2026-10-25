<script setup lang="ts">
import UButton from '@nuxt/ui/components/Button.vue'
import { useId } from 'vue'

import type { NeStatementHeroProps } from './ne-hall-of-fame-types'

withDefaults(defineProps<NeStatementHeroProps>(), {
  description: undefined,
  eyebrow: undefined,
  links: undefined,
})
const titleId = useId()

defineSlots<{ actions?(): unknown; default?(): unknown; media?(): unknown }>()
</script>

<template>
  <section :aria-labelledby="titleId" data-ne-statement-hero class="ne-statement-hero">
    <div class="ne-statement-hero__layout" :class="{ 'has-media': $slots.media }">
      <div class="ne-statement-hero__copy">
        <p v-if="eyebrow" class="ne-statement-hero__eyebrow">{{ eyebrow }}</p>
        <p class="ne-statement-hero__marker" :data-state="marker.state">
          <span aria-hidden="true" class="ne-statement-hero__dot" />
          <span>{{ marker.label }}</span>
          <span v-if="marker.state === 'stale'">Last known</span>
          <span v-else-if="marker.state === 'unknown'">Status unknown</span>
          <span v-if="marker.detail">{{ marker.detail }}</span>
        </p>
        <h1 :id="titleId">{{ title }}</h1>
        <p v-if="description" class="ne-statement-hero__description">{{ description }}</p>
        <div v-if="$slots.default"><slot /></div>
        <div v-if="$slots.actions || links?.length" class="ne-statement-hero__actions">
          <slot name="actions">
            <UButton v-for="(link, index) in links" :key="index" v-bind="link" size="xl" />
          </slot>
        </div>
      </div>
      <div v-if="$slots.media" class="ne-statement-hero__media"><slot name="media" /></div>
    </div>
  </section>
</template>

<style scoped>
.ne-statement-hero {
  padding: 2rem 1rem;
  background: var(--ne-surface);
  color: var(--ne-ink);
  font-family: var(--ne-font-sans);
  border-top: 3px solid var(--ne-accent);
}
.ne-statement-hero__layout {
  max-width: var(--ne-container);
  margin-inline: auto;
  display: grid;
  gap: 2rem;
}
.ne-statement-hero__copy {
  min-width: 0;
  display: grid;
  gap: 1.25rem;
}
.ne-statement-hero p,
.ne-statement-hero h1 {
  margin: 0;
}
.ne-statement-hero h1 {
  font-size: clamp(var(--ne-text-display), 6vw, calc(var(--ne-text-display) * 2.5));
  line-height: var(--ne-leading-tight);
  letter-spacing: var(--ne-tracking-tight);
  overflow-wrap: anywhere;
}
.ne-statement-hero__eyebrow {
  font-size: var(--ne-text-small);
  color: var(--ne-accent);
}
.ne-statement-hero__marker {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem 1rem;
  color: var(--ne-ink-muted);
  font-size: var(--ne-text-small);
  font-family: var(--ne-font-mono);
}
.ne-statement-hero__dot {
  width: 0.5rem;
  height: 0.5rem;
  border: 1px solid currentColor;
  border-radius: var(--ne-radius-tag);
}
[data-state='current'] .ne-statement-hero__dot {
  background: currentColor;
}
[data-state='unknown'] .ne-statement-hero__dot {
  border-style: dashed;
}
.ne-statement-hero__description {
  max-width: 48ch;
  font-size: var(--ne-text-heading);
  line-height: var(--ne-leading-body);
  color: var(--ne-ink-secondary);
}
.ne-statement-hero__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
}
.ne-statement-hero__media {
  min-width: 0;
}
@media (min-width: 64rem) {
  .ne-statement-hero {
    padding: 3.5rem 2rem;
  }
  .ne-statement-hero__layout.has-media {
    grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
    align-items: center;
  }
}
</style>
