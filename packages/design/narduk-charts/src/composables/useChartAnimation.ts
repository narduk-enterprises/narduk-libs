import { onMounted, onUnmounted, ref, watch, type Ref } from 'vue'

export function useChartAnimation(
  container: Ref<HTMLElement | null>,
  enabled: Readonly<Ref<boolean>>,
  drawOnVisible: () => boolean,
) {
  // SSR and hydration share the same initial frame; animate=false renders the finished chart.
  const animated = ref(!enabled.value)
  let observer: IntersectionObserver | null = null
  let frame = 0

  function cleanup() {
    observer?.disconnect()
    observer = null
    if (frame) cancelAnimationFrame(frame)
    frame = 0
  }

  function reveal() {
    cleanup()
    frame = requestAnimationFrame(() => {
      frame = 0
      animated.value = true
    })
  }

  onMounted(() => {
    watch(
      [enabled, drawOnVisible],
      () => {
        cleanup()
        if (!enabled.value) {
          animated.value = true
          return
        }
        if (animated.value) return
        if (drawOnVisible() && typeof IntersectionObserver !== 'undefined' && container.value) {
          observer = new IntersectionObserver(entries => {
            if (entries.some(entry => entry.isIntersecting)) reveal()
          })
          observer.observe(container.value)
        } else {
          reveal()
        }
      },
      { immediate: true },
    )
  })

  onUnmounted(cleanup)
  return animated
}
