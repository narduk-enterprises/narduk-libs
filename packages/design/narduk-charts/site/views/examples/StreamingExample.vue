<script setup lang="ts">
import { onMounted, onUnmounted, ref, computed } from 'vue'
import { NardukLineChart, useStreamingSeries } from 'narduk-charts'
import ExamplePage from '../../components/ExamplePage.vue'

const WINDOW = 48
const stream = useStreamingSeries(WINDOW, [], { maxUpdatesPerSecond: 20 })

let timer: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  let v = 50
  for (let i = 0; i < WINDOW; i++) {
    v += (Math.random() - 0.5) * 4
    v = Math.max(20, Math.min(95, v))
    stream.push(v)
  }
  timer = setInterval(() => {
    v += (Math.random() - 0.5) * 6
    v = Math.max(20, Math.min(95, v))
    stream.push(v)
  }, 400)
})

onUnmounted(() => {
  if (timer) clearInterval(timer)
})

const labels = computed(() =>
  stream.values.value.map((_, i) => `${WINDOW - 1 - i}s`),
)

const series = computed(() => [
  { name: 'CPU %', data: stream.values.value },
])
</script>

<template>
  <ExamplePage
    title="Live streaming line"
    kicker="Realtime metrics"
  >
    <template #intro>
      <p>
        <code class="rounded bg-slate-100 px-1">useStreamingSeries</code> keeps a fixed-length buffer; pair it with
        <code class="rounded bg-slate-100 px-1">NardukLineChart</code> for rolling dashboards and simulated sensors.
      </p>
    </template>
    <NardukLineChart
      chart-title="Rolling CPU (demo)"
      :series="series"
      :labels="labels"
      :height="360"
      :width="640"
      :animate="false"
      :show-area="true"
      :smooth="true"
      class="w-full max-w-full"
    />
  </ExamplePage>
</template>
