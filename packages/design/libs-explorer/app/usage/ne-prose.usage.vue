<script setup lang="ts">
const source = [
  '## Rotate the API key',
  '',
  'Rotate it **before** it expires; the current one is in `API_KEY`.',
  '',
  '1. Create the new key.',
  '2. Store it, staging first.',
  '3. Revoke the old key.',
].join('\n')
</script>

<template>
  <NeProse :source="source" />
</template>
