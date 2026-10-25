<script setup lang="ts">
// A server-resolved async value is what forces Nuxt to serialize an inline
// hydration payload; a static page would prove nothing about the payload
// script needing a nonce.
const { data: reading } = await useAsyncData('reading', () =>
  Promise.resolve({ station: '41008', waveHeightMetres: 1.4, at: '2026-09-17T03:00:00.000Z' }),
)

// Untrusted markup that reaches SSR through v-html; it must never get the page nonce.
const injected = '<script data-xss>window.__xss = true</scr' + 'ipt>'
</script>

<template>
  <main>
    <p data-testid="station">{{ reading?.station }}</p>
    <p data-testid="wave">{{ reading?.waveHeightMetres }}</p>
    <div data-testid="injected" v-html="injected" />
  </main>
</template>
