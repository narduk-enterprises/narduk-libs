<script setup lang="ts">
/**
 * AppLightbox — Fullscreen image/video viewer with keyboard navigation.
 *
 * Supports single or multi-item galleries with prev/next navigation,
 * keyboard shortcuts (Escape, Arrow keys), and swipe gestures.
 *
 * Optional labelled thumbnail rails (0–2) sit under the picture. Rail 1
 * uses ArrowLeft/ArrowRight; rail 2 uses ArrowUp/ArrowDown. Selecting a
 * thumb updates the main picture and emits `{ railIndex, itemIndex }`.
 * Omit `rails` and existing keyboard / swipe behaviour is unchanged.
 *
 * The named `side` slot receives the current item and index and sits
 * beside the picture on wide screens, below it on narrow screens.
 *
 * Usage:
 *   <!-- Single image -->
 *   <AppLightbox v-model="showLightbox" :items="[{ src: '/photo.jpg', alt: 'A photo' }]" />
 *
 *   <!-- Gallery with navigation -->
 *   <AppLightbox v-model="showLightbox" :items="gallery" :start-index="clickedIndex" />
 *
 *   <!-- Rails + per-picture details -->
 *   <AppLightbox v-model="open" :items="pictures" :rails="rails">
 *     <template #side="{ item, index }">{{ item.caption }} ({{ index + 1 }})</template>
 *   </AppLightbox>
 */
import { computed, onMounted, onUnmounted, ref, toRef, watch } from 'vue'

import {
  type LightboxRailSelectPayload,
  nextRailItemIndex,
  railIndexForKey,
  railStepForKey,
  visibleLightboxRails,
} from '../../utils/lightboxRails'

export interface LightboxItem {
  /** Alt text for images. */
  alt?: string
  /** Optional caption shown below the media. */
  caption?: string
  /** Image or video URL. */
  src: string
  /** Whether this item is a video. */
  video?: boolean
}

export interface LightboxRailItem {
  /** Alt text for the thumbnail. */
  alt?: string
  /**
   * Index in `items` this thumbnail selects. Defaults to this thumbnail's
   * own index in the rail.
   */
  itemIndex?: number
  /** Thumbnail URL. */
  src: string
}

export interface LightboxRail {
  items: LightboxRailItem[]
  /** Accessible name for the rail (`aria-label`) and the visible heading. */
  label: string
}

export type { LightboxRailSelectPayload }

const props = withDefaults(
  defineProps<{
    /** Array of media items to display. */
    items: LightboxItem[]
    /** 0–2 labelled thumbnail rails under the picture. */
    rails?: LightboxRail[]
    /** Show item counter (e.g. "2 / 5"). */
    showCounter?: boolean
    /** Show prev/next navigation arrows. */
    showNavigation?: boolean
    /** Starting index when opened. */
    startIndex?: number
  }>(),
  {
    rails: undefined,
    startIndex: 0,
    showNavigation: true,
    showCounter: true,
  },
)

const emit = defineEmits<{
  select: [payload: LightboxRailSelectPayload]
}>()

const modelValue = defineModel<boolean>({ default: false })

defineOptions({ inheritAttrs: false })

const startIndex = toRef(props, 'startIndex')
const currentIndex = ref(0)
const railSelection = ref<number[]>([])

const currentItem = computed(() => props.items[currentIndex.value])

const canPrev = computed(() => currentIndex.value > 0)
const canNext = computed(() => currentIndex.value < props.items.length - 1)

const visibleRails = computed(() => visibleLightboxRails(props.rails))

function goNext() {
  if (canNext.value) currentIndex.value++
}

function goPrev() {
  if (canPrev.value) currentIndex.value--
}

function close() {
  modelValue.value = false
}

function isRailCurrent(railIndex: number, itemIndex: number): boolean {
  return (railSelection.value[railIndex] ?? 0) === itemIndex
}

function selectRailItem(railIndex: number, itemIndex: number) {
  const rail = visibleRails.value[railIndex]
  const thumb = rail?.items[itemIndex]
  if (!thumb) return

  railSelection.value = visibleRails.value.map((_, index) =>
    index === railIndex ? itemIndex : (railSelection.value[index] ?? 0),
  )

  const target = thumb.itemIndex ?? itemIndex
  if (target >= 0 && target < props.items.length) {
    currentIndex.value = target
  }

  emit('select', { railIndex, itemIndex })
}

function syncRailSelection() {
  railSelection.value = visibleRails.value.map((rail, railIndex) => {
    const matched = rail.items.findIndex(
      (thumb, thumbIndex) => (thumb.itemIndex ?? thumbIndex) === currentIndex.value,
    )
    if (matched >= 0) return matched
    const previous = railSelection.value[railIndex] ?? 0
    return previous < rail.items.length ? previous : 0
  })
}

function handleKeydown(e: KeyboardEvent) {
  if (!modelValue.value) return

  if (e.key === 'Escape') {
    close()
    return
  }

  const rails = visibleRails.value
  const railIndex = railIndexForKey(e.key, rails.length)
  if (railIndex !== null) {
    const rail = rails[railIndex]
    if (!rail) return
    const step = railStepForKey(e.key)
    const current = railSelection.value[railIndex] ?? 0
    const next = nextRailItemIndex(current, step, rail.items.length)
    if (next !== current) {
      e.preventDefault()
      selectRailItem(railIndex, next)
    }
    return
  }

  switch (e.key) {
    case 'ArrowLeft':
      goPrev()
      break
    case 'ArrowRight':
      goNext()
      break
  }
}

// Reset index when opened with a new startIndex
watch(
  startIndex,
  (val) => {
    currentIndex.value = val
    syncRailSelection()
  },
  { immediate: true },
)

watch(modelValue, (open) => {
  if (open) {
    currentIndex.value = startIndex.value
    syncRailSelection()
  }
})

watch(visibleRails, () => {
  syncRailSelection()
})

watch(currentIndex, () => {
  syncRailSelection()
})

onMounted(() => {
  window.addEventListener('keydown', handleKeydown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown)
})
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="opacity-0"
      leave-active-class="transition duration-150 ease-in"
      leave-to-class="opacity-0"
    >
      <div
        v-if="modelValue && currentItem"
        class="fixed inset-0 z-100 flex items-center justify-center bg-black/90"
        tabindex="-1"
        role="presentation"
        data-testid="app-lightbox"
        @click.self="close"
        @keydown.escape.stop="close"
      >
        <!-- Close button -->
        <UButton
          icon="i-lucide-x"
          color="neutral"
          variant="ghost"
          size="lg"
          class="absolute top-4 right-4 text-white/80 hover:text-white z-10"
          aria-label="Close lightbox"
          @click="close"
        />

        <!-- Counter -->
        <div
          v-if="showCounter && items.length > 1"
          class="absolute top-4 left-4 text-sm text-white/60 font-medium z-10"
        >
          {{ currentIndex + 1 }} / {{ items.length }}
        </div>

        <!-- Previous button -->
        <UButton
          v-if="showNavigation && items.length > 1 && canPrev"
          icon="i-lucide-chevron-left"
          color="neutral"
          variant="ghost"
          size="xl"
          class="absolute left-4 text-white/80 hover:text-white z-10"
          aria-label="Previous"
          @click.stop="goPrev"
        />

        <!-- Media + optional side details -->
        <div
          class="max-w-[90vw] max-h-[85vh] flex flex-col md:flex-row items-center md:items-start gap-4"
          data-testid="app-lightbox-stage"
        >
          <div class="max-w-full flex flex-col items-center min-w-0">
            <video
              v-if="currentItem.video"
              :src="currentItem.src"
              controls
              class="max-w-full max-h-[80vh] rounded-lg"
              data-testid="app-lightbox-video"
            >
              <track kind="captions" srclang="en" label="Captions" />
            </video>
            <img
              v-else
              :src="currentItem.src"
              :alt="currentItem.alt || ''"
              class="max-w-full max-h-[80vh] rounded-lg object-contain select-none"
              draggable="false"
              data-testid="app-lightbox-image"
            />
            <p v-if="currentItem.caption" class="mt-3 text-sm text-white/70 text-center max-w-lg">
              {{ currentItem.caption }}
            </p>

            <div
              v-if="visibleRails.length > 0"
              class="mt-4 w-full max-w-lg space-y-3"
              data-testid="app-lightbox-rails"
            >
              <div
                v-for="(rail, railIndex) in visibleRails"
                :key="railIndex"
                role="listbox"
                tabindex="0"
                :aria-label="rail.label"
                class="outline-none"
                :data-testid="`app-lightbox-rail-${railIndex}`"
              >
                <p class="mb-1.5 text-xs text-white/60">{{ rail.label }}</p>
                <div class="flex gap-2 overflow-x-auto">
                  <UButton
                    v-for="(thumb, itemIndex) in rail.items"
                    :key="itemIndex"
                    type="button"
                    color="neutral"
                    variant="ghost"
                    role="option"
                    :aria-selected="isRailCurrent(railIndex, itemIndex)"
                    :aria-current="isRailCurrent(railIndex, itemIndex) ? 'true' : undefined"
                    class="size-14 shrink-0 overflow-hidden rounded-md p-0 ring-2 ring-transparent"
                    :class="
                      isRailCurrent(railIndex, itemIndex)
                        ? 'ring-white'
                        : 'opacity-70 hover:opacity-100'
                    "
                    :data-testid="`app-lightbox-rail-${railIndex}-item-${itemIndex}`"
                    @click.stop="selectRailItem(railIndex, itemIndex)"
                  >
                    <img :src="thumb.src" :alt="thumb.alt || ''" class="size-full object-cover" />
                  </UButton>
                </div>
              </div>
            </div>
          </div>

          <aside
            v-if="$slots.side"
            class="w-full md:w-72 md:max-h-[80vh] md:overflow-y-auto text-white/80"
            data-testid="app-lightbox-side"
          >
            <slot name="side" :item="currentItem" :index="currentIndex" />
          </aside>
        </div>

        <!-- Next button -->
        <UButton
          v-if="showNavigation && items.length > 1 && canNext"
          icon="i-lucide-chevron-right"
          color="neutral"
          variant="ghost"
          size="xl"
          class="absolute right-4 text-white/80 hover:text-white z-10"
          aria-label="Next"
          @click.stop="goNext"
        />
      </div>
    </Transition>
  </Teleport>
</template>
