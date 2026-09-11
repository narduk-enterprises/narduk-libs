<script setup lang="ts">
/*
 * NE Base design card for NsLevelWell — components backlog item 22
 * (narduk-libs#269). See NsFreshnessChip.card.vue for why this is not yet
 * wired into design-system-build's gallery.
 */
import NsLevelWell from "../instruments/NsLevelWell.vue";
</script>

<template>
  <section
    class="preview-card"
    data-design-card="ns-level-well"
    data-name="Level well"
    data-group="Instruments"
  >
    <h2>Level well</h2>
    <p>A value against a required median — never a bare progress bar.</p>
    <div class="preview-row">
      <NsLevelWell :value="47.3" :median="60" name="Lake Travis" />
      <NsLevelWell :value="null" :median="60" missing-reason="Gauge offline" />
    </div>
  </section>
</template>
