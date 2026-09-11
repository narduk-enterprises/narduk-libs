<script setup lang="ts">
/*
 * NE Base design card for NardukLineChart — components backlog item 22
 * (narduk-libs#269), backfilling the suite bar narduk-shell components are
 * already held to.
 *
 * Not wired into design-system-build's gallery yet (that build reads only
 * narduk-shell's `NE_SHELL_COMPONENTS` today) — this card exists so
 * `scripts/check-component-surface.mjs` has real evidence to find, and is
 * ready to render the day narduk-charts joins the gallery too.
 */
import NardukLineChart from '../components/NardukLineChart.vue'

const labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
</script>

<template>
  <section
    class="preview-card"
    data-design-card="narduk-line-chart"
    data-name="Line chart"
    data-group="Charts"
  >
    <h2>Line chart</h2>
    <p>Category line/area chart with dual Y, zoom and annotations.</p>
    <div class="preview-row">
      <NardukLineChart
        :series="[{ name: 'Wind · kt', data: [4, 6, 5, 9, 7] }]"
        :labels="labels"
        :width="420"
        :height="220"
        :animate="false"
      />
    </div>
  </section>
</template>
