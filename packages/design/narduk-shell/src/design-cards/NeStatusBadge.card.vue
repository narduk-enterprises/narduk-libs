<script setup lang="ts">
/*
 * NE Base design card for NeStatusBadge — components backlog item 3
 * (narduk-libs#250), shipping the card for item 8 (narduk-libs#255).
 *
 * One badge per tone, in the README's tone -> colour table order. `pending`
 * has its own default variant and icon; `unreported` has its own default
 * variant, the `--ne-hatch-soft` material, and no `label` prop, so it draws
 * `NE_UNREPORTED_TEXT` ("Not reported") on its own (narduk-libs#602).
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
      <NeStatusBadge tone="unreported" />
    </div>
  </section>
</template>
