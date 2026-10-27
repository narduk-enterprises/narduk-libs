// Explicit imports (not Nuxt auto-imports): packed package consumers compile this
// file outside the owning Nuxt source tree, and isolated Vitest has no `#imports`.
// The Nuxt app is injected (`createDefineCachedStore`); `cached-store.ts` passes
// the real one. The cache itself is `resource-cache.ts`.
import { defineStore } from 'pinia'
import { ref } from 'vue'

import { createResourceCache, createResourcePoller } from './resource-cache'

import type { PollOptions, ResourceCache, ResourceEntry, ResourceError } from './resource-cache'
import type { Ref } from 'vue'

/**
 * Whose private data the cached stores hold. `epoch` changes on every identity
 * transition (sign-in, sign-out, session expiry, account switch); a read that
 * started under an older epoch is dropped instead of committed, and an entry
 * tagged with another epoch is not read.
 *
 * Call `retire()` synchronously at the transition, before anything the new
 * identity reads, then `reset()` each cached store (or reload the page).
 * Public data that is the same for every visitor does not need it.
 */
export const useResourceIdentityStore = defineStore('narduk-resource-identity', () => {
  const epoch = ref(0)
  /** Bump the epoch: every read out now can no longer commit. */
  function retire() {
    epoch.value++
  }
  return { epoch, retire }
})

export interface CachedStoreContext {
  /**
   * Keep `key` refreshed while the calling component is mounted: one timer per
   * key however many components poll it, paused while the page is hidden.
   */
  poll: <T>(key: string, load: () => Promise<T>, opts: PollOptions) => void
  /** The store's keyed cache: `ensure`, `refresh`, `invalidate`, `read`, ... */
  resources: ResourceCache
}

export interface DefineCachedStoreOptions {
  /**
   * The signed-in user's id, or null when signed out. Every entry is tagged
   * with it and is not read under another. Required, so each store states
   * whose data it holds: pass `() => null` for data every visitor shares.
   */
  actor: () => string | null
}

/** What every cached store returns beside its own members; the payload carries both refs. */
export interface CachedStoreState {
  resourceEntries: Ref<Record<string, ResourceEntry>>
  resourceErrors: Ref<Record<string, ResourceError>>
}

/** `defineCachedStore` with the Nuxt app injected; see `cached-store.ts`. */
export function createDefineCachedStore(useNuxtApp: () => { isHydrating?: boolean }) {
  return function defineCachedStore<Id extends string, R extends Record<string, unknown>>(
    id: Id,
    setup: (context: CachedStoreContext) => R,
    options: DefineCachedStoreOptions,
  ) {
    // eslint-disable-next-line narduk/pinia-require-defineStore-id -- the caller's own literal id, passed through
    return defineStore(id, (): R & CachedStoreState => {
      const identity = useResourceIdentityStore()
      const nuxtApp = useNuxtApp()
      const resourceEntries = ref<Record<string, ResourceEntry>>({})
      const resourceErrors = ref<Record<string, ResourceError>>({})
      const resources = createResourceCache({
        entries: resourceEntries,
        errors: resourceErrors,
        epoch: () => identity.epoch,
        actor: options.actor,
        hydrating: () => nuxtApp.isHydrating === true,
      })
      const { poll } = createResourcePoller(resources)
      return { ...setup({ resources, poll }), resourceEntries, resourceErrors }
    })
  }
}
