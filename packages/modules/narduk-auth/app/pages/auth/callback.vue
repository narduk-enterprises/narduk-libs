<script setup lang="ts">
useSeoMeta({
  title: 'Sign In Callback',
  description: 'Completing the auth callback and creating your app session.',
  robots: 'noindex, nofollow',
})
</script>

<template>
  <div class="flex min-h-[calc(100vh-8rem)] items-center justify-center px-4 py-12">
    <AuthExchangePanel />
  </div>
</template>
