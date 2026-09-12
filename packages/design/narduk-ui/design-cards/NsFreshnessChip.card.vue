<script setup lang="ts">
/*
 * NE Base design card for NsFreshnessChip — components backlog item 22
 * (narduk-libs#269), backfilling the suite bar narduk-shell components are
 * already held to.
 *
 * Not wired into design-system-build's gallery yet (that build reads only
 * narduk-shell's `NE_SHELL_COMPONENTS` today, and this package's own hand-
 * authored cards live in `design-system-build/app/app.vue` instead) — this
 * card exists so `scripts/check-component-surface.mjs` has real evidence to
 * find, and is ready to render the day those two sources are unified.
 */
import NsFreshnessChip from "../instruments/NsFreshnessChip.vue";

const now = new Date("2026-07-30T12:00:00Z");
</script>

<template>
  <section
    class="preview-card"
    data-design-card="ns-freshness-chip"
    data-name="Freshness chip"
    data-group="Instruments"
  >
    <h2>Freshness chip</h2>
    <p>
      Classifies an observation's age against its own source interval: live, aging, stale, void.
    </p>
    <div class="preview-row">
      <NsFreshnessChip observed-at="2026-07-30T11:55:00Z" :interval-minutes="10" :now="now" />
      <NsFreshnessChip observed-at="2026-07-30T11:40:00Z" :interval-minutes="10" :now="now" />
      <NsFreshnessChip observed-at="2026-07-30T11:00:00Z" :interval-minutes="10" :now="now" />
      <NsFreshnessChip />
    </div>
  </section>
</template>
