<script setup lang="ts">
definePageMeta({
  middleware: ['auth'],
})
</script>

<template>
  <div class="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-10 sm:px-6 lg:px-8">
    <div class="space-y-2">
      <p class="text-xs font-semibold uppercase tracking-[0.18em] text-dimmed">Settings</p>
      <h1 class="font-display text-3xl font-semibold text-highlighted">API tokens</h1>
      <p class="max-w-3xl text-sm text-muted">
        Create personal access tokens for automation, local tooling, and operator workflows. Tokens
        inherit your account permissions, so revoke anything you no longer trust.
      </p>
    </div>

    <AuthApiKeysPanel />
  </div>
</template>
