<script setup lang="ts">
/**
 * AppLightbox — Fullscreen image/video viewer with keyboard navigation.
 *
 * Supports single or multi-item galleries with prev/next navigation,
 * keyboard shortcuts (Escape, Arrow keys), and swipe gestures.
 *
 * Usage:
 *   <!-- Single image -->
 *   <AppLightbox v-model="showLightbox" :items="[{ src: '/photo.jpg', alt: 'A photo' }]" />
 *
 *   <!-- Gallery with navigation -->
 *   <AppLightbox v-model="showLightbox" :items="gallery" :start-index="clickedIndex" />
 */

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

const props = withDefaults(
  defineProps<{
    /** Array of media items to display. */
    items: LightboxItem[]
    /** Show item counter (e.g. "2 / 5"). */
    showCounter?: boolean
    /** Show prev/next navigation arrows. */
    showNavigation?: boolean
    /** Starting index when opened. */
    startIndex?: number
  }>(),
  {
    startIndex: 0,
    showNavigation: true,
    showCounter: true,
  },
)

const modelValue = defineModel<boolean>({ default: false })

defineOptions({ inheritAttrs: false })

const startIndex = toRef(props, 'startIndex')
const currentIndex = ref(0)

const currentItem = computed(() => props.items[currentIndex.value])

const canPrev = computed(() => currentIndex.value > 0)
const canNext = computed(() => currentIndex.value < props.items.length - 1)

function goNext() {
  if (canNext.value) currentIndex.value++
}

function goPrev() {
  if (canPrev.value) currentIndex.value--
}

function close() {
  modelValue.value = false
}

// Reset index when opened with a new startIndex
watch(
  startIndex,
  (val) => {
    currentIndex.value = val
  },
  { immediate: true },
)

watch(modelValue, (open) => {
  if (open) {
    currentIndex.value = startIndex.value
  }
})

// Keyboard navigation
function handleKeydown(e: KeyboardEvent) {
  if (!modelValue.value) return

  switch (e.key) {
    case 'Escape':
      close()
      break
    case 'ArrowLeft':
      goPrev()
      break
    case 'ArrowRight':
      goNext()
      break
  }
}

onMounted(() => {
  if (import.meta.client) {
    window.addEventListener('keydown', handleKeydown)
  }
})

onUnmounted(() => {
  if (import.meta.client) {
    window.removeEventListener('keydown', handleKeydown)
  }
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

        <!-- Media content -->
        <div class="max-w-[90vw] max-h-[85vh] flex flex-col items-center">
          <video
            v-if="currentItem.video"
            :src="currentItem.src"
            controls
            class="max-w-full max-h-[80vh] rounded-lg"
          >
            <track kind="captions" srclang="en" label="Captions" />
          </video>
          <img
            v-else
            :src="currentItem.src"
            :alt="currentItem.alt || ''"
            class="max-w-full max-h-[80vh] rounded-lg object-contain select-none"
            draggable="false"
          />
          <p v-if="currentItem.caption" class="mt-3 text-sm text-white/70 text-center max-w-lg">
            {{ currentItem.caption }}
          </p>
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
