<script setup lang="ts">
/**
 * AppSnapStrip — Horizontal CSS scroll-snap strip with a position readout.
 *
 * Each default-slot child is one snap point. The readout is `1–2 of 6`
 * (en dash) from what is visible. IntersectionObserver runs on the client
 * only; SSR prints the first-page estimate (`1 of N` / `1–2 of N`) without
 * touching `window` (narduk-libs#529).
 *
 * Usage:
 *   <AppSnapStrip :items-per-view="2">
 *     <figure v-for="picture in pictures" :key="picture.id">…</figure>
 *   </AppSnapStrip>
 */
import {
  Comment,
  Fragment,
  Text,
  computed,
  nextTick,
  onMounted,
  onUnmounted,
  ref,
  useSlots,
  watch,
} from 'vue'

import { formatSnapStripReadout, initialSnapStripRange } from '../../utils/snapStripReadout'

import type { VNode } from 'vue'

const props = withDefaults(
  defineProps<{
    /** Accessible name for the strip region. */
    label?: string
    /**
     * How many children fit in the viewport. Defaults to 2, the phone
     * reading from the BuoyCams handoff.
     */
    itemsPerView?: number
  }>(),
  {
    label: 'Gallery',
    itemsPerView: 2,
  },
)

const slots = useSlots()
const scrollerRef = ref<HTMLElement | null>(null)
const firstVisible = ref(1)
const lastVisible = ref(1)

function flattenSlotNodes(nodes: VNode[] | undefined): VNode[] {
  const result: VNode[] = []
  for (const node of nodes ?? []) {
    if (node.type === Comment) continue
    if (node.type === Text && String(node.children ?? '').trim() === '') continue
    if (node.type === Fragment && Array.isArray(node.children)) {
      result.push(...flattenSlotNodes(node.children as VNode[]))
      continue
    }
    result.push(node)
  }
  return result
}

const itemCount = computed(() => flattenSlotNodes(slots.default?.()).length)

const readout = computed(() =>
  formatSnapStripReadout(firstVisible.value, lastVisible.value, itemCount.value),
)

const canPrev = computed(() => itemCount.value > 0 && firstVisible.value > 1)
const canNext = computed(() => itemCount.value > 0 && lastVisible.value < itemCount.value)

function applyInitialRange() {
  const range = initialSnapStripRange(itemCount.value, props.itemsPerView)
  firstVisible.value = range.first
  lastVisible.value = range.last
}

applyInitialRange()

watch([itemCount, () => props.itemsPerView], () => {
  applyInitialRange()
  void nextTick(() => bindObserver())
})

let observer: IntersectionObserver | null = null
const visibleChildren = new Set<Element>()

function publishVisibleRange() {
  const root = scrollerRef.value
  if (!root) return
  const indexes: number[] = []
  for (const [index, child] of [...root.children].entries()) {
    if (visibleChildren.has(child)) indexes.push(index)
  }
  if (indexes.length === 0) return
  firstVisible.value = Math.min(...indexes) + 1
  lastVisible.value = Math.max(...indexes) + 1
}

function bindObserver() {
  observer?.disconnect()
  observer = null
  visibleChildren.clear()

  const root = scrollerRef.value
  if (!root || typeof IntersectionObserver === 'undefined') return

  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) visibleChildren.add(entry.target)
        else visibleChildren.delete(entry.target)
      }
      publishVisibleRange()
    },
    { root, threshold: 0.5 },
  )

  for (const child of root.children) {
    observer.observe(child)
  }
}

function scrollByPage(direction: -1 | 1) {
  const root = scrollerRef.value
  if (!root) return
  root.scrollBy({ left: root.clientWidth * direction, behavior: 'auto' })
}

onMounted(() => {
  bindObserver()
})

onUnmounted(() => {
  observer?.disconnect()
  observer = null
})
</script>

<template>
  <div class="app-snap-strip flex flex-col gap-2" role="region" :aria-label="label">
    <div class="flex items-center justify-between gap-2">
      <p
        class="text-sm text-muted tabular-nums"
        aria-live="polite"
        data-testid="app-snap-strip-readout"
      >
        {{ readout }}
      </p>
      <div class="flex items-center gap-1">
        <UButton
          icon="i-lucide-chevron-left"
          color="neutral"
          variant="ghost"
          size="sm"
          :disabled="!canPrev"
          aria-label="Previous"
          data-testid="app-snap-strip-prev"
          @click="scrollByPage(-1)"
        />
        <UButton
          icon="i-lucide-chevron-right"
          color="neutral"
          variant="ghost"
          size="sm"
          :disabled="!canNext"
          aria-label="Next"
          data-testid="app-snap-strip-next"
          @click="scrollByPage(1)"
        />
      </div>
    </div>
    <div
      ref="scrollerRef"
      class="app-snap-strip__scroller flex flex-nowrap overflow-x-auto snap-x snap-mandatory [scrollbar-width:thin] [&>*]:shrink-0 [&>*]:grow-0 [&>*]:snap-start [&>*]:basis-[calc(100%/var(--app-snap-strip-items-per-view,2))]"
      :style="{ '--app-snap-strip-items-per-view': String(itemsPerView) }"
      data-testid="app-snap-strip-scroller"
    >
      <slot />
    </div>
  </div>
</template>
