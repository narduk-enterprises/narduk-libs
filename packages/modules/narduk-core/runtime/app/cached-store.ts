// Explicit imports (not Nuxt auto-imports): packed package consumers compile this
// file outside the owning Nuxt source tree. The logic lives in `cached-store-core.ts`,
// which takes the Nuxt app as an argument so it runs under isolated Vitest.
import { useNuxtApp } from '#imports'

import { createDefineCachedStore } from './cached-store-core'

export { useResourceIdentityStore } from './cached-store-core'
export type {
  CachedStoreContext,
  CachedStoreState,
  DefineCachedStoreOptions,
} from './cached-store-core'
export type { PollOptions, ResourceCache, ResourceEntry, ResourceError } from './resource-cache'

/**
 * defineCachedStore — a Pinia setup store with a keyed resource cache.
 *
 * The cache's entries and errors are returned as store state, so @pinia/nuxt
 * serializes them into the SSR payload, and an entry the client hydrates counts
 * as fresh: a page that read a resource during SSR does not read it again on
 * hydration. Every component that asks for a key shares one entry and one
 * request; `poll` shares one timer per key and pauses it while the page is
 * hidden.
 *
 * Use it for data many components or pages read (a list the shell and a page
 * both show). For one page's own read, `defineServerResource` (useAsyncData) is
 * enough.
 *
 * Import it explicitly from `@narduk-enterprises/narduk-core/app/cached-store`.
 * It is not under `app/composables` or `app/utils`, so it adds no auto-imported
 * names to consuming apps.
 *
 * @example
 * ```ts
 * import { defineCachedStore } from '@narduk-enterprises/narduk-core/app/cached-store'
 *
 * export const useReleasesStore = defineCachedStore(
 *   'releases',
 *   ({ resources, poll }) => {
 *     const load = () => $fetch<Release[]>('/api/releases')
 *     return {
 *       releases: computed(() => resources.read<Release[]>('list') ?? []),
 *       pending: computed(() => resources.isPending('list')),
 *       error: computed(() => resources.error('list')),
 *       ensure: () => resources.ensure('list', load, { staleMs: 30_000 }),
 *       refresh: () => resources.refresh('list', load),
 *       poll: () => poll('list', load, { everyMs: 60_000 }),
 *       reset: () => resources.reset(),
 *     }
 *   },
 *   { actor: () => null },
 * )
 *
 * // A page: read during SSR, hydrate without a second read, poll while mounted.
 * const releases = useReleasesStore()
 * await useAsyncData('releases', () => releases.ensure())
 * releases.poll()
 * ```
 */
export const defineCachedStore = createDefineCachedStore(useNuxtApp)
