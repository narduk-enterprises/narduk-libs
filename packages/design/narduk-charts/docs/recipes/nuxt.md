# Nuxt / SSR

- Charts use `ResizeObserver`, `matchMedia`, and pointer listeners inside `onMounted` — SSR markup is static until hydration.
- `exportChartSvg` / `exportChartPng` guard `window`; call only in client code (`<ClientOnly>` or `import.meta.client`).
- Use `useId()`-based SVG ids (already used internally) so hydration ids stay stable.
- Recommended: wrap exports in a client-only component; keep `import '@narduk-enterprises/narduk-charts/style.css'` in a plugin or layout so tokens apply globally.

```vue
<script setup lang="ts">
import { NardukLineChart } from '@narduk-enterprises/narduk-charts'
import '@narduk-enterprises/narduk-charts/style.css'
</script>

<template>
  <ClientOnly>
    <NardukLineChart :series="series" :labels="labels" />
  </ClientOnly>
</template>
```
