/**
 * defineAppStore — opinionated Pinia store helpers.
 *
 * Provides SSR-safe building blocks for all template consumers:
 * - `createLoadingStates` — reactive loading map with computed getters
 * - `useHydrationGuard`   — isHydrated ref + markHydrated action
 *
 * This module exports only these helper utilities. Pinia helpers such as
 * `defineStore` and `skipHydrate` should be imported from `pinia`.
 *
 * Usage:
 *   import { defineStore } from 'pinia'
 *   import { createLoadingStates, useHydrationGuard } from '#imports'
 *
 * The helpers in this file are auto-imported by Nuxt — no explicit import
 * needed in stores for `createLoadingStates` or `useHydrationGuard`.
 */

/**
 * Create a reactive loading state map with typed computed getters.
 *
 * @example
 * const { states, isLoading } = createLoadingStates({
 *   list: false,
 *   detail: false,
 *   creating: false,
 * })
 * states.list = true           // set loading
 * isLoading('list').value      // true
 *
 * // In store return:
 * return {
 *   isLoadingList: isLoading('list'),
 *   isCreating: isLoading('creating'),
 * }
 */
export function createLoadingStates<K extends string>(initialKeys: Record<K, boolean>) {
  // Use Nuxt/Vue auto-imported reactive — in tests, stubs are provided via vi.stubGlobal.
  const states = reactive({ ...initialKeys }) as Record<K, boolean>

  function isLoading(key: K) {
    return computed(() => states[key])
  }

  function setLoading(key: K, value: boolean) {
    states[key] = value
  }

  return { states, isLoading, setLoading }
}

/**
 * Hydration guard for stores with client-only computed properties.
 *
 * SSR can populate the Pinia store, but some derived calculations
 * (e.g. live price enrichment, browser API access) must only run
 * after the client has received and applied the SSR state.
 *
 * Call `markHydrated()` in the page's `onMounted` hook after confirming
 * the store data looks correct, or in the plugin after Pinia rehydration.
 *
 * @example
 * // In store setup:
 * const { isHydrated, markHydrated } = useHydrationGuard()
 *
 * const liveValues = computed(() => {
 *   if (!isHydrated.value) return staticValues.value  // SSR-safe fallback
 *   return enrichWithClientData(staticValues.value)
 * })
 *
 * return { isHydrated, markHydrated, liveValues }
 *
 * // In page:
 * const store = useMyStore()
 * onMounted(() => store.markHydrated())
 */
export function useHydrationGuard() {
  // Use Nuxt/Vue auto-imported ref — in tests, stubs are provided via vi.stubGlobal.
  const isHydrated = ref(false)

  function markHydrated() {
    isHydrated.value = true
  }

  return { isHydrated, markHydrated }
}
