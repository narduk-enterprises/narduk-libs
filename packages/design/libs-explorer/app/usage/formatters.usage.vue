<script setup lang="ts">
import {
  formatCompact,
  formatDate,
  formatDuration,
  formatMoney,
  formatNumber,
  formatPercent,
} from '@narduk-enterprises/narduk-shell/format'

defineOptions({ name: 'FormattersExample' })

// Fixed inputs and an explicit time zone: the same output on the server and in
// every browser, which is what keeps a prerendered page from mismatching.
const rows = [
  ['formatNumber(1234.5678, { digits: 2 })', formatNumber(1234.5678, { digits: 2 })],
  ['formatCompact(1_234_567)', formatCompact(1_234_567)],
  ['formatPercent(0.055)', formatPercent(0.055)],
  ["formatMoney(1234.5, { currency: 'USD' })", formatMoney(1234.5, { currency: 'USD' })],
  ['formatDuration(5_400_000)', formatDuration(5_400_000)],
  [
    "formatDate('2026-03-08T08:30:00Z', { timeZone: 'America/Chicago' })",
    formatDate('2026-03-08T08:30:00Z', { timeZone: 'America/Chicago' }),
  ],
] as const
</script>

<template>
  <dl class="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
    <template v-for="[call, result] in rows" :key="call">
      <dt class="font-mono text-xs text-muted">{{ call }}</dt>
      <dd class="font-mono">{{ result }}</dd>
    </template>
  </dl>
</template>
