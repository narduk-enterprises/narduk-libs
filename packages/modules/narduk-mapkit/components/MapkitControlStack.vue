<script setup lang="ts">
import { useTemplateRef } from 'vue'

withDefaults(
  defineProps<{
    exitFullscreenLabel?: string
    fullscreen: boolean
    fullscreenLabel?: string
    locateLabel?: string
    locating?: boolean
    showFullscreen?: boolean
    showZoom?: boolean
    styleLabel?: string
    styleOpen: boolean
    zoomInLabel?: string
    zoomOutLabel?: string
  }>(),
  {
    exitFullscreenLabel: 'Exit full screen',
    fullscreenLabel: 'Full screen',
    locateLabel: 'Show my location',
    locating: false,
    showFullscreen: true,
    showZoom: true,
    styleLabel: 'Map style',
    zoomInLabel: 'Zoom in',
    zoomOutLabel: 'Zoom out',
  },
)

const emit = defineEmits<{
  locate: []
  'toggle-fullscreen': []
  'toggle-style': []
  'zoom-in': []
  'zoom-out': []
}>()

const styleButton = useTemplateRef<HTMLButtonElement>('styleButton')

defineExpose({ styleButton })
</script>

<template>
  <div class="control-stack">
    <button
      v-if="showZoom"
      type="button"
      class="icon-button mk-ctl"
      :aria-label="zoomInLabel"
      @click="emit('zoom-in')"
    >
      <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M12 5v14M5 12h14"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
        />
      </svg>
      <span aria-hidden="true" class="mk-tip">{{ zoomInLabel }}</span>
    </button>
    <button
      v-if="showZoom"
      type="button"
      class="icon-button mk-ctl"
      :aria-label="zoomOutLabel"
      @click="emit('zoom-out')"
    >
      <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M5 12h14"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
        />
      </svg>
      <span aria-hidden="true" class="mk-tip">{{ zoomOutLabel }}</span>
    </button>
    <span v-if="showZoom" aria-hidden="true" class="stack-divider" />
    <button
      type="button"
      class="icon-button mk-ctl"
      :class="{ 'is-busy': locating }"
      :aria-label="locateLabel"
      :aria-busy="locating"
      @click="emit('locate')"
    >
      <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M12 3v3M12 18v3M3 12h3M18 12h3M12 7a5 5 0 1 0 0 10a5 5 0 1 0 0-10z"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
        />
      </svg>
      <span aria-hidden="true" class="mk-tip">{{ locateLabel }}</span>
    </button>
    <button
      ref="styleButton"
      type="button"
      class="icon-button mk-ctl"
      :class="{ 'is-on': styleOpen }"
      :aria-label="styleLabel"
      aria-haspopup="dialog"
      :aria-expanded="styleOpen"
      @click="emit('toggle-style')"
    >
      <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M12 3 3 7.5l9 4.5 9-4.5L12 3zM3 12l9 4.5 9-4.5M3 16.5 12 21l9-4.5"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
      <span aria-hidden="true" class="mk-tip">{{ styleLabel }}</span>
    </button>
    <button
      v-if="showFullscreen"
      type="button"
      class="icon-button mk-ctl"
      :class="{ 'is-on': fullscreen }"
      :aria-label="fullscreen ? exitFullscreenLabel : fullscreenLabel"
      :aria-pressed="fullscreen"
      @click="emit('toggle-fullscreen')"
    >
      <svg v-if="!fullscreen" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
      <svg v-else width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
      <span aria-hidden="true" class="mk-tip">{{
        fullscreen ? exitFullscreenLabel : fullscreenLabel
      }}</span>
    </button>
  </div>
</template>

<style scoped>
/*
 * One rail: zoom in/out, locate, style, fullscreen -- stacked directly
 * under the lens rail (board `Main.dc.html`). Sized to match LensRail's
 * rail exactly so the two stacked controls read as one system.
 */
.control-stack {
  width: 44px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 4px;
  border-radius: var(--mk-radius-panel);
  background: var(--mk-surface);
  box-shadow: var(--mk-elev-2);
}

.icon-button {
  position: relative;
  width: 36px;
  height: 36px;
  flex: none;
  display: grid;
  place-items: center;
  border-radius: 8px;
}

/* Zoom is a pair; a hairline sets it apart from the tools below. */
.stack-divider {
  width: 24px;
  height: 1px;
  flex: none;
  margin: 1px auto;
  background: var(--mk-line-faint);
}

/* Rest, hover, pressed, focus and selected states -- full screen included,
   which takes the selected fill while it is on -- come from `.mk-ctl`
   (assets/css/map-controls.css), shared with the lens rail and phone dock. */

.icon-button.is-busy svg {
  opacity: 0.35;
}

.icon-button.is-busy::after {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  width: 16px;
  height: 16px;
  margin: -8px 0 0 -8px;
  border-radius: 50%;
  border: 2px solid var(--mk-line);
  border-top-color: var(--mk-ink-2);
  animation: mapkit-control-spin 0.7s linear infinite;
}

@keyframes mapkit-control-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .icon-button.is-busy::after {
    animation: none;
  }
}
</style>
