<script setup lang="ts">
/**
 * AppImage — Remote `<img>` with loading and failed states.
 *
 * Shows a skeleton while the picture is in flight. On error it shows a
 * hatched blank plus a reason (`failedText`, default "Image unavailable").
 * Setup never reads `window` (narduk-libs#529). The skeleton shimmer is
 * CSS-only and silent under `prefers-reduced-motion`.
 *
 * Usage:
 *   <AppImage src="/photo.jpg" alt="A photo" />
 *   <AppImage src="/cam.jpg" alt="Buoy cam" failed-text="Cam offline" />
 */
import { onMounted, ref, watch } from 'vue'

export type AppImageStatus = 'failed' | 'loaded' | 'loading'

const FAILED_HATCH =
  'repeating-linear-gradient(-45deg, var(--ui-color-neutral-200, #e5e5e5) 0 8px, var(--ui-color-neutral-300, #d4d4d4) 8px 16px)'

const props = withDefaults(
  defineProps<{
    alt: string
    decoding?: 'async' | 'auto' | 'sync'
    /** Copy shown on the hatched failed state. */
    failedText?: string
    height?: number | string
    loading?: 'eager' | 'lazy'
    src: string
    width?: number | string
  }>(),
  {
    failedText: 'Image unavailable',
    decoding: undefined,
    height: undefined,
    loading: undefined,
    width: undefined,
  },
)

const emit = defineEmits<{
  error: [event: Event]
  load: [event: Event]
}>()

defineOptions({ inheritAttrs: false })

const status = ref<AppImageStatus>('loading')
const imgRef = ref<HTMLImageElement | null>(null)

watch(
  () => props.src,
  () => {
    status.value = 'loading'
  },
)

function markLoaded(event: Event) {
  status.value = 'loaded'
  emit('load', event)
}

function markFailed(event: Event) {
  status.value = 'failed'
  emit('error', event)
}

function syncFromElement() {
  const image = imgRef.value
  if (!image?.complete) return
  if (image.naturalWidth > 0) {
    status.value = 'loaded'
    return
  }
  if (image.src) {
    status.value = 'failed'
  }
}

onMounted(() => {
  syncFromElement()
})
</script>

<template>
  <div class="relative overflow-hidden bg-muted/40" data-testid="app-image">
    <USkeleton
      v-if="status === 'loading'"
      class="app-image__skeleton absolute inset-0 size-full"
      data-testid="app-image-skeleton"
    />
    <img
      ref="imgRef"
      :src="src"
      :alt="alt"
      :width="width"
      :height="height"
      :loading="loading"
      :decoding="decoding"
      :class="status === 'loaded' ? 'relative size-full object-cover' : 'sr-only'"
      data-testid="app-image-img"
      @load="markLoaded"
      @error="markFailed"
    />
    <div
      v-if="status === 'failed'"
      class="app-image__failed flex size-full min-h-24 items-center justify-center px-3 py-4 text-center text-sm text-muted"
      role="img"
      :aria-label="failedText"
      :style="{ backgroundImage: FAILED_HATCH }"
      data-testid="app-image-failed"
    >
      {{ failedText }}
    </div>
  </div>
</template>

<style>
.app-image__skeleton {
  animation: app-image-shimmer 1.2s ease-in-out infinite;
}

@keyframes app-image-shimmer {
  0%,
  100% {
    opacity: 0.55;
  }
  50% {
    opacity: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .app-image__skeleton {
    animation: none;
  }
}

.app-image__failed {
  background-image: repeating-linear-gradient(
    -45deg,
    var(--ui-color-neutral-200, #e5e5e5) 0 8px,
    var(--ui-color-neutral-300, #d4d4d4) 8px 16px
  );
}
</style>
