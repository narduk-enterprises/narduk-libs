<script setup lang="ts">
/*
 * NE Base design card for NeCommandPalette: the dialog the header button and
 * Cmd/Ctrl+K open. A closed dialog draws nothing, so the card carries the
 * trigger that opens a live palette over sample groups: pages and states that
 * the palette filters itself, and a "Rivers" group answered by a small async
 * provider that waits, so the loading and the grouped result both show.
 *
 * The shortcuts are off here (`:shortcuts="false"`) so a gallery page that
 * already binds Cmd+K is not bound twice; click the button to open it.
 */
import NeCommandPalette from '../runtime/components/NeCommandPalette.vue'
import NeCommandPaletteTrigger from '../runtime/components/NeCommandPaletteTrigger.vue'
import { useCommandPalette } from '../runtime/composables/use-command-palette'

import type { NeCommandGroup, NeCommandItem } from '../runtime/components/ne-command-palette-types'

const palette = useCommandPalette()

const DEMO_DESTINATION = '#'
const RIVER_ICON = 'i-lucide-waves'

const RIVERS: NeCommandItem[] = [
  {
    id: 'brazos-san-felipe',
    label: 'Brazos River above San Felipe, Texas',
    description: 'Fort Bend County, Texas',
    to: DEMO_DESTINATION,
    badge: { label: 'Normal', tone: 'success' },
    icon: RIVER_ICON,
    actions: [{ id: 'map', label: 'Show on map', icon: 'i-lucide-map-pin', to: DEMO_DESTINATION }],
  },
  {
    id: 'brazos-aspermont',
    label: 'Brazos River at Aspermont, Texas',
    description: 'Stonewall County, Texas',
    to: DEMO_DESTINATION,
    badge: { label: 'Action', tone: 'warning' },
    icon: RIVER_ICON,
    actions: [{ id: 'map', label: 'Show on map', icon: 'i-lucide-map-pin', to: DEMO_DESTINATION }],
  },
  {
    id: 'missouri',
    label: 'Missouri River',
    description: 'Missouri',
    to: DEMO_DESTINATION,
    badge: { label: 'Normal', tone: 'success' },
    icon: RIVER_ICON,
  },
  {
    id: 'mississippi',
    label: 'Mississippi River',
    description: 'Louisiana, Mississippi',
    to: DEMO_DESTINATION,
    badge: { label: 'Action', tone: 'warning' },
    icon: RIVER_ICON,
  },
  {
    id: 'milk',
    label: 'Milk River',
    description: 'Montana',
    to: DEMO_DESTINATION,
    badge: { label: 'Low', tone: 'neutral' },
    icon: RIVER_ICON,
  },
]

const groups: NeCommandGroup[] = [
  {
    id: 'rivers',
    label: 'Rivers',
    rank: 'match',
    async search(query) {
      await new Promise((resolve) => setTimeout(resolve, 250))
      return RIVERS.filter((river) => river.label.toLowerCase().includes(query.toLowerCase()))
    },
  },
  {
    id: 'states',
    label: 'States',
    items: [
      {
        id: 'MO',
        label: 'Missouri',
        description: '412 gauges',
        keywords: ['MO'],
        to: DEMO_DESTINATION,
        icon: 'i-lucide-map',
      },
      {
        id: 'MS',
        label: 'Mississippi',
        description: '188 gauges',
        keywords: ['MS'],
        to: DEMO_DESTINATION,
        icon: 'i-lucide-map',
      },
      {
        id: 'MT',
        label: 'Montana',
        description: '305 gauges',
        keywords: ['MT'],
        to: DEMO_DESTINATION,
        icon: 'i-lucide-map',
      },
    ],
  },
  {
    id: 'pages',
    label: 'Pages',
    idleLimit: 3,
    items: [
      { id: 'map', label: 'Map', to: DEMO_DESTINATION, icon: 'i-lucide-map-pin' },
      { id: 'rivers', label: 'Rivers', to: DEMO_DESTINATION, icon: RIVER_ICON },
      { id: 'about', label: 'About', to: DEMO_DESTINATION, icon: 'i-lucide-info' },
    ],
  },
]

/** The card's links go nowhere; choosing a row only closes the palette. */
const navigate = async () => {}
</script>

<template>
  <section
    class="preview-card"
    data-design-card="ne-command-palette"
    data-name="Command palette"
    data-group="Shell"
  >
    <h2>Command palette</h2>
    <p>
      One search for the whole app. Click the button, then type <code>miss</code>: states answer at
      once, the Rivers group arrives after its debounce, and each group is listed under its heading.
      Arrow keys move, Enter goes, Escape closes. On a phone it is a full-screen sheet.
    </p>
    <div class="preview-row">
      <NeCommandPaletteTrigger placeholder="Find a river, state or page" :shortcuts="false" />
      <button type="button" class="mono" @click="palette.open()">open palette</button>
    </div>
    <NeCommandPalette
      :groups="groups"
      title="Search the demo"
      placeholder="Find a river, state or page"
      recents-key="ne-command-palette:card"
      :navigate="navigate"
    />
  </section>
</template>
