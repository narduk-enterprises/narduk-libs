<script setup lang="ts">
/*
 * NE Base design card for NsReadoutTile — components backlog item 22
 * (narduk-libs#269). See NsFreshnessChip.card.vue for why this is not yet
 * wired into design-system-build's gallery.
 */
import NsReadoutTile from "../instruments/NsReadoutTile.vue";
</script>

<template>
  <section
    class="preview-card"
    data-design-card="ns-readout-tile"
    data-name="Readout tile"
    data-group="Instruments"
  >
    <h2>Readout tile</h2>
    <p>Label, mono value, unit and directional delta on one fixed footprint.</p>
    <div class="preview-row">
      <NsReadoutTile
        label="Stage"
        :value="12.345"
        :decimals="2"
        unit="ft"
        :delta="-1.2"
        delta-unit="ft"
        delta-window="24 h"
      />
    </div>
  </section>
</template>
