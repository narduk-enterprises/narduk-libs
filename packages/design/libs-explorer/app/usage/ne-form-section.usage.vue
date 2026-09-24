<script setup lang="ts">
const state = reactive({ name: 'Logan', email: '' })

async function save() {
  // Persist `state` here.
}
</script>

<template>
  <NeForm :state="state" :on-submit="save">
    <NeFormSection title="Profile" description="Shown to your team.">
      <UFormField name="name" label="Name">
        <UInput v-model="state.name" />
      </UFormField>
      <UFormField name="email" label="Email">
        <UInput v-model="state.email" type="email" />
      </UFormField>
    </NeFormSection>
  </NeForm>
</template>
