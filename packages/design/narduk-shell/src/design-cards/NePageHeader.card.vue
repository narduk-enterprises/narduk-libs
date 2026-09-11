<script setup lang="ts">
/*
 * NE Base design card for NePageHeader — components backlog item 3
 * (narduk-libs#250), shipping the card for item 9 (narduk-libs#256).
 *
 * `UButton` is imported explicitly, not written as a bare global tag: this
 * card is mounted directly by the renderer, outside the Nuxt module, so
 * `addComponent` registration does not apply here (see the README's
 * "Shipping a design card" section).
 */
import UButton from '@nuxt/ui/components/Button.vue'

import NePageHeader from '../runtime/components/NePageHeader.vue'
</script>

<template>
  <section
    class="preview-card"
    data-design-card="ne-page-header"
    data-name="Page header"
    data-group="Shell"
  >
    <h2>Page header</h2>
    <div class="preview-row">
      <NePageHeader
        title="Runners"
        description="Every self-hosted runner class."
        eyebrow="Infrastructure"
        :breadcrumbs="[{ label: 'Infrastructure' }, { label: 'Runners' }]"
      >
        <template #actions>
          <UButton label="New" />
        </template>
      </NePageHeader>
    </div>
  </section>
</template>
