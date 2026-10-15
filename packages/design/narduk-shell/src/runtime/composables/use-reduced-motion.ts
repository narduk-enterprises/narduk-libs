/**
 * useReducedMotion() — `true` while the visitor asks for reduced motion
 * (`prefers-reduced-motion: reduce`), reactive to the setting changing.
 *
 * The CSS feel utilities in `theme.css` already collapse themselves under that
 * query. This is for motion a stylesheet cannot reach: a JS-driven animation, a
 * chart that tweens, an autoplaying carousel, a scroll-into-view that should
 * jump rather than glide.
 *
 * ```ts
 * const reduced = useReducedMotion()
 * el.scrollIntoView({ behavior: reduced.value ? 'auto' : 'smooth' })
 * ```
 *
 * ## SSR
 *
 * `false` on the server, and `false` through the first client render, so the
 * server markup and the hydrating markup agree. The real value is read in
 * `onMounted`, which is the first moment it can differ. Called outside a
 * component (a plugin, a module-level helper) it reads the query once and does
 * not subscribe, as there is no unmount to unsubscribe at.
 */
import { getCurrentInstance, onBeforeUnmount, onMounted, readonly, ref } from 'vue'

import type { Ref } from 'vue'

export const NE_REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

export function useReducedMotion(): Readonly<Ref<boolean>> {
  const reduced = ref(false)
  const exposed = readonly(reduced)
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return exposed

  const query = window.matchMedia(NE_REDUCED_MOTION_QUERY)
  const sync = () => {
    reduced.value = query.matches
  }

  if (!getCurrentInstance()) {
    sync()
    return exposed
  }

  onMounted(() => {
    sync()
    query.addEventListener('change', sync)
  })
  onBeforeUnmount(() => {
    query.removeEventListener('change', sync)
  })
  return exposed
}
