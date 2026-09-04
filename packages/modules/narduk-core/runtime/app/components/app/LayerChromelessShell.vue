<script setup lang="ts">
/**
 * Viewport-sized wrapper for layouts used under `LayerAppShell` (e.g. auth,
 * blank). Does not add UApp, skip link, or `<main>` — those come from the root
 * shell so nested layouts do not duplicate landmarks or `#main-content`.
 */
</script>

<template>
  <div class="min-h-dvh w-full">
    <slot />
  </div>
</template>
