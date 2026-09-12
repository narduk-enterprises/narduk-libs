<script setup lang="ts">
/*
 * NE Base design card for NeKpiBand — components backlog item 15
 * (narduk-libs#262).
 *
 * NeKpiBand only lays out; it never styles the tiles it wraps. This card
 * shows that by placing plain NeKpiTiles inside it with no extra wrapper
 * styling of its own beyond the grid.
 */
import NeKpiBand from '../runtime/components/NeKpiBand.vue'
import NeKpiTile from '../runtime/components/NeKpiTile.vue'
</script>

<template>
  <section
    class="preview-card"
    data-design-card="ne-kpi-band"
    data-name="KPI band"
    data-group="Shell"
  >
    <h2>KPI band</h2>
    <p>A responsive grid of KPI tiles. `columns` picks the grid-cols utility per breakpoint.</p>
    <div class="preview-row">
      <NeKpiBand :columns="{ base: 1, sm: 2, lg: 4 }">
        <NeKpiTile label="Runners online" :value="128" :delta="6" tone="ok" />
        <NeKpiTile label="Open findings" :value="42" :delta="-3" tone="error" />
        <NeKpiTile label="Queue depth" :value="0" :delta="0" />
        <NeKpiTile label="Deploys today" :value="9" :delta="2" tone="info" />
      </NeKpiBand>
    </div>
  </section>
</template>
