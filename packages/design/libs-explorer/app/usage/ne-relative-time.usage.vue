<script setup lang="ts">
// A fixed `now` keeps the page deterministic. Leave it out in an app and the
// text follows the shared 30 second clock.
const now = '2026-10-21T18:00:00Z'
</script>

<template>
  <ul class="space-y-1 text-sm">
    <li>
      Filled <NeRelativeTime value="2026-10-21T17:57:00Z" :now="now" time-zone="America/Chicago" />
    </li>
    <li>
      Joined <NeRelativeTime value="2026-10-02T15:00:00Z" :now="now" time-zone="America/Chicago" />
    </li>
    <li>Closed <NeRelativeTime :value="null" :now="now" time-zone="America/Chicago" /></li>
  </ul>
</template>
