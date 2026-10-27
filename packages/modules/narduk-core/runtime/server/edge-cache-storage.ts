/**
 * A Nitro storage driver on the Worker's Cache API, for Nitro's `cache` mount
 * (`cachedEventHandler`, `defineCachedFunction`): every isolate in a Cloudflare
 * data centre reads it, instead of each isolate's own memory, so a cold isolate
 * reuses what its neighbours cached. Extracted from stonx's
 * `deploy/cloudflare/edge-cache-storage.mjs`.
 *
 * - Entries live per data centre and expire by `max-age`; the Cache API cannot
 *   list or clear, so `getKeys` is empty and `clear` does nothing. Mount it only
 *   for routes that are never invalidated before their TTL.
 * - The isolate keeps its own copy (bounded, oldest out first), as Nitro's
 *   default memory storage did: on workers.dev the Cache API stores nothing, and
 *   a hit here skips the Cache API read.
 * - Nitro writes swr entries with no ttl and serves them stale while it
 *   revalidates; the driver keeps one more maxAge of staleness, bounded by the
 *   entry's `expires`.
 *
 * @example
 * ```ts
 * // nuxt.config.ts (Cloudflare build)
 * nitro: {
 *   storage: {
 *     cache: {
 *       driver: '@narduk-enterprises/narduk-core/server/edge-cache-storage',
 *       base: 'https://example.com',
 *       path: '/__example-nitro-cache/',
 *     },
 *   },
 * }
 * ```
 */

export interface EdgeCacheStorageOptions {
  /** The site's own origin; keeps staging and production entries apart. */
  base?: string
  /** Most entries the isolate copy keeps. Default 1000. */
  localMax?: number
  /** The path every key sits under. Default `/__nitro-edge-cache/`. */
  path?: string
}

interface EdgeCacheStore {
  delete(request: Request): Promise<boolean>
  match(request: Request): Promise<Response | undefined>
  put(request: Request, response: Response): Promise<void>
}

const DEFAULT_PATH = '/__nitro-edge-cache/'
const DEFAULT_LOCAL_MAX = 1000

export default function edgeCacheStorage(options: EdgeCacheStorageOptions = {}) {
  const base = String(options.base || 'https://localhost').replace(/\/$/, '')
  const path = `/${String(options.path ?? DEFAULT_PATH).replaceAll(/^\/+|\/+$/g, '')}/`
  const localMax = options.localMax ?? DEFAULT_LOCAL_MAX
  const store = () =>
    (globalThis as { caches?: { default?: EdgeCacheStore } }).caches?.default ?? null
  const request = (key: string) => new Request(`${base}${path}${encodeURIComponent(key)}`)
  const local = new Map<string, { until: number; value: string }>()

  const localGet = (key: string): string | null => {
    const hit = local.get(key)
    if (hit && Date.now() < hit.until) return hit.value
    local.delete(key)
    return null
  }
  const localSet = (key: string, value: string, ttlSeconds: number) => {
    local.delete(key)
    if (local.size >= localMax) {
      const oldest = local.keys().next()
      if (!oldest.done) local.delete(oldest.value)
    }
    local.set(key, { value, until: Date.now() + ttlSeconds * 1000 })
  }

  const ttlOf = (value: string, opts?: { ttl?: number }): number => {
    if (opts?.ttl) return Math.ceil(opts.ttl)
    try {
      const { expires, mtime } = JSON.parse(value) as { expires?: unknown; mtime?: unknown }
      if (typeof expires === 'number' && typeof mtime === 'number') {
        return Math.max(1, Math.ceil((2 * (expires - mtime)) / 1000))
      }
    } catch {
      // Not a Nitro cache entry.
    }
    return 60
  }

  const getItem = async (key: string): Promise<string | null> => {
    const own = localGet(key)
    if (own !== null) return own
    const response = await store()?.match(request(key))
    return response ? await response.text() : null
  }

  return {
    name: 'narduk-edge-cache',
    async hasItem(key: string) {
      return (await getItem(key)) !== null
    },
    getItem,
    async setItem(key: string, value: string, opts?: { ttl?: number }) {
      const ttl = ttlOf(value, opts)
      localSet(key, value, ttl)
      const cache = store()
      if (!cache) return
      await cache.put(
        request(key),
        new Response(value, { headers: { 'cache-control': `max-age=${ttl}` } }),
      )
    },
    async removeItem(key: string) {
      local.delete(key)
      await store()?.delete(request(key))
    },
    getKeys() {
      return [] as string[]
    },
    clear() {},
  }
}
