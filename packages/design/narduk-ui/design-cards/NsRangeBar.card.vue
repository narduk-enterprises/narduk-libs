<script setup lang="ts">
/*
 * NE Base design card for NsRangeBar — components backlog item 22
 * (narduk-libs#269). See NsFreshnessChip.card.vue for why this is not yet
 * wired into design-system-build's gallery.
 */
import NsRangeBar from "../instruments/NsRangeBar.vue";

const band = { low: 55, high: 88, label: "Normal for July" };
</script>

<template>
  <section
    class="preview-card"
    data-design-card="ns-range-bar"
    data-name="Range bar"
    data-group="Instruments"
  >
    <h2>Range bar</h2>
    <p>A value against a required band, with an optional forecast marker.</p>
    <div class="preview-row">
      <NsRangeBar :value="47.3" :band="band" unit="ft" label="Lake Travis" />
      <NsRangeBar :value="70" :band="band" :forecast="80" unit="ft" />
      <NsRangeBar :value="null" :band="band" missing-reason="Not published this hour" />
    </div>
  </section>
</template>
