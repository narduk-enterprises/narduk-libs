<script setup lang="ts">
/*
 * NE Base design card for NeDetailView (narduk-libs#264): a key-value panel
 * whose missing reading is a sentence, not a zero. Quantity beside
 * unavailable, so a reviewer can see both at once.
 */
import NeDetailView from '../runtime/components/NeDetailView.vue'
</script>

<template>
  <section
    class="preview-card"
    data-design-card="ne-detail-view"
    data-name="Detail view"
    data-group="Shell"
  >
    <h2>Detail view</h2>
    <p>
      A key-value panel. <code>format</code> and <code>unit</code> go through <code>./format</code>.
      A missing value prints <code>unavailable-message</code>, never 0.
    </p>

    <div class="preview-row">
      <NeDetailView
        :items="[
          { label: 'Stage', value: 5.2, format: 'quantity', unit: 'foot' },
          { label: 'Flow', value: 1234, format: 'quantity', unit: 'cfs' },
          { label: 'Observed', value: '2026-03-08T08:30:00Z', format: 'date' },
        ]"
        time-zone="America/Chicago"
      />
      <p class="mono">present readings · quantity and a zoned date</p>
    </div>

    <div class="preview-row">
      <NeDetailView
        :items="[{ label: 'Stage', value: null, format: 'quantity', unit: 'foot' }]"
        unavailable-message="No reading"
      />
      <p class="mono">unavailable · "No reading", not 0 or an em dash</p>
    </div>
  </section>
</template>
