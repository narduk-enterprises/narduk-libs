<script setup lang="ts">
// useConfirm() is auto-imported by the narduk-shell module and resolves to
// true or false. It needs Nuxt UI's overlay host, which <UApp> provides.
const confirm = useConfirm()
const outcome = ref('Nothing deleted yet.')

async function deleteRunner() {
  const ok = await confirm({
    title: 'Delete runner?',
    message: 'The runner stops taking jobs. Its run history is kept.',
    confirmLabel: 'Delete',
    tone: 'danger',
  })
  outcome.value = ok ? 'Deleted.' : 'Kept.'
}
</script>

<template>
  <div class="space-y-2">
    <UButton color="error" icon="i-lucide-trash-2" @click="deleteRunner">Delete runner</UButton>
    <p class="text-sm" data-testid="confirm-outcome">{{ outcome }}</p>
  </div>
</template>
