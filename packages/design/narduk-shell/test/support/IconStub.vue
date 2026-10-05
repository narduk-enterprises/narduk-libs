<script setup lang="ts">
/*
 * `UIcon` for unit tests. Nuxt UI's Vue-mode icon asks Iconify's API for the
 * glyph over the network, which a test must not do (and which leaves aborted
 * fetches in the log at teardown). The icon's name is kept as an attribute so
 * a test can still see which icon a row asked for.
 */
defineProps<{ name: unknown }>()
</script>

<template>
  <span class="ne-test-icon" :data-icon="typeof name === 'string' ? name : undefined" />
</template>
