<script setup lang="ts">
/*
 * NE Base design card for NeStatusBadge — components backlog item 3
 * (narduk-libs#250), shipping the card for item 8 (narduk-libs#255).
 *
 * One badge per tone, in the README's tone -> colour table order. `pending`
 * is the only tone with its own default variant and icon.
 */
import NeStatusBadge from '../runtime/components/NeStatusBadge.vue'
</script>

<template>
  <section
    class="preview-card"
    data-design-card="ne-status-badge"
    data-name="Status badge"
    data-group="Shell"
  >
    <h2>Status badge</h2>
    <p>Colour is never the only signal: the tone is folded into the accessible name too.</p>
    <div class="preview-row">
      <NeStatusBadge tone="ok" label="Operational" />
      <NeStatusBadge tone="warn" label="Degraded" />
      <NeStatusBadge tone="error" label="Offline" />
      <NeStatusBadge tone="info" label="Maintenance" />
      <NeStatusBadge tone="neutral" label="Unknown" />
      <NeStatusBadge tone="pending" label="Connecting" />
    </div>
  </section>
</template>
