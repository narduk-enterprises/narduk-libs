<script setup lang="ts">
/*
 * NE Base design card for NeConfirmDialog — components backlog item 3
 * (narduk-libs#250), shipping the card for item 16 (narduk-libs#263).
 *
 * NeConfirmDialog server-renders no dialog markup at all, open or closed:
 * it wraps Nuxt UI's `UModal`, which Reka UI teleports into a client-side
 * portal only after the app mounts (`test/NeConfirmDialog.ssr.test.ts`
 * asserts exactly this). Cards are prerendered statically by
 * design-system-build's `nuxt generate`, so the dialog chrome itself never
 * reaches NE Base -- this card still renders the component with its real
 * props, both calling shapes from the README, and says why the preview is
 * text rather than a screenshot of an open modal.
 */
import NeConfirmDialog from '../runtime/components/NeConfirmDialog.vue'
</script>

<template>
  <section
    class="preview-card"
    data-design-card="ne-confirm-dialog"
    data-name="Confirm dialog"
    data-group="Shell"
  >
    <h2>Confirm dialog</h2>
    <p>
      Wraps Nuxt UI's <code>UModal</code>, which Reka UI portals onto
      <code>document.body</code> only once the client mounts, so the dialog itself renders no markup
      here, open or closed. The props below are the two documented calling shapes.
    </p>
    <div class="preview-row">
      <NeConfirmDialog
        open
        title="Close all positions?"
        message="Every open position closes at the current market price."
        confirm-label="Close all"
        tone="danger"
      />
      <p class="mono">tone="danger"</p>
    </div>
    <div class="preview-row">
      <NeConfirmDialog
        open
        title="End game?"
        message="Positions are closed at market and standings are final."
        confirm-label="End game"
        pending
      />
      <p class="mono">pending</p>
    </div>
  </section>
</template>
