/**
 * A key/value cache on the Worker's Cache API (`caches.default`), shared by
 * every isolate in a Cloudflare data centre, for code that has no request event
 * to hand (a service module, a class-based cache). Extracted from stonx's
 * `server/utils/edge-cache.ts`.
 *
 * An isolate's memory is its own and a cold isolate starts empty; this tier
 * lets a new isolate reuse what its neighbours cached. It is per data centre,
 * not global, and a delete reaches only the data centre it runs in, so only
 * data that tolerates being served for its whole TTL may use it. A key that
 * carries a time bucket bounds that staleness to the bucket. On Node (dev,
 * tests) there is no `caches`, and every call is a no-op.
 *
 * Relation to `withWorkerCache` (server/utils/workerCache.ts): that helper
 * caches a handler's completed value, versioned, with stale-while-revalidate,
 * and needs the request event. This one is the bare get/put/delete underneath,
 * for callers without an event.
 *
 * Writes need not delay a response. `putInBackground` starts the put and:
 * - with an `event`, hands it to that request's `waitUntil` (`runInBackground`);
 * - without one, tracks it until a request ends: the `holdEdgeCacheWrites`
 *   Nitro plugin passes every write still pending to that request's
 *   `waitUntil` after its response is out, so the isolate is not stopped first.
 *   That request may be a different one from the request that started the
 *   write; the write still lands, which is all a cache fill needs.
 *
 * Import it explicitly from `@narduk-enterprises/narduk-core/server/edge-cache`.
 * It is not under `server/utils`, so it adds no auto-imported names.
 *
 * @example
 * ```ts
 * // server/utils/quotes-edge.ts
 * import { createEdgeCache } from '@narduk-enterprises/narduk-core/server/edge-cache'
 * export const quotesEdge = createEdgeCache({
 *   origin: () => useRuntimeConfig().public.siteUrl || 'https://example.com',
 *   path: '/__example-edge-cache/',
 * })
 *
 * // server/plugins/edge-cache-writes.ts
 * import { holdEdgeCacheWrites } from '@narduk-enterprises/narduk-core/server/edge-cache'
 * export default defineNitroPlugin(holdEdgeCacheWrites)
 * ```
 */

import { resolveWaitUntil, runInBackground } from './wait-until'

import type { H3Event } from 'h3'

interface EdgeCacheStore {
  delete(request: Request): Promise<boolean>
  match(request: Request): Promise<Response | undefined>
  put(request: Request, response: Response): Promise<void>
}

export interface EdgeEntry<T = unknown> {
  /** Epoch milliseconds. */
  expiresAt: number
  value: T
}

export interface EdgeCacheOptions {
  /**
   * The site's own origin, or a function returning it. The zone's cache keys
   * entries by URL, so the site URL keeps staging and production apart, and
   * the Worker answers every request on the zone, so nothing outside it reads
   * these entries.
   */
  origin: string | (() => string)
  /** The path every key sits under, such as `/__app-edge-cache/`. */
  path: string
}

function edgeStore(): EdgeCacheStore | null {
  return (globalThis as { caches?: { default?: EdgeCacheStore } }).caches?.default ?? null
}

/** True on a Worker, where the Cache API is present. */
export function hasEdgeCache(): boolean {
  return edgeStore() !== null
}

const inflight = new Set<Promise<void>>()

/** Resolves once every untracked background write started so far has settled; null when none. */
export function pendingEdgeCacheWrites(): Promise<void> | null {
  if (inflight.size === 0) return null
  const writes = [...inflight]
  return (async () => {
    await Promise.allSettled(writes)
  })()
}

interface NitroAppLike {
  hooks: {
    hook: (
      name: 'afterResponse',
      fn: (event: { waitUntil?: (promise: Promise<unknown>) => void }) => unknown,
    ) => unknown
  }
}

/**
 * Nitro plugin body: keep the Worker alive for the writes `putInBackground`
 * started without an event, after the response is out. h3 awaits
 * `afterResponse` before the Worker returns, so registering the writes with
 * `waitUntil` here never delays the response.
 */
export function holdEdgeCacheWrites(nitroApp: NitroAppLike): void {
  nitroApp.hooks.hook('afterResponse', (event) => {
    const writes = pendingEdgeCacheWrites()
    if (!writes) return
    if (event.waitUntil) event.waitUntil(writes)
    else return writes
  })
}

export function createEdgeCache(options: EdgeCacheOptions) {
  const segment = options.path.replaceAll(/^\/+|\/+$/g, '')
  if (!segment) {
    throw new TypeError(
      'createEdgeCache: options.path must name a path, such as /__app-edge-cache/',
    )
  }
  const path = `/${segment}/`

  function edgeRequest(key: string): Request {
    const origin = typeof options.origin === 'function' ? options.origin() : options.origin
    return new Request(`${origin.replace(/\/$/, '')}${path}${encodeURIComponent(key)}`)
  }

  /** The entry stored under `key`, or null when absent, expired or unreadable. */
  async function get<T>(key: string): Promise<EdgeEntry<T> | null> {
    const store = edgeStore()
    if (!store) return null
    try {
      const response = await store.match(edgeRequest(key))
      if (!response) return null
      const entry = (await response.json()) as EdgeEntry<T>
      return Date.now() < entry.expiresAt ? entry : null
    } catch {
      return null
    }
  }

  /** Store `value` under `key` for `ttlSeconds`. Failures are dropped: it is only a cache. */
  async function put(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    const store = edgeStore()
    const ttl = Math.ceil(ttlSeconds)
    if (!store || ttl <= 0) return
    const entry: EdgeEntry = { value, expiresAt: Date.now() + ttl * 1000 }
    try {
      await store.put(
        edgeRequest(key),
        new Response(JSON.stringify(entry), {
          headers: { 'content-type': 'application/json', 'cache-control': `max-age=${ttl}` },
        }),
      )
    } catch {
      // Not stored; the next miss recomputes.
    }
  }

  /**
   * Start `put` without making the caller wait. With `event`, the request's
   * `waitUntil` holds it; without, `holdEdgeCacheWrites` does.
   */
  function putInBackground(key: string, value: unknown, ttlSeconds: number, event?: H3Event) {
    if (!edgeStore()) return
    // An event with no `waitUntil` of its own (dev, a node preset) is tracked like no event.
    if (event && resolveWaitUntil(event)) {
      void runInBackground(event, put(key, value, ttlSeconds))
      return
    }
    const write: Promise<void> = put(key, value, ttlSeconds).finally(() => {
      inflight.delete(write)
    })
    inflight.add(write)
  }

  /** Remove `key` from this data centre's cache. */
  async function remove(key: string): Promise<void> {
    const store = edgeStore()
    if (!store) return
    await store.delete(edgeRequest(key)).catch(() => false)
  }

  return { get, put, putInBackground, delete: remove }
}

export type EdgeCache = ReturnType<typeof createEdgeCache>
