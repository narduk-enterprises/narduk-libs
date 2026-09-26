<script setup lang="ts">
const deleted = ref(false)

async function remove() {
  // Call your DELETE endpoint here. A rejection stays in the dialog for a retry.
  await new Promise((resolve) => setTimeout(resolve, 600))
}
</script>

<template>
  <NeAdminDetailPage
    title="runner-01"
    eyebrow="Runners"
    description="Self-hosted runner in the ord-1 pool."
    :items="[
      { label: 'Name', value: 'runner-01' },
      { label: 'Jobs run', format: 'number', value: 1204 },
      { label: 'Registered', format: 'date', value: '2026-03-14T09:30:00Z' },
      { label: 'Last seen', value: null },
    ]"
    time-zone="America/Chicago"
    unavailable-message="Never"
    :on-delete="remove"
    @deleted="deleted = true"
  >
    <template #actions>
      <UButton label="Edit" color="neutral" variant="outline" />
    </template>
    <p v-if="deleted" class="text-sm text-muted">Deleted — a real page navigates away here.</p>
  </NeAdminDetailPage>
</template>
