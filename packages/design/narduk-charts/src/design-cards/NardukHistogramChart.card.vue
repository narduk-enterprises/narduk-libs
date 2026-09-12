<script setup lang="ts">
/*
 * NE Base design card for NardukHistogramChart — components backlog item 22
 * (narduk-libs#269). See NardukLineChart.card.vue for why this is not yet
 * wired into design-system-build's gallery.
 */
import NardukHistogramChart from '../components/NardukHistogramChart.vue'

const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
const bins = [
  { start: 0, end: 5, count: 3 },
  { start: 5, end: 10, count: 7 },
]
</script>

<template>
  <section
    class="preview-card"
    data-design-card="narduk-histogram-chart"
    data-name="Histogram chart"
    data-group="Charts"
  >
    <h2>Histogram chart</h2>
    <p>Histogram from samples, or explicit bins.</p>
    <div class="preview-row">
      <NardukHistogramChart
        :values="values"
        :bins="bins"
        :width="300"
        :height="200"
        :animate="false"
      />
    </div>
  </section>
</template>
