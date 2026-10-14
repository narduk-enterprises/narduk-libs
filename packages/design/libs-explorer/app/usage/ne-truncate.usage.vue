<script setup lang="ts">
const ogImage =
  'https://cdn.example.com/assets/brand/social/og-image-1200x630-2026-10-14-final-v3.png?v=8f3a1c2d'
</script>

<template>
  <ul class="w-64 space-y-2 text-sm">
    <li><NeTruncate :text="ogImage" kind="url" /></li>
    <li><NeTruncate text="/var/lib/narduk/releases/2026-10-14/build-output.tar.gz" kind="path" /></li>
    <li><NeTruncate text="3f9c1a52-7d4e-4b8a-9e0f-62c1d8a7b305" kind="id" :tail="8" /></li>
  </ul>
</template>
