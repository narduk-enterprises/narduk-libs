<script setup lang="ts">
// Binds Cmd/Ctrl+K and "/" once, and returns the shared open state.
const palette = useCommandPaletteShortcuts()
</script>

<template>
  <div class="space-y-2">
    <NeCommandPaletteTrigger placeholder="Find a river, town or gauge" fallback-action="/search" />
    <p class="font-mono text-xs">open: {{ palette.isOpen.value ? 'yes' : 'no' }}</p>
  </div>
</template>
