<script setup lang="ts">
/*
 * NE Base design card for NeTruncate (narduk-libs#1855).
 *
 * One line each for a URL, a path and an id in a narrow column, so the head
 * ellipsis and the whole tail show; the last row is `mode="end"`.
 */
import NeTruncate from '../runtime/components/NeTruncate.vue'

const url =
  'https://cdn.example.com/assets/brand/social/og-image-1200x630-2026-10-14-final-v3.png?v=8f3a1c2d'
</script>

<template>
  <section
    class="preview-card"
    data-design-card="ne-truncate"
    data-name="Truncate"
    data-group="Shell"
  >
    <h2>Truncate</h2>
    <p>The head shrinks, the tail stays whole; the full value is the tooltip and click expands it.</p>
    <div class="preview-col" style="width: 16rem">
      <NeTruncate :text="url" kind="url" />
      <NeTruncate text="/var/lib/narduk/releases/2026-10-14/build-output.tar.gz" kind="path" />
      <NeTruncate text="3f9c1a52-7d4e-4b8a-9e0f-62c1d8a7b305" kind="id" :tail="8" />
      <NeTruncate :text="url" mode="end" />
    </div>
  </section>
</template>
