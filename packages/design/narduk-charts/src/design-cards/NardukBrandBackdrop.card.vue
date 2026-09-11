<script setup lang="ts">
/*
 * NE Base design card for NardukBrandBackdrop — components backlog item 22
 * (narduk-libs#269). See NardukLineChart.card.vue for why this is not yet
 * wired into design-system-build's gallery.
 */
import NardukBrandBackdrop from '../components/NardukBrandBackdrop.vue'
</script>

<template>
  <section
    class="preview-card"
    data-design-card="narduk-brand-backdrop"
    data-name="Brand backdrop"
    data-group="Charts"
  >
    <h2>Brand backdrop</h2>
    <p>Optional marketing/hero backdrop: SVG grid plus series, using chart CSS variables only.</p>
    <div class="preview-row" style="position: relative; height: 160px">
      <NardukBrandBackdrop />
    </div>
  </section>
</template>
