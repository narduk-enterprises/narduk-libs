<script setup lang="ts">
const { mapkitError, mapkitReady } = useMapKit()
</script>

<template>
  <main>
    <h1>Narduk MapKit Nuxt</h1>
    <p>{{ mapkitReady ? 'ready' : mapkitError || 'not initialized during SSR' }}</p>
    <div style="height: 320px">
      <AppMapKit :items="[]" />
    </div>
  </main>
</template>
