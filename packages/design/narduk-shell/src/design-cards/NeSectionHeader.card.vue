<script setup lang="ts">
/*
 * NE Base design card for NeSectionHeader — components backlog item 3
 * (narduk-libs#250), shipping the card for item 9 (narduk-libs#256).
 *
 * `UButton` is imported explicitly, not written as a bare global tag — see
 * NePageHeader.card.vue's header comment for why.
 */
import UButton from '@nuxt/ui/components/Button.vue'

import NeSectionHeader from '../runtime/components/NeSectionHeader.vue'
</script>

<template>
  <section
    class="preview-card"
    data-design-card="ne-section-header"
    data-name="Section header"
    data-group="Shell"
  >
    <h2>Section header</h2>
    <div class="preview-row">
      <NeSectionHeader
        title="Recent"
        :count="12"
        description="Runners that reported in the last hour."
      >
        <template #actions>
          <UButton label="View all" variant="ghost" />
        </template>
      </NeSectionHeader>
    </div>
  </section>
</template>
