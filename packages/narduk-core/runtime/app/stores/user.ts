import { defineStore } from 'pinia'

/**
 * Base User Store
 *
 * SSR-safe user profile state for all template consumers.
 * Integrates with the existing nuxt-auth-utils session.
 *
 * ## Downstream customisation
 *
 * Downstream apps should:
 * 1. The auth layer ships `/api/auth/me` which returns `{ user }`.
 *    Override or extend that route for your own profile shape.
 * 2. Shadow this store at `app/stores/user.ts` with a typed version that
 *    re-uses `useHydrationGuard`, `createLoadingStates`, etc.:
 *
 * ```ts
 * // app/stores/user.ts
 * import { defineStore } from 'pinia'
 * import type { MyProfile } from '~/types/profile'
 *
 * export const useUserStore = defineStore('user', () => {
 *   const profile = ref<MyProfile | null>(null)
 *   const isLoading = ref(false)
 *   let fetchPromise: Promise<MyProfile | null> | null = null
 *
 *   // ... app-specific implementation
 * })
 * ```
 *
 * ## Usage in pages
 *
 * ```ts
 * // In a page or layout:
 * const userStore = useUserStore()
 * const { data } = await useAsyncData('user-profile', () => userStore.fetchProfile())
 * ```
 *
 * ## SSR data flow
 *
 * Calling `fetchProfile()` inside `useAsyncData` or `callOnce` during SSR
 * populates Pinia state on the server. Nuxt serialises that state into the
 * HTML payload and Pinia rehydrates it on the client — no second request
 * needed for the initial page load.
 */
export const useUserStore = defineStore('user', () => {
  // ─── State ────────────────────────────────────────────────────────────────

  /**
   * Typed as `Record<string, unknown>` so the base store is agnostic to the
   * downstream profile shape. Shadow this store with a typed version.
   */
  const profile = ref<Record<string, unknown> | null>(null)
  const isLoading = ref(false)

  // Singleton promise — prevents duplicate parallel fetches.
  // Not reactive: it's an implementation detail, not UI state.
  let fetchPromise: Promise<Record<string, unknown> | null> | null = null

  // ─── Actions ──────────────────────────────────────────────────────────────

  function setProfile(data: Record<string, unknown> | null) {
    profile.value = data
  }

  /**
   * Reset all store state.
   * Call on sign-out to avoid stale data leaking between sessions.
   */
  function clearStore() {
    profile.value = null
    isLoading.value = false
    fetchPromise = null
  }

  /**
   * Fetch the authenticated user's profile.
   *
   * Uses a singleton pattern: concurrent callers share the same in-flight
   * request. Subsequent calls return the cached value unless `force` is true.
   *
   * The auth layer's `/api/auth/me` endpoint returns `{ user }`.
   * Downstream apps can override or extend that route for their schema.
   *
   * @param force - Re-fetch even if profile is already loaded.
   */
  async function fetchProfile(force = false): Promise<Record<string, unknown> | null> {
    // Return cached value on subsequent calls (standard SWR behaviour).
    if (profile.value && !force) return profile.value

    // Return the existing promise if a fetch is already in progress.
    if (fetchPromise) return fetchPromise

    const appFetch = useAppFetch()
    isLoading.value = true

    fetchPromise = (async () => {
      try {
        const data = await appFetch<{ user: Record<string, unknown> | null }>('/api/auth/me')
        if (data.user) setProfile(data.user)
        return data.user ?? null
      } catch (error) {
        console.warn('[useUserStore] fetchProfile failed:', error)
        return null
      } finally {
        isLoading.value = false
        fetchPromise = null
      }
    })()

    return fetchPromise
  }

  // ─── Return ───────────────────────────────────────────────────────────────

  return {
    profile,
    isLoading,
    setProfile,
    clearStore,
    fetchProfile,
  }
})
