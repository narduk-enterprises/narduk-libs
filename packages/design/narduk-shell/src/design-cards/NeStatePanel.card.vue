<script setup lang="ts">
/*
 * NE Base design card for NeStatePanel — components backlog item 3
 * (narduk-libs#250), shipping the card for item 7 (narduk-libs#254).
 *
 * All five readings the component exists to keep distinct: unknown is never a
 * zero. See the README's "NeStatePanel" section for the full reading table.
 */
import NeStatePanel from '../runtime/components/NeStatePanel.vue'
</script>

<template>
  <section
    class="preview-card"
    data-design-card="ne-state-panel"
    data-name="State panel"
    data-group="Shell"
  >
    <h2>State panel</h2>
    <p>
      One reading per row: <code>loading</code>, <code>empty</code>, <code>error</code>,
      <code>blocked</code> and <code>absent</code> never collapse into the same shape or the same
      wording.
    </p>
    <div class="preview-row">
      <NeStatePanel state="loading" title="Loading runners" message="Checking in with the fleet." />
    </div>
    <div class="preview-row">
      <NeStatePanel
        state="empty"
        title="No runners"
        message="No runner has registered with the fleet yet."
        icon="i-lucide-server"
      />
    </div>
    <div class="preview-row">
      <NeStatePanel
        state="error"
        title="Could not load runners"
        message="The fleet API did not respond."
      />
    </div>
    <div class="preview-row">
      <NeStatePanel
        state="blocked"
        title="Waiting on upstream"
        message="This view depends on a read that did not answer."
        unblocks-on="the fleet heartbeat responds"
        unblocks-ref="operator-portal#152"
      />
    </div>
    <div class="preview-row">
      <NeStatePanel
        state="absent"
        title="Not tracked"
        message="No producer publishes this fact yet."
      />
    </div>
  </section>
</template>
