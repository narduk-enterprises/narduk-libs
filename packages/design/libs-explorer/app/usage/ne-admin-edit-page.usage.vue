<script setup lang="ts">
const state = reactive({ name: 'runner-01', pool: 'ord-1' })

async function save() {
  // PATCH the record here, then navigate back to its detail page.
}
</script>

<template>
  <NeAdminEditPage
    title="Edit runner"
    eyebrow="Runners"
    :state="state"
    save-label="Save runner"
    :on-submit="save"
    cancel-to="/"
  >
    <NeFormSection title="General">
      <UFormField name="name" label="Name">
        <UInput v-model="state.name" />
      </UFormField>
      <UFormField name="pool" label="Pool">
        <UInput v-model="state.pool" />
      </UFormField>
    </NeFormSection>
  </NeAdminEditPage>
</template>
