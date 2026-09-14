<script setup lang="ts">
/*
 * NE Base design card for NardukBarChart — components backlog item 22
 * (narduk-libs#269). See NardukLineChart.card.vue for why this is not yet
 * wired into design-system-build's gallery.
 */
import NardukBarChart from '../components/NardukBarChart.vue'
</script>

<template>
  <section
    class="preview-card"
    data-design-card="narduk-bar-chart"
    data-name="Bar chart"
    data-group="Charts"
  >
    <h2>Bar chart</h2>
    <p>Vertical bars, with grouped, stacked and percent-stack layouts.</p>
    <div class="preview-row">
      <NardukBarChart
        :series="[
          { name: 'Reads', data: [12, 18, 9] },
          { name: 'Writes', data: [6, 10, 14] },
        ]"
        :labels="['us-east', 'us-west', 'eu-west']"
        :width="420"
        :height="220"
        :animate="false"
      />
    </div>
  </section>
</template>
