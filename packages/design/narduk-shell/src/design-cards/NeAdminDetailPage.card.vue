<script setup lang="ts">
/*
 * NE Base design card for NeAdminDetailPage — components backlog item 20
 * (narduk-libs#267): one record under a page header with its actions, and
 * the loading reading that stands in for it while the read is in flight.
 * The delete button opens NeConfirmDialog through useConfirm() on click; the
 * handler here only waits, so nothing is ever deleted from the gallery.
 */
import UButton from '@nuxt/ui/components/Button.vue'

import NeAdminDetailPage from '../runtime/components/NeAdminDetailPage.vue'

import type { NeDetailItem } from '../runtime/components/ne-detail-view-types'

const items: NeDetailItem[] = [
  { label: 'Name', value: 'runner-01' },
  { label: 'Jobs run', format: 'number', value: 1204 },
  { label: 'Registered', format: 'date', value: '2026-03-14T09:30:00Z' },
  { label: 'Last seen', value: null },
]

async function remove() {
  await new Promise((resolve) => setTimeout(resolve, 1000))
}
</script>

<template>
  <section
    class="preview-card"
    data-design-card="ne-admin-detail-page"
    data-name="Admin detail page"
    data-group="Shell"
  >
    <h2>Admin detail page</h2>
    <p>
      <code>NePageHeader</code> with actions over <code>NeDetailView</code>, gated by
      <code>NeStatePanel</code>. Delete asks through <code>useConfirm()</code> first.
    </p>

    <div class="preview-row">
      <NeAdminDetailPage
        title="runner-01"
        eyebrow="Runners"
        description="Self-hosted runner in the ord-1 pool."
        :items="items"
        time-zone="America/Chicago"
        unavailable-message="Never"
        :on-delete="remove"
      >
        <template #actions>
          <UButton label="Edit" color="neutral" variant="outline" />
        </template>
      </NeAdminDetailPage>
      <p class="mono">record · a missing reading says so, never 0</p>
    </div>

    <div class="preview-row">
      <NeAdminDetailPage
        title="runner-01"
        :items="items"
        status="pending"
        loading-title="Loading runner"
        :on-delete="remove"
      />
      <p class="mono">loading · no record, so no delete action</p>
    </div>
  </section>
</template>
