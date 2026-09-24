<script setup lang="ts">
const state = reactive({ name: '' })
const saved = ref<string | null>(null)

// Any Standard Schema (zod, valibot) works as :schema; a validate function
// needs no extra dependency. It returns Nuxt UI form errors.
function validate(values: Record<string, unknown>) {
  const name = typeof values.name === 'string' ? values.name.trim() : ''
  return name ? [] : [{ name: 'name', message: 'Name is required' }]
}

async function save(data: Record<string, unknown>) {
  saved.value = String(data.name)
}
</script>

<template>
  <div class="space-y-3">
    <NeForm :state="state" :validate="validate" :on-submit="save">
      <UFormField name="name" label="Name">
        <UInput v-model="state.name" />
      </UFormField>
    </NeForm>
    <p v-if="saved" class="text-sm">Saved “{{ saved }}”.</p>
  </div>
</template>
