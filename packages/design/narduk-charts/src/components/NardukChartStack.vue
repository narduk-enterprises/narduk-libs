<script setup lang="ts">
/**
 * Vertical stack for linked trading panes: bind the same `v-model:domain` on each child
 * (`NardukCandleChart`) and pass `v-model:x-window` to `NardukLineChart` rows derived from
 * `candleIndexAtTime` / `candleTimeAtIndex`.
 */
import type { CandleTimeDomain } from '../types'

const domainModel = defineModel<CandleTimeDomain | null>('domain', { default: null })
</script>

<template>
  <div class="narduk-chart-stack min-w-0">
    <slot
      :domain="domainModel"
      :domain-model="domainModel"
    />
  </div>
</template>
