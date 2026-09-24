<script setup lang="ts">
// A preview frame draws only the preview: no Explorer navigation, no footer.
useHead({ meta: [{ name: 'robots', content: 'noindex' }] })
</script>

<template>
  <div>
    <slot />
  </div>
</template>
