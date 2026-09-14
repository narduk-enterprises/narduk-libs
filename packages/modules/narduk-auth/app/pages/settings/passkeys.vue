<script setup lang="ts">
definePageMeta({
  middleware: ['auth'],
})
</script>

<template>
  <div class="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-10 sm:px-6 lg:px-8">
    <div class="space-y-2">
      <p class="text-xs font-semibold uppercase tracking-[0.18em] text-dimmed">Settings</p>
      <h1 class="font-display text-3xl font-semibold text-highlighted">Passkeys</h1>
      <p class="max-w-3xl text-sm text-muted">
        Register one passkey per device you sign in from. A passkey is bound to this exact hostname,
        so staging and production need their own.
      </p>
    </div>

    <AuthPasskeysPanel />
  </div>
</template>
