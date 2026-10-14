<script setup lang="ts">
/*
 * NE Base design card for NeMeter (narduk-libs#601) and the unreported
 * treatment (narduk-libs#602).
 *
 * The row worth reviewing is the pair in the middle: a reported zero is an
 * empty track, an unreported figure is the hatch with an em-dash. Those two
 * must never look alike. Both variants, an overrun, the multi-segment reading
 * (with a part nobody reported) and the inline shape as it sits in a dense list
 * complete the set.
 */
import NeMeter from '../runtime/components/NeMeter.vue'
</script>

<template>
  <section class="preview-card" data-design-card="ne-meter" data-name="Meter" data-group="Shell">
    <h2>Meter</h2>
    <p>
      One value against a known ceiling. A figure with no producer takes the hatch and an em-dash —
      texture with no magnitude — so it never reads as zero.
    </p>
    <div class="preview-row">
      <NeMeter label="Core REST" :value="4200" :max="5000" />
    </div>
    <div class="preview-row">
      <NeMeter label="GraphQL (reported zero)" :value="0" :max="5000" />
    </div>
    <div class="preview-row">
      <NeMeter label="Search (not reported)" :value="null" :max="30" />
    </div>
    <div class="preview-row">
      <NeMeter label="Storage (over the ceiling)" :value="5400" :max="5000" />
    </div>
    <div class="preview-row">
      <NeMeter
        label="Disk (segments)"
        :max="100"
        :segments="[
          { label: 'Used', value: 48, tone: 'warn' },
          { label: 'Cache', value: 22, tone: 'info' },
          { label: 'Logs', value: 6, tone: 'neutral' },
        ]"
      />
    </div>
    <div class="preview-row">
      <NeMeter
        label="Checks (one part unreported)"
        :max="40"
        :segments="[
          { label: 'Passed', value: 28, tone: 'ok' },
          { label: 'Failed', value: 3, tone: 'error' },
          { label: 'Skipped', value: null },
        ]"
      />
    </div>
    <div class="preview-row">
      <NeMeter label="Headroom" :value="1280" :max="2000" variant="inline" />
    </div>
    <div class="preview-row">
      <NeMeter label="Headroom" :value="null" :max="2000" variant="inline" />
    </div>
  </section>
</template>
