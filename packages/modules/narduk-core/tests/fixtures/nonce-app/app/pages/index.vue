<script setup lang="ts">
// A server-resolved async value is what forces Nuxt to serialize an inline
// hydration payload; a static page would prove nothing about the payload
// script needing a nonce.
const { data: reading } = await useAsyncData('reading', () =>
  Promise.resolve({ station: '41008', waveHeightMetres: 1.4, at: '2026-09-17T03:00:00.000Z' }),
)
</script>

<template>
  <main>
    <p data-testid="station">{{ reading?.station }}</p>
    <p data-testid="wave">{{ reading?.waveHeightMetres }}</p>
  </main>
</template>
