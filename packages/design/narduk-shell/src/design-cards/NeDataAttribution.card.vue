<script setup lang="ts">
/*
 * NE Base design card for NeDataAttribution (narduk-libs#388): the one
 * "Data from <source>, updated <time>" credit. Fixed `now` and zone, so the
 * prerendered card reads the same every build. No `href` here: NE Base cards
 * may not carry external links (design-system-build refuses them), so the
 * linked form is shown in the Explorer's usage page instead.
 */
import NeDataAttribution from '../runtime/components/NeDataAttribution.vue'
</script>

<template>
  <section
    class="preview-card"
    data-design-card="ne-data-attribution"
    data-name="Data attribution"
    data-group="Shell"
  >
    <h2>Data attribution</h2>
    <p>
      A consistent source credit. Times go through <code>./format</code> in the caller's zone;
      relative only when the caller passes <code>now</code>.
    </p>

    <div class="preview-row">
      <NeDataAttribution
        :sources="{ name: 'NOAA NDBC' }"
        updated-at="2026-03-08T09:00:00Z"
        now="2026-03-08T12:00:00Z"
        time-zone="America/Chicago"
      />
      <p class="mono">one source · relative time</p>
    </div>

    <div class="preview-row">
      <NeDataAttribution
        :sources="[
          { name: 'NOAA NDBC', license: 'Public domain', updatedAt: '2026-03-08T11:00:00Z' },
          { name: 'USGS', updatedAt: '2026-03-08' },
        ]"
        time-zone="America/Chicago"
      />
      <p class="mono">two sources · own licence and publish time each, absolute</p>
    </div>
  </section>
</template>
