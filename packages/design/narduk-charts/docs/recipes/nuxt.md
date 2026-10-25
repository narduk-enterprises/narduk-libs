# Nuxt / SSR

Line and Bar can render the finished chart on the server. Supply a fixed `width`
and `height` with `animate: false`; geometry then uses those dimensions before
and after hydration. No `ClientOnly` wrapper is needed for the chart. Omitting
`width` uses 600px on the server and measures the container after mount.

Light-only apps must set `:dark="false"` (`dark={false}` in JSX), otherwise the
chart follows `prefers-color-scheme` after mount. Internal `useId()` SVG ids are
stable across hydration. Use the same labels, dimensions and deterministic tick
formatters on server and client.

```vue
<script setup lang="ts">
import { ref } from 'vue'
import { NardukLineChart } from '@narduk-enterprises/narduk-charts'
import '@narduk-enterprises/narduk-charts/style.css'

const labels = ['Mon', 'Tue', 'Wed']
const series = [{ name: 'Price', data: [10, 12, 15] }]
const active = ref<number | null>(null)
const price = (value: number) => '$' + value.toFixed(2)
</script>

<template>
  <NardukLineChart
    :series="series"
    :labels="labels"
    :width="640"
    :height="240"
    :animate="false"
    :dark="false"
    :format-y-tick="price"
    :format-x-tick="label => label.toUpperCase()"
    :show-tooltip="false"
    :annotations="[
      { type: 'point', xIndex: 1.5, y: 13.5, label: 'Between samples' },
    ]"
    @active-index="index => (active = index)"
  />
  <output v-if="active !== null"
    >{{ labels[active] }}: {{ price(series[0].data[active]) }}</output
  >
</template>
```

For an entry animation when a chart first scrolls into view, instead set
`:animate="true"` and `draw-on-visible`. This explicitly opts into an initially
undrawn chart; reduced motion and `animate: false` show the finished chart
immediately. The default remains animation on mount for compatibility.

`exportChartSvg` / `exportChartPng` need browser APIs: call them from a client
interaction or `import.meta.client`. Keep the package CSS imported globally.
