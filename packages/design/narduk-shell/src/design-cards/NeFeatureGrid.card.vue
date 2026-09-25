<script setup lang="ts">
/*
 * NE Base design card for NeFeatureGrid — components backlog item 21
 * (narduk-libs#268). Three tiles, the icons in `--ne-accent`, one tile
 * vertical so both of `UPageFeature`'s orientations are on the card.
 */
import NeFeatureGrid from '../runtime/components/NeFeatureGrid.vue'

import type { NeFeature } from '../runtime/components/ne-marketing-types'

const features: NeFeature[] = [
  {
    description: 'Every breaker is load-tested before it ships.',
    icon: 'i-lucide-zap',
    title: 'Tested',
  },
  {
    description: 'Orders placed before 3pm leave the same day.',
    icon: 'i-lucide-truck',
    title: 'Same day',
  },
  {
    description: 'Engineers answer the phone, not a queue.',
    icon: 'i-lucide-headset',
    orientation: 'vertical',
    title: 'Support',
  },
]
</script>

<template>
  <section
    class="preview-card"
    data-design-card="ne-feature-grid"
    data-name="Feature grid"
    data-group="Marketing"
  >
    <h2>Feature grid</h2>
    <p>
      <code>UPageFeature</code> tiles on <code>UPageGrid</code>, as a list. Leading icons read
      <code>--ne-accent</code>.
    </p>

    <div class="preview-row">
      <NeFeatureGrid :features="features" />
      <p class="mono">horizontal · horizontal · vertical</p>
    </div>
  </section>
</template>
