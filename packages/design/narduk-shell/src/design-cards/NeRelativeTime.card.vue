<script setup lang="ts">
/*
 * NE Base design card for NeRelativeTime.
 *
 * Every row measures against the same fixed `now`, so the card never moves: it
 * shows the relative range (seconds to weeks), the switch to an absolute date
 * after a week, a future instant, and the unreported placeholder. Hover a row
 * for the full date, time and zone name.
 */
import NeRelativeTime from '../runtime/components/NeRelativeTime.vue'

const now = '2026-03-08T20:30:00Z'
const zone = 'America/Chicago'
const rows = [
  { label: 'Seconds', value: '2026-03-08T20:29:40Z' },
  { label: 'Minutes', value: '2026-03-08T20:12:00Z' },
  { label: 'Hours', value: '2026-03-08T16:30:00Z' },
  { label: 'Days', value: '2026-03-05T20:30:00Z' },
  { label: 'Over a week: a date', value: '2026-02-20T20:30:00Z' },
  { label: 'In the future', value: '2026-03-08T22:30:00Z' },
  { label: 'No value', value: null },
]
</script>

<template>
  <section
    class="preview-card"
    data-design-card="ne-relative-time"
    data-name="Relative time"
    data-group="Shell"
  >
    <h2>Relative time</h2>
    <p>
      A real <code>&lt;time&gt;</code>: relative while live, a date after a week, the exact moment
      on hover. One shared 30-second ticker serves every instance on a page.
    </p>
    <div v-for="row in rows" :key="row.label" class="preview-row">
      <span style="display: inline-block; width: 11rem">{{ row.label }}</span>
      <NeRelativeTime :value="row.value" :now="now" :time-zone="zone" />
    </div>
  </section>
</template>
