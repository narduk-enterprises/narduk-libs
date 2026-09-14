<script setup lang="ts">
/**
 * A standard, unconstrained layout designed for full-bleed landing pages.
 * Unlike the default layout, it opts out of the max-w-7xl px-4 container,
 * allowing hero sections and content blocks to stretch edge-to-edge.
 */
</script>

<template>
  <div class="landing-layout min-h-screen">
    <slot />
  </div>
</template>
