/// <reference types="@cloudflare/workers-types" />
/**
 * D1-backed KV-style cache with stale-while-revalidate support.
 *
 * Uses a `kv_cache` table in D1. Any app that needs to cache external API
 * responses (weather, analytics, search console) can use this instead of
 * building a custom caching layer.
 *
 * Requires the `kv_cache` table from the layer's Drizzle schema.
 *
 * @example
 * ```ts
 * const data = await withD1Cache(event, 'weather:austin', 300, async () => {
 *   return await $fetch('https://api.weather.gov/...')
 * })
 * ```
 */

import { useLogger } from './logger'
import { readWorkerRuntimeEnv } from './worker-env'

import type { H3Event } from 'h3'

export function getD1CacheDB(event: H3Event): D1Database | null {
  const rawEnv = readWorkerRuntimeEnv(event)
  const db = (rawEnv as { DB?: D1Database }).DB
  return db ?? null
}

export async function getCached(
  db: D1Database,
  key: string,
): Promise<{ expiresAt: number; value: string } | null> {
  const row = await db
    .prepare('SELECT value, expires_at FROM kv_cache WHERE key = ?')
    .bind(key)
    .first<{ expires_at: number; value: string }>()
  return row ? { value: row.value, expiresAt: row.expires_at } : null
}

async function setCache(
  db: D1Database,
  key: string,
  value: string,
  ttlSeconds: number,
): Promise<void> {
  const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds
  await db
    .prepare('INSERT OR REPLACE INTO kv_cache (key, value, expires_at) VALUES (?, ?, ?)')
    .bind(key, value, expiresAt)
    .run()
}

export interface D1CacheMeta {
  cachedAt: string
  stale: boolean
}

export interface WithD1CacheOptions {
  /** If true, return value is wrapped as { data: T, _meta: D1CacheMeta } */
  returnMeta?: boolean
  /** If set, return cached data when expired but within this many seconds of expiry, and refresh in background */
  staleWindowSeconds?: number
}

/**
 * Wraps an async fetcher with D1 KV caching.
 *
 * - Cache hit → returns cached data immediately
 * - Cache miss → calls fetcher, stores result, returns fresh data
 * - Stale-while-revalidate → returns stale data immediately, refreshes in background
 * - Falls back to executing the fetcher if D1 is unavailable
 */
export async function withD1Cache<T>(
  event: H3Event,
  cacheKey: string,
  ttlSeconds: number,
  fetcher: () => Promise<T>,
  isForce?: boolean,
  options?: WithD1CacheOptions & { returnMeta?: false },
): Promise<T>
export async function withD1Cache<T>(
  event: H3Event,
  cacheKey: string,
  ttlSeconds: number,
  fetcher: () => Promise<T>,
  isForce: boolean,
  options: WithD1CacheOptions & { returnMeta: true },
): Promise<{ _meta: D1CacheMeta; data: T }>
export async function withD1Cache<T>(
  event: H3Event,
  cacheKey: string,
  ttlSeconds: number,
  fetcher: () => Promise<T>,
  isForce = false,
  options: WithD1CacheOptions = {},
): Promise<T | { _meta: D1CacheMeta; data: T }> {
  const { staleWindowSeconds = 0, returnMeta = false } = options
  const d1 = getD1CacheDB(event)
  const nowSec = Math.floor(Date.now() / 1000)

  const wrap = (data: T, stale: boolean): T | { _meta: D1CacheMeta; data: T } => {
    if (!returnMeta) return data
    return {
      data,
      _meta: { cachedAt: new Date().toISOString(), stale },
    }
  }

  const log = useLogger(event).child('D1Cache')

  // Try D1 cache first
  if (d1 && !isForce) {
    try {
      const row = await getCached(d1, cacheKey)
      if (row) {
        const isExpired = row.expiresAt <= nowSec
        const withinStale = staleWindowSeconds > 0 && row.expiresAt + staleWindowSeconds > nowSec
        if (!isExpired) {
          log.debug(`Cache HIT ${cacheKey}`)
          return wrap(JSON.parse(row.value) as T, false)
        }
        if (withinStale) {
          log.debug(`Cache STALE ${cacheKey}`)
          const parsed = JSON.parse(row.value) as T
          // Background refresh (fire-and-forget)
          void Promise.resolve()
            .then(() => fetcher())
            .then((fresh) => setCache(d1, cacheKey, JSON.stringify(fresh), ttlSeconds))
            .catch((err) =>
              log.error(`Background refresh failed ${cacheKey}`, { error: String(err) }),
            )
          return wrap(parsed, true)
        }
      }
      log.debug(`Cache MISS ${cacheKey}`)
    } catch (err) {
      log.error(`GET error ${cacheKey}`, { error: String(err) })
    }
  } else if (!d1) {
    log.warn(`DB binding not found for ${cacheKey}`)
  }

  // Execute the actual logic
  const result = await fetcher()

  // Persist to D1 cache
  if (d1) {
    try {
      await setCache(d1, cacheKey, JSON.stringify(result), ttlSeconds)
      log.debug(`Cache SET ${cacheKey}`)
    } catch (err) {
      log.error(`SET error ${cacheKey}`, { error: String(err) })
    }
  }

  return wrap(result as T, false)
}

/**
 * Clean up expired cache entries. Call from a cron or periodic route.
 */
export async function cleanExpiredCache(event: H3Event): Promise<number> {
  const d1 = getD1CacheDB(event)
  if (!d1) return 0
  const nowSec = Math.floor(Date.now() / 1000)
  const result = await d1.prepare('DELETE FROM kv_cache WHERE expires_at < ?').bind(nowSec).run()
  return result.meta.changes
}
