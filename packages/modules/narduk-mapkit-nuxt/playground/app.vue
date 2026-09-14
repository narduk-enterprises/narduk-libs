<script setup lang="ts">
interface Station {
  id: string
  lat: number
  lng: number
  name: string
}

const { mapkitError, mapkitReady } = useMapKit()
const selectedId = ref<string | null>(null)
const stations: Station[] = [
  { id: 'a', lat: 37.77, lng: -122.42, name: 'Alpha' },
  { id: 'b', lat: 37.8, lng: -122.4, name: 'Bravo' },
]
</script>

<template>
  <main>
    <h1>Narduk MapKit Nuxt</h1>
    <p>{{ mapkitReady ? 'ready' : mapkitError || 'not initialized during SSR' }}</p>
    <div style="height: 320px">
      <AppMapKit v-model:selected-id="selectedId" :items="stations" callouts>
        <AppMapKitCallout v-slot="{ close, item }" :items="stations">
          <article class="station-callout">
            <h2>{{ item.name }}</h2>
            <button type="button" @click="close">Close</button>
          </article>
        </AppMapKitCallout>
      </AppMapKit>
    </div>
  </main>
</template>
