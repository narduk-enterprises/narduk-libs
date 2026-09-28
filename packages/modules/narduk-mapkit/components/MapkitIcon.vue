<script setup lang="ts">
/**
 * Renders one kit icon: a raw SVG path `d` string (kit icons are path data,
 * not an icon-set name, so the kit owns its glyphs), for `LensRail.vue` and
 * for callers outside `mapkit/` that still need to paint one --
 * `PhoneLensDock.vue`'s lens buttons, which otherwise use Nuxt UI's `<UIcon>`.
 */
defineProps<{ d: string }>()
</script>

<template>
  <svg aria-hidden="true" height="18" viewBox="0 0 24 24" width="18">
    <path
      :d="d"
      fill="none"
      stroke="currentColor"
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-width="2"
    />
  </svg>
</template>
