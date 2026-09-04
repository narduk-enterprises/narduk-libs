import { ref, computed, onMounted, onUnmounted, watch, nextTick, unref, type Ref, type MaybeRef } from 'vue'
import type { ChartPadding } from '../types'

export interface UseChartProps {
  width?: number
  height?: number
  dark?: boolean
  /**
   * When true (default), `prefers-reduced-motion: reduce` is treated as animation off
   * unless the chart passes `animate={false}` already or sets this to false.
   */
  respectReducedMotion?: boolean
}

export function useChart(
  containerRef: Ref<HTMLElement | null>,
  props: UseChartProps,
  paddingOverrides?: MaybeRef<Partial<ChartPadding>>,
) {
  const observedWidth = ref(0)

  const chartWidth = computed(() => props.width || observedWidth.value || 600)
  const chartHeight = computed(() => props.height || 400)

  const padding = computed<ChartPadding>(() => {
    const o = unref(paddingOverrides) ?? {}
    return {
      top: o.top ?? 24,
      right: o.right ?? 24,
      bottom: o.bottom ?? 48,
      left: o.left ?? 56,
    }
  })

  const plotWidth = computed(() =>
    Math.max(0, chartWidth.value - padding.value.left - padding.value.right))
  const plotHeight = computed(() =>
    Math.max(0, chartHeight.value - padding.value.top - padding.value.bottom))

  const systemPrefersDark = ref(false)
  const isDark = computed(() => props.dark ?? systemPrefersDark.value)

  const prefersReducedMotion = ref(false)

  let observer: ResizeObserver | null = null
  let resizeRaf = 0
  let mqlDark: MediaQueryList | null = null
  let mqlMotion: MediaQueryList | null = null

  const onDarkChange = (e: MediaQueryListEvent) => { systemPrefersDark.value = e.matches }
  const onMotionChange = (e: MediaQueryListEvent) => { prefersReducedMotion.value = e.matches }

  function cancelResizeRaf() {
    if (resizeRaf) {
      cancelAnimationFrame(resizeRaf)
      resizeRaf = 0
    }
  }

  onMounted(() => {
    void nextTick(() => {
      const el = containerRef.value
      if (!el || props.width !== undefined) return
      const syncFromDom = () => {
        const node = containerRef.value
        if (!node) return
        const w = node.clientWidth
        if (w < 1) return
        if (observedWidth.value !== w) observedWidth.value = w
      }
      syncFromDom()

      if (typeof ResizeObserver === 'undefined') return

      observer = new ResizeObserver(() => {
        cancelResizeRaf()
        resizeRaf = requestAnimationFrame(() => {
          resizeRaf = 0
          syncFromDom()
        })
      })
      observer.observe(el)
    })

    if (typeof window !== 'undefined') {
      mqlDark = window.matchMedia('(prefers-color-scheme: dark)')
      systemPrefersDark.value = mqlDark.matches
      mqlDark.addEventListener('change', onDarkChange)

      mqlMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
      prefersReducedMotion.value = mqlMotion.matches
      mqlMotion.addEventListener('change', onMotionChange)
    }
  })

  watch(() => props.width, (w) => {
    if (w !== undefined && observer) {
      cancelResizeRaf()
      observer.disconnect()
      observer = null
    }
  })

  onUnmounted(() => {
    cancelResizeRaf()
    observer?.disconnect()
    mqlDark?.removeEventListener('change', onDarkChange)
    mqlMotion?.removeEventListener('change', onMotionChange)
  })

  /** Combine user `animate` with reduced-motion preference. */
  function effectiveAnimate(animateProp: boolean): boolean {
    if (!animateProp) return false
    if (props.respectReducedMotion === false) return true
    return !prefersReducedMotion.value
  }

  return {
    chartWidth,
    chartHeight,
    padding,
    plotWidth,
    plotHeight,
    isDark,
    prefersReducedMotion,
    effectiveAnimate,
  }
}
