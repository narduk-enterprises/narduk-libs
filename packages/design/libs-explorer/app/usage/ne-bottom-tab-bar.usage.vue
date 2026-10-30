<script setup lang="ts">
const items = [
  { label: 'Map', to: '/example/map', icon: 'i-lucide-map' },
  { label: 'Stations', to: '/example/stations', icon: 'i-lucide-menu' },
  { label: 'Cams', to: '/example/cams', icon: 'i-lucide-camera' },
  { label: 'More', to: '/example/more', icon: 'i-lucide-ellipsis' },
]
</script>

<template>
  <!-- A transformed frame is the bar's containing block, so this demo pins to
       the frame. In a layout, drop the frame and the bar pins to the phone. -->
  <div
    class="relative h-44 w-full max-w-sm overflow-hidden rounded border border-default"
    style="transform: translate(0)"
  >
    <p class="m-3 text-sm">Station 42</p>
    <NeBottomTabBar
      :items="items"
      path="/example/stations/42"
      fallback="/example/more"
      :phone-only="false"
    />
  </div>
</template>
