<script setup lang="ts">
/*
 * NE Base design card for NardukPieChart — components backlog item 22
 * (narduk-libs#269). See NardukLineChart.card.vue for why this is not yet
 * wired into design-system-build's gallery.
 */
import NardukPieChart from '../components/NardukPieChart.vue'

const data = [
  { label: 'Healthy', value: 62 },
  { label: 'Degraded', value: 21 },
  { label: 'Down', value: 9 },
  { label: 'Unknown', value: 8 },
]
</script>

<template>
  <section
    class="preview-card"
    data-design-card="narduk-pie-chart"
    data-name="Pie chart"
    data-group="Charts"
  >
    <h2>Pie chart</h2>
    <p>Pie or donut with a legend and tooltips.</p>
    <div class="preview-row">
      <NardukPieChart :data="data" :width="280" :height="280" :animate="false" donut />
    </div>
  </section>
</template>
