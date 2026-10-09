/// <reference types="@cloudflare/workers-types" />
/**
 * Bounded, versioned, completed-value Worker data cache (narduk-libs#1716,
 * extending #1268).
 *
 * WHY THIS EXISTS
 * ---------------
 * A page Nuxt renders on the server calls the app's own API in-process
 * (`useFetch('/api/...')` during SSR). That call never leaves the Worker, so it
 * never meets Workers Cache or `CDN-Cache-Control`, and the HTML is
 * `private, no-store` under the nonce CSP. Every page view therefore re-ran the
 * handler's D1 reads even when the same route was edge-cached for outside
 * callers. `setCacheProfile` cannot help here, and `withKVCache` / `withD1Cache`
 * spend a KV read or a D1 row to learn whether the value is cached.
 *
 * `withWorkerCache` caches the completed value inside the handler instead:
 *
 *   isolate memory  ->  Workers Cache (`caches.default`, public scope only)  ->  build()
 *
 * and keys it by an app-supplied cheap `version`, so a write is visible on the
 * next request with no purge: bump the version in the same batch as the write
 * (`prepareCacheVersionBump`) and every cache tier misses.
 *
 * WHAT IT GUARANTEES
 * ------------------
 * - Completed serializable values only. The isolate keeps JSON text, so a
 *   request never receives an object another request can mutate. A value that
 *   does not round-trip through JSON (a function, a promise, a stream, a
 *   `Response`, a `Map`) is returned to the caller uncached and warned about.
 * - No promise, fetch, body stream or pending I/O is ever shared between
 *   requests. Concurrent misses each run their own `build()`; that is the price
 *   of not retaining a request-owned promise, which Workers can cancel or
 *   refuse to settle in another request's context.
 * - The isolate store is bounded by bytes and by entries (least recently used
 *   out first). A value too large for the byte budget is not kept in memory.
 * - A background refresh is handed to the triggering request's `waitUntil`.
 *   With no `waitUntil` (dev, tests) the refresh runs inline and the stale
 *   value covers a failure. A refresh that fails leaves the stale value in
 *   place (`_meta.stale`) and backs off before the next attempt.
 * - Within an isolate, a refresh that finishes after a later-started build cannot
 *   overwrite it (nor write its older value to Workers Cache). Across isolates
 *   there is no compare-and-set; see below.
 * - A Cache API error never makes a readable upstream unavailable: it is
 *   logged and the read falls through to `build()`.
 * - A `version` that cannot be read means the entry cannot be proven current,
 *   so `build()` runs uncached.
 *
 * WHAT IT DOES NOT GUARANTEE
 * --------------------------
 * Cross-isolate consistency is best effort. Workers Cache is per data centre,
 * eventually populated, and has no compare-and-set, so there is no distributed
 * lock and two isolates can both build. The version key is the consistency
 * anchor: a request that reads version N never serves a value stored under any
 * other version. Read the version BEFORE building (this helper does), so a
 * value stored under N was built from data at least as new as N.
 *
 * @example
 * ```ts
 * export default defineEventHandler(async (event) => {
 *   const db = getD1CacheDB(event)!
 *   return withWorkerCache(
 *     event,
 *     {
 *       key: 'stations:list',
 *       scope: 'public',
 *       freshSeconds: 300,
 *       maxStaleSeconds: 3600,
 *       version: () => readCacheVersion(db, 'stations'),
 *     },
 *     () => listStations(db),
 *   )
 * })
 * ```
 */

import { warnBestEffort } from '../../internal/best-effort-log'
import { getWorkerCacheStore, type WorkerCacheEntry } from '../../internal/worker-cache-store'
import { resolveWaitUntil, runInBackground } from '../wait-until'

import type { H3Event } from 'h3'

export type WorkerCacheScope = 'private' | 'public'
export type WorkerCacheVersion = number | string

export interface WorkerCacheOptions {
  /**
   * Name of a named Workers Cache to use for the public tier instead of
   * `caches.default`. Named caches are not available on every host, so the
   * default is the one every Worker has.
   */
  cacheName?: string
  /** Seconds a value is served as is. `0` or less turns caching off for this call. */
  freshSeconds: number
  /**
   * Cache key, chosen by the caller. It must carry everything the value
   * depends on that the version does not (a path parameter, a filter, a user
   * id for `private` scope).
   */
  key: string
  /**
   * Seconds after `freshSeconds` during which the value is still served while a
   * background refresh runs. Past it the value is expired and `build()` is
   * awaited. Default `0`: no stale serving.
   */
  maxStaleSeconds?: number
  /** Seconds a failed refresh waits before another request retries it. Default `15`. */
  retryBackoffSeconds?: number
  /** Return `{ data, _meta }` instead of the bare value. */
  returnMeta?: boolean
  /**
   * `public` values may be written to Workers Cache, which every visitor
   * shares. `private` values stay in this isolate's memory and are never
   * written to a shared tier; put the user id in `key` so isolate memory does
   * not mix users. There is no default: the caller states which one it means.
   */
  scope: WorkerCacheScope
  /**
   * Becomes part of the cache key. A value, or a function returning one (read
   * from D1 with `readCacheVersion`, say). Omit for a purely time-based cache.
   */
  version?: WorkerCacheVersion | (() => Promise<WorkerCacheVersion> | WorkerCacheVersion)
}

export interface WorkerCacheMeta {
  /** When the build that produced the value started. */
  cachedAt: string
  key: string
  /** Where this value came from. `bypass` means it was built and deliberately not cached. */
  source: 'build' | 'bypass' | 'edge' | 'memory'
  /** True when the value is past `freshSeconds` and served from the stale window. */
  stale: boolean
  version: string | null
}

const FORMAT = '1'
const EDGE_ORIGIN = 'https://worker-cache.invalid'
const HEADER_BUILT_AT = 'x-worker-cache-built-at'
const HEADER_FORMAT = 'x-worker-cache-format'
const HEADER_ID = 'x-worker-cache-id'
const DEFAULT_RETRY_BACKOFF_SECONDS = 15
/** How long one request's refresh claim holds off others if that request is cancelled. */
const REFRESH_LEASE_MS = 30_000

type Freshness = 'expired' | 'fresh' | 'stale'

interface Resolved {
  cacheName?: string
  fresh: number
  id: string
  key: string
  maxStale: number
  retryBackoffMs: number
  scope: WorkerCacheScope
  version: string | null
}

interface Candidate {
  builtAt: number
  json: string
}

function classify(builtAt: number, now: number, r: Resolved): Freshness {
  const ageMs = now - builtAt
  if (ageMs < r.fresh * 1000) return 'fresh'
  if (ageMs < (r.fresh + r.maxStale) * 1000) return 'stale'
  return 'expired'
}

/** Serialize a completed value, or `null` when it is not a plain JSON value. */
function serializeWorkerCacheValue(value: unknown): string | null {
  try {
    const json = JSON.stringify(value, (_key, v: unknown) => {
      if (typeof v === 'function' || typeof v === 'symbol') throw new TypeError('not serializable')
      if (v !== null && typeof v === 'object') {
        if (typeof (v as { then?: unknown }).then === 'function') throw new TypeError('thenable')
        if (v instanceof Map || v instanceof Set) throw new TypeError('collection')
        if (typeof ReadableStream !== 'undefined' && v instanceof ReadableStream)
          throw new TypeError('stream')
        if (typeof Response !== 'undefined' && v instanceof Response)
          throw new TypeError('response')
        if (typeof Request !== 'undefined' && v instanceof Request) throw new TypeError('request')
      }
      return v
    })
    return typeof json === 'string' ? json : null
  } catch {
    return null
  }
}

function edgeRequest(r: Resolved): Request {
  const url = new URL(`${EDGE_ORIGIN}/v${FORMAT}/${r.scope}/${encodeURIComponent(r.key)}`)
  if (r.version !== null) url.searchParams.set('v', r.version)
  return new Request(url.toString())
}

/** Workers' `CacheStorage` adds `default`; the DOM lib the consumer typecheck uses does not. */
interface WorkersCacheStorage {
  default: Cache
  open: (cacheName: string) => Promise<Cache>
}

async function openEdgeCache(r: Resolved): Promise<Cache | null> {
  if (typeof caches === 'undefined') return null
  const storage = caches as unknown as WorkersCacheStorage
  return r.cacheName ? storage.open(r.cacheName) : storage.default
}

async function readEdge(event: H3Event, r: Resolved): Promise<Candidate | null> {
  if (r.scope !== 'public') return null
  try {
    const cache = await openEdgeCache(r)
    if (!cache) return null
    const response = await cache.match(edgeRequest(r))
    if (!response) return null
    const builtAt = Number(response.headers.get(HEADER_BUILT_AT))
    const text = await response.text()
    if (
      response.headers.get(HEADER_FORMAT) !== FORMAT ||
      response.headers.get(HEADER_ID) !== encodeURIComponent(r.id) ||
      !Number.isFinite(builtAt)
    ) {
      return null
    }
    return { builtAt, json: text }
  } catch (error) {
    warnBestEffort(event, 'WorkerCache', `Cache API read failed ${r.key}`, { error: String(error) })
    return null
  }
}

async function writeEdge(event: H3Event, r: Resolved, c: Candidate): Promise<void> {
  try {
    const cache = await openEdgeCache(r)
    if (!cache) return
    const remainingMs = (r.fresh + r.maxStale) * 1000 - (Date.now() - c.builtAt)
    const maxAge = Math.max(1, Math.ceil(remainingMs / 1000))
    await cache.put(
      edgeRequest(r),
      new Response(c.json, {
        headers: {
          'cache-control': `public, max-age=${maxAge}`,
          'content-type': 'application/json',
          [HEADER_BUILT_AT]: String(c.builtAt),
          [HEADER_FORMAT]: FORMAT,
          [HEADER_ID]: encodeURIComponent(r.id),
        },
      }),
    )
  } catch (error) {
    warnBestEffort(event, 'WorkerCache', `Cache API write failed ${r.key}`, {
      error: String(error),
    })
  }
}

function resolveOptions(options: WorkerCacheOptions, version: string | null): Resolved {
  const maxStale = Math.max(0, options.maxStaleSeconds ?? 0)
  return {
    cacheName: options.cacheName,
    fresh: options.freshSeconds,
    id: `${options.scope}|${options.key}|${version ?? ''}`,
    key: options.key,
    maxStale,
    retryBackoffMs:
      Math.max(0, options.retryBackoffSeconds ?? DEFAULT_RETRY_BACKOFF_SECONDS) * 1000,
    scope: options.scope,
    version,
  }
}

function wrap<T>(
  options: WorkerCacheOptions,
  data: T,
  meta: Omit<WorkerCacheMeta, 'key'>,
): T | { _meta: WorkerCacheMeta; data: T } {
  if (!options.returnMeta) return data
  return { data, _meta: { ...meta, key: options.key } }
}

function metaFor(
  source: WorkerCacheMeta['source'],
  r: Resolved,
  builtAt: number,
  stale: boolean,
): Omit<WorkerCacheMeta, 'key'> {
  return { cachedAt: new Date(builtAt).toISOString(), source, stale, version: r.version }
}

/**
 * Serve a completed value for `options.key` (at `options.version`) from isolate
 * memory or Workers Cache, or run `build()` and keep what it returns.
 * See the file header for the guarantees and the limits.
 */
export async function withWorkerCache<T>(
  event: H3Event,
  options: WorkerCacheOptions & { returnMeta?: false },
  build: () => Promise<T>,
): Promise<T>
export async function withWorkerCache<T>(
  event: H3Event,
  options: WorkerCacheOptions & { returnMeta: true },
  build: () => Promise<T>,
): Promise<{ _meta: WorkerCacheMeta; data: T }>
export async function withWorkerCache<T>(
  event: H3Event,
  options: WorkerCacheOptions,
  build: () => Promise<T>,
): Promise<T | { _meta: WorkerCacheMeta; data: T }>
export async function withWorkerCache<T>(
  event: H3Event,
  options: WorkerCacheOptions,
  build: () => Promise<T>,
): Promise<T | { _meta: WorkerCacheMeta; data: T }> {
  if (typeof options.key !== 'string' || options.key.length === 0) {
    throw new TypeError('withWorkerCache: options.key must be a non-empty string')
  }
  if (options.scope !== 'public' && options.scope !== 'private') {
    throw new TypeError("withWorkerCache: options.scope must be 'public' or 'private'")
  }

  const bypass = async (): Promise<T | { _meta: WorkerCacheMeta; data: T }> =>
    wrap(options, await build(), {
      cachedAt: new Date().toISOString(),
      source: 'bypass',
      stale: false,
      version: null,
    })

  if (!(options.freshSeconds > 0)) return bypass()

  let version: string | null = null
  if (options.version !== undefined) {
    try {
      const raw = typeof options.version === 'function' ? await options.version() : options.version
      version = String(raw)
    } catch (error) {
      warnBestEffort(event, 'WorkerCache', `version read failed ${options.key}`, {
        error: String(error),
      })
      return bypass()
    }
  }

  const r = resolveOptions(options, version)
  const store = getWorkerCacheStore()

  /** Store a built or edge-sourced value in memory. */
  const remember = (c: Candidate, seq: number) => store.put(r.id, { ...c, seq })

  /** Run build() once for this request and keep a serializable result. */
  const runBuild = async (): Promise<{ builtAt: number; data: T; kept: boolean }> => {
    const seq = store.nextSeq()
    const builtAt = Date.now()
    const data = await build()
    const json = serializeWorkerCacheValue(data)
    if (json === null) {
      warnBestEffort(event, 'WorkerCache', `value not serializable, not cached ${r.key}`)
      return { builtAt, data, kept: false }
    }
    const { result } = remember({ builtAt, json }, seq)
    if (result !== 'superseded' && r.scope === 'public') {
      await runInBackground(event, writeEdge(event, r, { builtAt, json }), { fallback: 'await' })
    }
    return { builtAt, data, kept: true }
  }

  const readEntry = (entry: WorkerCacheEntry): T | undefined => {
    try {
      return JSON.parse(entry.json) as T
    } catch {
      store.delete(r.id)
      return undefined
    }
  }

  /** Refresh work: adopt a fresher Workers Cache copy if there is one, else rebuild. */
  const refresh = async (staleBuiltAt: number): Promise<void> => {
    const edge = await readEdge(event, r)
    if (edge && edge.builtAt > staleBuiltAt && classify(edge.builtAt, Date.now(), r) === 'fresh') {
      remember(edge, store.nextSeq())
      return
    }
    await runBuild()
  }

  const serveStale = async (
    entry: WorkerCacheEntry,
    source: 'edge' | 'memory',
  ): Promise<T | { _meta: WorkerCacheMeta; data: T }> => {
    const stale = readEntry(entry)
    if (stale === undefined) return missPath()
    const result = wrap(options, stale, metaFor(source, r, entry.builtAt, true))
    const now = Date.now()
    if (now < entry.retryAfter || now < entry.leaseUntil) return result

    const settle = (error: unknown) => {
      entry.retryAfter = Date.now() + r.retryBackoffMs
      warnBestEffort(event, 'WorkerCache', `refresh failed, serving stale ${r.key}`, {
        error: String(error),
      })
    }

    if (!resolveWaitUntil(event)) {
      // Nothing owns background work here, so do not start any: refresh inline.
      entry.leaseUntil = now + REFRESH_LEASE_MS
      try {
        await refresh(entry.builtAt)
        const fresh = store.get(r.id)
        const value = fresh && fresh !== entry ? readEntry(fresh) : undefined
        if (fresh && value !== undefined) {
          return wrap(options, value, metaFor('build', r, fresh.builtAt, false))
        }
      } catch (error) {
        settle(error)
      } finally {
        entry.leaseUntil = 0
      }
      return result
    }

    entry.leaseUntil = now + REFRESH_LEASE_MS
    const task = refresh(entry.builtAt)
      .catch(settle)
      .finally(() => {
        entry.leaseUntil = 0
      })
    await runInBackground(event, task, { fallback: 'await' })
    return result
  }

  const missPath = async (): Promise<T | { _meta: WorkerCacheMeta; data: T }> => {
    const edge = await readEdge(event, r)
    if (edge) {
      const state = classify(edge.builtAt, Date.now(), r)
      if (state !== 'expired') {
        const { entry } = remember(edge, store.nextSeq())
        const holder: WorkerCacheEntry = entry ?? {
          ...edge,
          bytes: 0,
          leaseUntil: 0,
          retryAfter: 0,
          seq: 0,
        }
        if (state === 'fresh') {
          const value = readEntry(holder)
          if (value !== undefined) {
            return wrap(options, value, metaFor('edge', r, edge.builtAt, false))
          }
        } else {
          return serveStale(holder, 'edge')
        }
      }
    }
    const built = await runBuild()
    return wrap(
      options,
      built.data,
      metaFor(built.kept ? 'build' : 'bypass', r, built.builtAt, false),
    )
  }

  const entry = store.get(r.id)
  if (entry) {
    const state = classify(entry.builtAt, Date.now(), r)
    if (state === 'fresh') {
      const value = readEntry(entry)
      if (value !== undefined)
        return wrap(options, value, metaFor('memory', r, entry.builtAt, false))
    } else if (state === 'stale') {
      return serveStale(entry, 'memory')
    } else {
      store.delete(r.id)
    }
  }
  return missPath()
}

// --- Cache versions ---------------------------------------------------------
//
// A version is one row in the `kv_cache` table core already ships (migration
// 0001), under the key `cache-version:<name>`, so no new migration is needed.
// `expires_at` is a far-future sentinel because `cleanExpiredCache` deletes
// rows past their expiry and a version must never be swept. Reading one is a
// primary-key lookup: one row read.

const VERSION_KEY_PREFIX = 'cache-version:'
/** 9999-12-31T23:59:59Z in seconds: "never expires" for `cleanExpiredCache`. */
const VERSION_NEVER_EXPIRES = 253_402_300_799
const VERSION_BUMP_SQL = `INSERT INTO kv_cache (key, value, expires_at) VALUES (?, '1', ?)
  ON CONFLICT(key) DO UPDATE SET value = CAST(kv_cache.value AS INTEGER) + 1, expires_at = excluded.expires_at`

function versionKey(name: string): string {
  if (typeof name !== 'string' || name.length === 0) {
    throw new TypeError('cache version name must be a non-empty string')
  }
  return `${VERSION_KEY_PREFIX}${name}`
}

/**
 * The current version of `name`, as a string. `'0'` when it has never been
 * bumped. Pass it as `withWorkerCache`'s `version`.
 */
export async function readCacheVersion(db: D1Database, name: string): Promise<string> {
  const row = await db
    .prepare('SELECT value FROM kv_cache WHERE key = ?')
    .bind(versionKey(name))
    .first<{ value: string }>()
  return row ? String(row.value) : '0'
}

/**
 * A prepared statement that bumps the version of `name`. Put it in the same
 * `db.batch([...])` as the write it covers, so the version moves if and only if
 * the data does.
 *
 * @example
 * ```ts
 * await db.batch([
 *   db.prepare('UPDATE stations SET status = ? WHERE id = ?').bind(status, id),
 *   prepareCacheVersionBump(db, 'stations'),
 * ])
 * ```
 */
export function prepareCacheVersionBump(db: D1Database, name: string): D1PreparedStatement {
  return db.prepare(VERSION_BUMP_SQL).bind(versionKey(name), VERSION_NEVER_EXPIRES)
}

/**
 * Bump the version of `name` and return the new one. Call it after the write it
 * covers has committed; when you can batch, `prepareCacheVersionBump` is atomic
 * with the write.
 */
export async function bumpCacheVersion(db: D1Database, name: string): Promise<string> {
  const row = await db
    .prepare(`${VERSION_BUMP_SQL} RETURNING value`)
    .bind(versionKey(name), VERSION_NEVER_EXPIRES)
    .first<{ value: string }>()
  return row ? String(row.value) : readCacheVersion(db, name)
}
