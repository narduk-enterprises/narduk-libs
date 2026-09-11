<script setup lang="ts">
/*
 * NE Base design card for NardukScatterChart — components backlog item 22
 * (narduk-libs#269). See NardukLineChart.card.vue for why this is not yet
 * wired into design-system-build's gallery.
 */
import NardukScatterChart from '../components/NardukScatterChart.vue'

const series = [
  {
    name: 'Sensor A',
    points: [
      { x: 1, y: 2 },
      { x: 3, y: 4 },
      { x: 5, y: 3 },
      { x: 7, y: 6 },
    ],
  },
]
</script>

<template>
  <section
    class="preview-card"
    data-design-card="narduk-scatter-chart"
    data-name="Scatter chart"
    data-group="Charts"
  >
    <h2>Scatter chart</h2>
    <p>Numeric scatter plot, one series per color.</p>
    <div class="preview-row">
      <NardukScatterChart :series="series" :width="300" :height="200" :animate="false" />
    </div>
  </section>
</template>
