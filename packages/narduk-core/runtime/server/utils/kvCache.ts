/// <reference types="@cloudflare/workers-types" />
/**
 * Worker KV-backed JSON cache-aside helper.
 *
 * This is for Cloudflare Workers/Nitro data caches where a D1 cache hit would
 * still spend rows-read. It stores a small JSON envelope in KV and falls back
 * to the producer when KV is unavailable, stale, malformed, or bypassed.
 */

import { kvDelete, kvGet, kvSet } from './kv'

import type { H3Event } from 'h3'

interface KVCacheEnvelope<T> {
  cachedAt: number
  data: T
  expiresAt: number
}

export interface KVCacheMeta {
  bindingName: string
  cachedAt: string
  expiresAt: string
  hit: boolean
  key: string
}

export interface WithKVCacheOptions {
  /** KV namespace binding name from wrangler.json. Defaults to `KV`. */
  bindingName?: string
  /** If true, bypass the current cache entry and refresh it. */
  force?: boolean
  /** If true, return value is wrapped as { data: T, _meta: KVCacheMeta }. */
  returnMeta?: boolean
}

const MIN_KV_EXPIRATION_TTL_SECONDS = 60

function kvExpirationTtl(ttlSeconds: number): number | undefined {
  if (ttlSeconds <= 0) return undefined
  return Math.max(MIN_KV_EXPIRATION_TTL_SECONDS, ttlSeconds)
}

export async function withKVCache<T>(
  event: H3Event,
  cacheKey: string,
  ttlSeconds: number,
  producer: () => Promise<T>,
  options?: WithKVCacheOptions & { returnMeta?: false },
): Promise<T>
export async function withKVCache<T>(
  event: H3Event,
  cacheKey: string,
  ttlSeconds: number,
  producer: () => Promise<T>,
  options: WithKVCacheOptions & { returnMeta: true },
): Promise<{ _meta: KVCacheMeta; data: T }>
export async function withKVCache<T>(
  event: H3Event,
  cacheKey: string,
  ttlSeconds: number,
  producer: () => Promise<T>,
  options: WithKVCacheOptions = {},
): Promise<T | { _meta: KVCacheMeta; data: T }> {
  const bindingName = options.bindingName ?? 'KV'
  const nowSec = Math.floor(Date.now() / 1000)

  const wrap = (
    data: T,
    envelope: KVCacheEnvelope<T>,
    hit: boolean,
  ): T | { _meta: KVCacheMeta; data: T } => {
    if (!options.returnMeta) return data
    return {
      data,
      _meta: {
        bindingName,
        cachedAt: new Date(envelope.cachedAt * 1000).toISOString(),
        expiresAt: new Date(envelope.expiresAt * 1000).toISOString(),
        hit,
        key: cacheKey,
      },
    }
  }

  if (!options.force && ttlSeconds > 0) {
    try {
      const cached = await kvGet<KVCacheEnvelope<T>>(event, cacheKey, bindingName)
      if (
        cached &&
        typeof cached === 'object' &&
        !Array.isArray(cached) &&
        typeof cached.cachedAt === 'number' &&
        typeof cached.expiresAt === 'number' &&
        cached.expiresAt > nowSec &&
        'data' in cached
      ) {
        return wrap(cached.data, cached, true)
      }
    } catch (err) {
      console.warn(`[KVCache] GET error ${cacheKey}`, { bindingName, error: String(err) })
    }
  }

  const data = await producer()
  const envelope: KVCacheEnvelope<T> = {
    cachedAt: nowSec,
    data,
    expiresAt: ttlSeconds > 0 ? nowSec + ttlSeconds : nowSec,
  }

  const expirationTtl = kvExpirationTtl(ttlSeconds)
  if (expirationTtl) {
    try {
      await kvSet(event, cacheKey, envelope, expirationTtl, bindingName)
    } catch (err) {
      console.warn(`[KVCache] SET error ${cacheKey}`, { bindingName, error: String(err) })
    }
  }

  return wrap(data, envelope, false)
}

export async function deleteKVCache(
  event: H3Event,
  cacheKey: string,
  bindingName = 'KV',
): Promise<void> {
  await kvDelete(event, cacheKey, bindingName)
}

export async function deleteKVCacheKeys(
  event: H3Event,
  cacheKeys: string[],
  bindingName = 'KV',
): Promise<void> {
  await Promise.all(cacheKeys.map((cacheKey) => deleteKVCache(event, cacheKey, bindingName)))
}
