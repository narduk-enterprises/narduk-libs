<script setup lang="ts">
/*
 * NE Base design card for NeKpiTile — components backlog item 15
 * (narduk-libs#262).
 *
 * Three rows: a rising value with a favourable tone, a falling value with an
 * unfavourable tone, and a delta rendered with no tone at all — the last one
 * is the proof that direction never depends on colour, side by side with the
 * two that do carry a tone.
 */
import NeKpiTile from '../runtime/components/NeKpiTile.vue'
</script>

<template>
  <section
    class="preview-card"
    data-design-card="ne-kpi-tile"
    data-name="KPI tile"
    data-group="Shell"
  >
    <h2>KPI tile</h2>
    <p>
      The delta always carries its own sign and a ▲/▼ glyph in the text, so its direction reads the
      same with every tone-driven colour removed.
    </p>
    <div class="preview-row">
      <NeKpiTile label="Runners online" :value="128" :delta="6" tone="ok" detail="vs yesterday" />
    </div>
    <div class="preview-row">
      <NeKpiTile label="Open findings" :value="42" :delta="-3" tone="error" detail="vs last week" />
    </div>
    <div class="preview-row">
      <NeKpiTile label="Queue depth" :value="0" :delta="0" detail="no tone set" />
    </div>
  </section>
</template>
