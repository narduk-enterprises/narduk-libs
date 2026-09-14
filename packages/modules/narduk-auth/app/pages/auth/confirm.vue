<script setup lang="ts">
useSeoMeta({
  title: 'Confirming Your Email',
  description: 'Verifying your email confirmation link and finishing sign-in.',
  robots: 'noindex, nofollow',
})
</script>

<template>
  <div class="flex min-h-[calc(100vh-8rem)] items-center justify-center px-4 py-12">
    <AuthExchangePanel
      title="Confirming your email"
      description="We are finishing account confirmation and creating your app session."
    />
  </div>
</template>
