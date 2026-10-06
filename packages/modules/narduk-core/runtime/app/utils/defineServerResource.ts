// Explicit imports (not Nuxt auto-imports): packed package consumers compile this
// file outside the owning Nuxt source tree. The logic lives in `serverResource.ts`,
// which takes the Nuxt data API as an argument so it runs under isolated Vitest.
import { refreshNuxtData, useAsyncData, useNuxtApp, useRequestFetch, useState } from '#imports'

import { createServerResource, invalidateServerResourcesWith } from './serverResource'

import type {
  ServerResource,
  ServerResourceCallOptions,
  ServerResourceNuxt,
  ServerResourceOptions,
  ServerResourceWriteArgs,
} from './serverResource'

const nuxt = {
  refreshNuxtData,
  useAsyncData,
  useNuxtApp,
  useRequestFetch,
  useState,
} as unknown as ServerResourceNuxt

/**
 * defineServerResource — one server read, shared by every screen that shows it.
 *
 * Returns a composable. Every call shares one `useAsyncData` key, so the SSR
 * payload hydrates without a second read, a write's refresh reaches every
 * view, and concurrent callers share one request (`dedupe: 'defer'`). Reads go
 * through `useRequestFetch()`, so SSR forwards the session cookie.
 *
 * - **Freshness:** `readAt` hydrates with the page; `load()` reads only when
 *   the answer is missing or older than `ttlMs`.
 * - **Polling:** optional, one timer per key (not per consumer), paused while
 *   the page is hidden, caught up on return.
 * - **keepAlive:** the answer outlives its last consumer.
 * - **Writes:** declared on the resource; each runs with the app fetch (CSRF
 *   header on mutations) and refreshes this key plus the keys it `invalidates`.
 * - **State:** `loading | ready | absent | error`; an error keeps the last
 *   good value beside it.
 *
 * The returned composable is awaitable: `const { data } = await useCatalog()`.
 *
 * @example
 * ```ts
 * export const useCatalog = defineServerResource({
 *   key: 'catalog',
 *   fetch: ({ fetch }) => fetch<Catalog>('/api/catalog'),
 *   ttlMs: 60_000,
 *   keepAlive: true,
 *   absent: (catalog) => !catalog.available,
 *   writes: {
 *     rename: {
 *       invalidates: ['catalog-summary'],
 *       run: ({ fetch }, id: string, name: string) =>
 *         fetch(`/api/catalog/${id}`, { method: 'POST', body: { name } }),
 *     },
 *   },
 * })
 * ```
 */
export function defineServerResource<T, W extends ServerResourceWriteArgs = Record<never, never>>(
  options: ServerResourceOptions<T, W>,
): (call?: ServerResourceCallOptions) => ServerResource<T, W> & PromiseLike<ServerResource<T, W>> {
  return createServerResource(options, nuxt)
}

/**
 * Mark resources stale and refresh the mounted ones; one not mounted reads
 * again on its next `load()`. For a write that lives outside a resource's own
 * `writes` but changes what the resource reads.
 */
export function invalidateServerResources(keys: readonly string[]): Promise<void> {
  return invalidateServerResourcesWith(nuxt, keys)
}
