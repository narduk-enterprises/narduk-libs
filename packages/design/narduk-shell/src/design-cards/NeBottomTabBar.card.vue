<script setup lang="ts">
/*
 * NE Base design card for NeBottomTabBar.
 *
 * The bar is `position: fixed`, so the demonstration frame is given a
 * transform, which makes it the bar's containing block. `phone-only` is off
 * because the gallery is a desktop page, and `path` is passed so the card
 * shows a lit tab without depending on the gallery's own route. Targets sit
 * under `/example/`, which the explorer's prerender crawl skips.
 */
import NeBottomTabBar from '../runtime/components/NeBottomTabBar.vue'

const items = [
  { label: 'Map', to: '/example', icon: 'i-lucide-map' },
  { label: 'Stations', to: '/example/stations', icon: 'i-lucide-menu' },
  { label: 'Cams', to: '/example/cams', icon: 'i-lucide-camera' },
  { label: 'About', to: '/example/about', icon: 'i-lucide-info' },
]
</script>

<template>
  <section
    class="preview-card"
    data-design-card="ne-bottom-tab-bar"
    data-name="Bottom tab bar"
    data-group="Shell"
  >
    <h2>Bottom tab bar</h2>
    <p>
      The phone's top-level navigation. One tab is lit (exact path, then the longest section
      prefix), it clears the home indicator, and a spacer keeps it off the last row.
    </p>
    <div
      class="preview-row"
      style="
        position: relative;
        width: 22rem;
        height: 11rem;
        overflow: hidden;
        transform: translate(0);
        border: 1px solid var(--ne-hairline);
      "
    >
      <p style="margin: 0.75rem 1rem">Station 42</p>
      <NeBottomTabBar :items="items" path="/example/stations/42" :phone-only="false" />
    </div>
  </section>
</template>
