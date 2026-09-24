<script setup lang="ts">
const state = reactive({ name: 'Buoys', timezone: 'America/Chicago' })

async function save() {
  // Persist `state` here.
}
</script>

<template>
  <NeSettingsPage
    title="Settings"
    description="How this app presents itself."
    :state="state"
    :on-submit="save"
  >
    <NeFormSection title="General">
      <UFormField name="name" label="Display name">
        <UInput v-model="state.name" />
      </UFormField>
      <UFormField name="timezone" label="Time zone">
        <UInput v-model="state.timezone" />
      </UFormField>
    </NeFormSection>
  </NeSettingsPage>
</template>
