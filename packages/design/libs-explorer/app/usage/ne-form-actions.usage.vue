<script setup lang="ts">
const name = ref('Night shift')
const outcome = ref('Nothing saved yet.')

function save() {
  outcome.value = `Saved “${name.value}”.`
}
</script>

<template>
  <!-- Cancel first, the primary last: the primary is rightmost, and on top on
       a phone. A destructive action stands alone in #lead, at the far left. -->
  <form class="space-y-4" @submit.prevent="save">
    <UFormField label="Name">
      <UInput v-model="name" />
    </UFormField>
    <NeFormActions>
      <template #lead>
        <UButton type="button" color="error" variant="outline" @click="outcome = 'Deleted.'">
          Delete
        </UButton>
      </template>
      <UButton type="button" color="neutral" variant="ghost" @click="outcome = 'Cancelled.'">
        Cancel
      </UButton>
      <UButton type="submit">Save</UButton>
    </NeFormActions>
    <p class="text-sm" data-testid="form-actions-outcome">{{ outcome }}</p>
  </form>
</template>
