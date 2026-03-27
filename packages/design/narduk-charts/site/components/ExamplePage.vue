<script setup lang="ts">
import SiteHeader from './SiteHeader.vue'
import SiteFooter from './SiteFooter.vue'
import { RouterLink } from 'vue-router'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useChartFullscreen } from '@narduk-enterprises/narduk-charts'

const props = defineProps<{
  title: string
  kicker?: string
  /** Adds a full-screen control and passes sizing props to the default slot. */
  enableChartFullscreen?: boolean
}>()

const { targetRef, isFullscreen, toggle } = useChartFullscreen()

const viewportH = ref(typeof window !== 'undefined' ? window.innerHeight : 900)

function syncViewport() {
  if (typeof window === 'undefined') return
  viewportH.value = window.innerHeight
}

const fullscreenChartHeight = computed(() => {
  if (!props.enableChartFullscreen || !isFullscreen.value) return undefined
  return Math.max(380, viewportH.value - 170)
})

onMounted(() => {
  syncViewport()
  window.addEventListener('resize', syncViewport)
})

onUnmounted(() => {
  window.removeEventListener('resize', syncViewport)
})
</script>

<template>
  <div class="min-h-screen flex flex-col">
    <SiteHeader />
    <main
      id="main-content"
      class="flex-1"
      tabindex="-1"
    >
      <div class="ns-container py-10">
        <RouterLink
          to="/"
          class="mb-6 inline-block text-sm font-medium text-[var(--color-ns-accent)] no-underline hover:underline"
        >
          ← Back to home
        </RouterLink>
        <p
          v-if="kicker"
          class="mb-1 text-xs font-semibold uppercase tracking-wider text-[var(--color-ns-muted)]"
        >
          {{ kicker }}
        </p>
        <h1 class="mb-4 text-3xl font-bold tracking-tight text-[var(--color-ns-text)]">
          {{ title }}
        </h1>
        <div class="ns-prose mb-8">
          <slot name="intro" />
        </div>
        <div
          ref="targetRef"
          class="ns-card ns-chart-panel min-w-0"
        >
          <div
            v-if="enableChartFullscreen"
            class="mb-3 flex flex-wrap items-center justify-end gap-2"
          >
            <button
              type="button"
              class="ns-btn ns-btn--ghost !px-3 !py-1.5 text-xs"
              :aria-pressed="isFullscreen"
              :aria-label="isFullscreen ? 'Exit full screen chart' : 'View chart full screen'"
              @click="toggle"
            >
              {{ isFullscreen ? 'Exit full screen' : 'Full screen' }}
            </button>
          </div>
          <div class="min-h-0 min-w-0 flex-1">
            <slot
              :is-chart-fullscreen="isFullscreen"
              :toggle-chart-fullscreen="toggle"
              :fullscreen-chart-height="fullscreenChartHeight"
            />
          </div>
        </div>
      </div>
    </main>
    <SiteFooter />
  </div>
</template>
