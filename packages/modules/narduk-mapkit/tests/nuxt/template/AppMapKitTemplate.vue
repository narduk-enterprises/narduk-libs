<script setup lang="ts">
/**
 * vue-tsc gate for narduk-libs#573: `<AppMapKit>` written in an SFC template
 * must infer the app's item type from `items`, so callbacks narrowed to it
 * type-check with no cast, and a callback reading a field the item lacks fails.
 * `InstanceType<typeof AppMapKit<Station>>` (app-map-kit-generic.test.ts) does
 * not exercise this path; only a template does.
 */
import AppMapKit from '../../../src/nuxt/runtime/components/AppMapKit.js'

interface Station {
  depth: number
  id: string
  label: string
  lat: number
  lng: number
}

const stations: Station[] = [{ depth: 3, id: 'a', label: 'A', lat: 29, lng: -95 }]

function createPinElement(item: Station, isSelected: boolean) {
  const element = document.createElement('span')
  element.textContent = `${item.label}${isSelected ? '*' : ''} ${item.depth}`
  return { element }
}
const itemKey = (item: Station) => item.id
const itemLabel = (item: Station) => item.label
const pinGeometry = (item: Station) => ({ size: { height: item.depth, width: item.depth } })
</script>

<template>
  <div>
    <AppMapKit
      :create-pin-element="createPinElement"
      :item-key="itemKey"
      :item-label="itemLabel"
      :items="stations"
      :pin-geometry="pinGeometry"
    >
      <template #callout="{ item }">{{ item.label.toUpperCase() }}</template>
    </AppMapKit>
    <!-- @vue-expect-error `notAField` is not on Station: T must not widen to any. -->
    <AppMapKit :item-label="(item) => item.notAField" :items="stations" />
  </div>
</template>
