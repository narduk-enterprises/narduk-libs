<script setup lang="ts" generic="TItem = unknown">
/**
 * AppMapKitCallout — the template half of a map callout.
 *
 * Place it inside `<AppMapKit callouts>` and write the callout's contents as
 * an ordinary scoped slot. One `<Teleport>` per open callout moves that slot
 * into the controller-owned host element, which keeps the content inside this
 * component's own Vue tree: reactivity, `provide`/`inject`, `useNuxtApp()`,
 * and Nuxt UI's app config all reach it exactly as they would anywhere else in
 * the page. That is the whole reason for a Teleport rather than a second
 * `createApp()` mounted into the host — a second app has no parent chain, so
 * every Nuxt UI component that reads its configuration through `inject` would
 * fall back to defaults or fail outright.
 *
 * @example
 * ```vue
 * <AppMapKit v-model:selected-id="selectedId" :items="stations" callouts>
 *   <AppMapKitCallout :items="stations" v-slot="{ item, close }">
 *     <UCard>
 *       <template #header>{{ item.name }}</template>
 *       <UButton @click="close">Close</UButton>
 *     </UCard>
 *   </AppMapKitCallout>
 * </AppMapKit>
 * ```
 */
import { computed, inject, onMounted, onUpdated } from 'vue'

import { appMapKitCalloutInjectionKey } from '../callouts'

defineProps<{
  /**
   * The same array passed to `<AppMapKit>`. Optional, and never read at
   * runtime -- it is the type witness that lets TypeScript infer `TItem` for
   * the slot. A child component cannot pick that up from its parent's own
   * generic, so without it `item` would arrive as `unknown` and every template
   * would need a cast.
   */
  items?: readonly TItem[]
}>()
// A root `<Teleport>` cannot receive fallthrough attributes. Declaring that
// here is the `narduk/no-attrs-on-fragment` fix; Teleport never applied them
// (narduk-libs#138).
defineOptions({ inheritAttrs: false })
defineSlots<{
  /** `calloutKey` rather than `key`, which Vue reserves on a `<slot>` element. */
  default: (props: { calloutKey: string; close: () => void; item: TItem }) => unknown
}>()

interface CalloutSlotEntry {
  host: HTMLElement
  item: TItem
  key: string
}

const injected = inject(appMapKitCalloutInjectionKey, null)
if (!injected) {
  throw new Error(
    '<AppMapKitCallout> must be used inside <AppMapKit callouts>. Add the `callouts` prop to the map and place the callout in its default slot.',
  )
}
const callouts = injected

/**
 * The injected entries are deliberately `unknown`-typed so one invariant
 * `InjectionKey` can serve every item type; this is the single place that
 * narrows them, using the generic the consumer wrote on the component.
 */
const entries = computed(() => callouts.entries.value as CalloutSlotEntry[])

/**
 * Content that grows or shrinks changes where the callout should sit, and only
 * Vue knows when that happened. The reposition is coalesced into the
 * controller's shared frame, so an update storm still costs one placement pass.
 */
onMounted(() => callouts.reposition())
onUpdated(() => callouts.reposition())
</script>

<template>
  <Teleport v-for="entry in entries" :key="entry.key" :to="entry.host">
    <slot :callout-key="entry.key" :close="() => callouts.close(entry.key)" :item="entry.item" />
  </Teleport>
</template>
