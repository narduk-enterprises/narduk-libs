<script setup lang="ts">
/*
 * NE Base design card for NardukChartStack — components backlog item 22
 * (narduk-libs#269). See NardukLineChart.card.vue for why this is not yet
 * wired into design-system-build's gallery.
 */
import { ref } from 'vue'

import NardukChartStack from '../components/NardukChartStack.vue'
import NardukLineChart from '../components/NardukLineChart.vue'

import type { CandleTimeDomain } from '../types'

const domain = ref<CandleTimeDomain | null>(null)
</script>

<template>
  <section
    class="preview-card"
    data-design-card="narduk-chart-stack"
    data-name="Chart stack"
    data-group="Charts"
  >
    <h2>Chart stack</h2>
    <p>
      Layout helper forwarding <code>v-model:domain</code> so linked panes (a candle chart above a
      volume/line row) share one zoom domain without each child owning it.
    </p>
    <div class="preview-row">
      <NardukChartStack v-model:domain="domain">
        <template #default="{ domainModel }">
          <NardukLineChart
            :series="[{ name: 'Volume', data: [4, 6, 5, 9, 7] }]"
            :labels="['Mon', 'Tue', 'Wed', 'Thu', 'Fri']"
            :width="420"
            :height="160"
            :animate="false"
          />
          <p class="mono">domain: {{ String(domainModel) }}</p>
        </template>
      </NardukChartStack>
    </div>
  </section>
</template>
