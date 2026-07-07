/// <reference types="@cloudflare/workers-types" />
import { createError } from 'h3'

import { useLogger } from './logger'
import { readWorkerRuntimeEnv } from './worker-env'

import type { H3Event } from 'h3'

/**
 * KV Namespace Utilities — Cloudflare Workers KV helpers.
 *
 * Requires a KV namespace binding in the app `wrangler.json`. For local
 * `nuxt dev` with `nitro-cloudflare-dev`, add a binding with `preview_id` so
 * Miniflare exposes `KV` (see template `apps/web/wrangler.json`). Replace
 * placeholder IDs with real namespace IDs before production deploy.
 * ```json
 * {
 *   "kv_namespaces": [
 *     {
 *       "binding": "KV",
 *       "id": "…",
 *       "preview_id": "…"
 *     }
 *   ]
 * }
 * ```
 *
 * @example
 * ```ts
 * export default defineEventHandler(async (event) => {
 *   const kv = useKV(event)
 *
 *   // Set with TTL (60 seconds)
 *   await kv.put('cache:user:123', JSON.stringify(user), { expirationTtl: 60 })
 *
 *   // Get (returns string | null)
 *   const cached = await kv.get('cache:user:123')
 *   const data = cached ? JSON.parse(cached) : null
 *
 *   // Delete
 *   await kv.delete('cache:user:123')
 *
 *   // List keys by prefix
 *   const keys = await kv.list({ prefix: 'cache:user:' })
 * })
 * ```
 */

/**
 * Get the KV namespace binding from the Cloudflare event context.
 * @param event - The H3 event
 * @param bindingName - KV binding name from wrangler.json (default: 'KV')
 */
export function useKV(event: H3Event, bindingName = 'KV'): KVNamespace {
  const env = readWorkerRuntimeEnv(event)
  if (!env[bindingName]) {
    throw createError({
      statusCode: 500,
      message: `KV binding "${bindingName}" not found. Add it to wrangler.json.`,
    })
  }
  return env[bindingName] as KVNamespace
}

/**
 * Get a JSON-parsed value from KV.
 */
export async function kvGet<T = unknown>(
  event: H3Event,
  key: string,
  bindingName = 'KV',
): Promise<T | null> {
  const kv = useKV(event, bindingName)
  const raw = await kv.get(key)
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch (err) {
    useLogger(event)
      .child('KV')
      .warn('Failed to parse JSON for key', { key, error: String(err) })
    return raw as unknown as T
  }
}

/**
 * Set a JSON value in KV with optional TTL.
 */
export async function kvSet(
  event: H3Event,
  key: string,
  value: unknown,
  ttl?: number,
  bindingName = 'KV',
): Promise<void> {
  const kv = useKV(event, bindingName)
  const serialized = typeof value === 'string' ? value : JSON.stringify(value)
  await kv.put(key, serialized, ttl ? { expirationTtl: ttl } : undefined)
}

/**
 * Delete a key from KV.
 */
export async function kvDelete(event: H3Event, key: string, bindingName = 'KV'): Promise<void> {
  const kv = useKV(event, bindingName)
  await kv.delete(key)
}
