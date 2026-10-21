<script setup lang="ts">
/*
 * NE Base design card for NeTabs.
 *
 * A plain strip with a panel, one with icons and a badge, and a strip with a
 * disabled tab. Selection is the first enabled tab; the card is static, so it
 * shows the selected state rather than the keyboard behaviour (see the mount
 * tests for roving focus and the route-backed mode).
 */
import NeTabs from '../runtime/components/NeTabs.vue'

const plain = [
  { value: 'overview', label: 'Overview' },
  { value: 'trades', label: 'Trades' },
  { value: 'rules', label: 'Rules' },
]
const rich = [
  { value: 'board', label: 'Leaderboard', icon: 'i-lucide-trophy' },
  { value: 'picks', label: 'Picks', icon: 'i-lucide-target', badge: 3 },
  { value: 'chat', label: 'Chat', icon: 'i-lucide-message-circle' },
]
const withDisabled = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'season', label: 'Season', disabled: true },
]
</script>

<template>
  <section class="preview-card" data-design-card="ne-tabs" data-name="Tabs" data-group="Shell">
    <h2>Tabs</h2>
    <p>
      Roving focus, <code>role="tablist"</code>, the active tab scrolled into view on a phone, and —
      with <code>route-param</code> — the selection kept in <code>?tab=</code>.
    </p>
    <div class="preview-row" style="width: 24rem">
      <NeTabs :items="plain" default-value="trades" label="Game sections">
        <template #default="{ value }">Panel: {{ value }}</template>
      </NeTabs>
    </div>
    <div class="preview-row" style="width: 24rem">
      <NeTabs :items="rich" label="With icons and a badge" />
    </div>
    <div class="preview-row" style="width: 24rem">
      <NeTabs :items="withDisabled" label="With a disabled tab" />
    </div>
  </section>
</template>
