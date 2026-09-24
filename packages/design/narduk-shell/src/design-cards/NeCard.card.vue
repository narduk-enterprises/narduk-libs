<script setup lang="ts">
/*
 * NE Base design card for NeCard (narduk-libs#264): media, title, badge,
 * stat rows, and the empty-stat reading — so a reviewer can see that a
 * missing measurement is an em dash, not a confident 0.
 */
import NeCard from '../runtime/components/NeCard.vue'
</script>

<template>
  <section class="preview-card" data-design-card="ne-card" data-name="Card" data-group="Shell">
    <h2>Card</h2>
    <p>
      One entity card wrapping <code>UCard</code>. Numbers go through <code>./format</code>. The
      badge speaks its tone; a missing stat is <code>—</code>, never 0.
    </p>

    <div class="preview-row">
      <NeCard
        title="Des Plaines at Riverside"
        :badge="{ label: 'Action', tone: 'warn' }"
        :stats="[
          { label: 'Stage', unit: 'foot', value: 5.2 },
          { label: 'Flow', unit: 'cfs', value: 1234 },
        ]"
      />
      <p class="mono">title · badge · measured rows</p>
    </div>

    <div class="preview-row">
      <NeCard title="Fox at Algonquin" :stats="[{ label: 'Stage', value: null }]" />
      <p class="mono">missing reading · em dash, not 0</p>
    </div>
  </section>
</template>
