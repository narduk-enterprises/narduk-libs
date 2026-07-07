<script setup lang="ts">
definePageMeta({
  middleware: ['auth'],
})

await navigateTo('/settings/api-keys', { replace: true })
</script>

<template>
  <div />
</template>
