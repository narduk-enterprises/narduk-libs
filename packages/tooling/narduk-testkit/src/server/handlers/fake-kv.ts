/// <reference types="@cloudflare/workers-types" />
import { Readable } from 'node:stream'

/**
 * Options for {@link createFakeKVNamespace}.
 */
export interface CreateFakeKVOptions {
  /**
   * Clock used to evaluate `expiration`/`expirationTtl`. Defaults to
   * `Date.now`; pass a fake to test expiry deterministically (see
   * `tests/server/handlers/fake-kv.test.ts` for the pattern with
   * `vi.useFakeTimers()`).
   */
  now?: () => number
}

interface StoredEntry {
  expiresAtMs?: number
  metadata?: unknown
  /**
   * The raw bytes, never a decoded string. KV stores bytes: round-tripping a
   * binary value through a UTF-8 string would silently replace every byte
   * that is not valid UTF-8 with U+FFFD, so `get(key, 'arrayBuffer')` would
   * hand back corrupted data while the real binding hands back the exact
   * bytes that were written.
   */
  value: Buffer
}

/** KV's own key rules, enforced so a key a real namespace rejects fails here too. */
const MAX_KEY_BYTES = 512
/** KV's own floor: an `expirationTtl` below this is a 400 from the real API. */
const MIN_EXPIRATION_TTL_SECONDS = 60

function assertValidKey(key: string): void {
  if (key === '') throw new TypeError('Key name cannot be empty.')
  if (key === '.' || key === '..') throw new TypeError(`"${key}" is not allowed as a key name.`)
  const byteLength = Buffer.byteLength(key, 'utf8')
  if (byteLength > MAX_KEY_BYTES) {
    throw new Error(
      `KV PUT failed: 414 UTF-8 encoded length of ${byteLength} exceeds key length limit of ${MAX_KEY_BYTES}.`,
    )
  }
}

function isExpired(entry: StoredEntry, nowMs: number): boolean {
  return entry.expiresAtMs !== undefined && entry.expiresAtMs <= nowMs
}

function resolveType(typeOrOptions: KVNamespaceGetOptions<string> | string | undefined): string {
  if (typeof typeOrOptions === 'string') return typeOrOptions
  return typeOrOptions?.type ?? 'text'
}

function decodeValue(value: Buffer, type: string): unknown {
  if (type === 'json') return JSON.parse(value.toString('utf8'))
  if (type === 'arrayBuffer') {
    // A fresh copy, so a caller mutating the returned buffer cannot reach
    // back into the stored entry.
    const copy = Buffer.from(value)
    return copy.buffer.slice(copy.byteOffset, copy.byteOffset + copy.byteLength)
  }
  if (type === 'stream') {
    return Readable.toWeb(Readable.from([Buffer.from(value)]))
  }
  return value.toString('utf8')
}

/**
 * An in-memory `KVNamespace` fake: `get`/`put`/`delete`/`list`, with
 * expiration (`expiration` and `expirationTtl`, evaluated lazily on read so a
 * fake clock can prove expiry deterministically) and `metadata`, matching the
 * subset of the KV binding narduk-core and its consumers actually call (see
 * `packages/modules/narduk-core/runtime/server/utils/kv.ts`).
 *
 * Key rules and expiration floors the real API enforces are enforced here too
 * (empty/`.`/`..`/over-512-byte keys, `expirationTtl` under 60 seconds, an
 * `expiration` in the past or less than 60 seconds out), because a fake that
 * accepts what production rejects turns a broken handler into a green test.
 *
 * Not emulated: KV's real eventual consistency (a write here is visible to
 * every subsequent read immediately, which a real KV replica does not
 * promise), the 25 MiB value and 1 KiB metadata size limits, per-namespace
 * key-count limits, and `list`'s `cursor` is a plain offset rather than KV's
 * opaque cursor token — good enough to page through a `list` result in a
 * test, not to model a stable cursor across concurrent writes.
 */
export function createFakeKVNamespace(options: CreateFakeKVOptions = {}): KVNamespace {
  const now = options.now ?? Date.now
  const store = new Map<string, StoredEntry>()

  function readEntry(key: string): StoredEntry | undefined {
    const entry = store.get(key)
    if (!entry) return undefined
    if (isExpired(entry, now())) {
      store.delete(key)
      return undefined
    }
    return entry
  }

  const namespace = {
    async delete(key: string): Promise<void> {
      assertValidKey(key)
      store.delete(key)
    },

    async get(
      key: string,
      typeOrOptions?: KVNamespaceGetOptions<string> | string,
    ): Promise<unknown> {
      assertValidKey(key)
      const entry = readEntry(key)
      if (!entry) return null
      return decodeValue(entry.value, resolveType(typeOrOptions))
    },

    async getWithMetadata(
      key: string,
      typeOrOptions?: KVNamespaceGetOptions<string> | string,
    ): Promise<KVNamespaceGetWithMetadataResult<unknown, unknown>> {
      assertValidKey(key)
      const entry = readEntry(key)
      if (!entry) return { cacheStatus: null, metadata: null, value: null }
      return {
        cacheStatus: null,
        metadata: entry.metadata ?? null,
        value: decodeValue(entry.value, resolveType(typeOrOptions)),
      }
    },

    async list(
      listOptions: KVNamespaceListOptions = {},
    ): Promise<KVNamespaceListResult<unknown, string>> {
      const prefix = listOptions.prefix ?? ''
      const limit = listOptions.limit ?? 1000
      if (limit > 1000) {
        throw new Error(
          `KV GET failed: 400 Invalid key_count_limit of ${limit}. Please specify an integer less than 1000.`,
        )
      }
      const nowMs = now()

      const keys = [...store.entries()]
        .filter(([key, entry]) => key.startsWith(prefix) && !isExpired(entry, nowMs))
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([name, entry]) => ({
          name,
          ...(entry.expiresAtMs !== undefined
            ? { expiration: Math.round(entry.expiresAtMs / 1000) }
            : {}),
          ...(entry.metadata !== undefined ? { metadata: entry.metadata } : {}),
        }))

      const startIndex = listOptions.cursor ? Number.parseInt(listOptions.cursor, 10) : 0
      const page = keys.slice(startIndex, startIndex + limit)
      const listComplete = startIndex + limit >= keys.length

      return (
        listComplete
          ? { cacheStatus: null, keys: page, list_complete: true }
          : {
              cacheStatus: null,
              cursor: String(startIndex + limit),
              keys: page,
              list_complete: false,
            }
      ) as KVNamespaceListResult<unknown, string>
    },

    async put(
      key: string,
      value: ArrayBuffer | ArrayBufferView | ReadableStream | string,
      putOptions?: KVNamespacePutOptions,
    ): Promise<void> {
      assertValidKey(key)

      const bytes =
        typeof value === 'string'
          ? Buffer.from(value, 'utf8')
          : Buffer.isBuffer(value)
            ? Buffer.from(value)
            : ArrayBuffer.isView(value)
              ? Buffer.from(Buffer.from(value.buffer, value.byteOffset, value.byteLength as number))
              : value instanceof ArrayBuffer
                ? Buffer.from(value)
                : (() => {
                    throw new TypeError(
                      'createFakeKVNamespace: put() only accepts a string, Buffer, ArrayBuffer, or ArrayBufferView in this fake — streamed bodies are not supported.',
                    )
                  })()

      let expiresAtMs: number | undefined
      if (putOptions?.expirationTtl !== undefined) {
        const ttl = putOptions.expirationTtl
        if (ttl < MIN_EXPIRATION_TTL_SECONDS) {
          throw new Error(
            `KV PUT failed: 400 Invalid expiration_ttl of ${ttl}. Expiration TTL must be at least ${MIN_EXPIRATION_TTL_SECONDS}.`,
          )
        }
        expiresAtMs = now() + ttl * 1000
      } else if (putOptions?.expiration !== undefined) {
        const expiration = putOptions.expiration
        const nowSeconds = Math.floor(now() / 1000)
        if (expiration <= nowSeconds) {
          throw new Error(
            `KV PUT failed: 400 Invalid expiration of ${expiration}. Please specify integer greater than the current number of seconds since the UNIX epoch.`,
          )
        }
        if (expiration - nowSeconds < MIN_EXPIRATION_TTL_SECONDS) {
          throw new Error(
            `KV PUT failed: 400 Invalid expiration of ${expiration}. Expiration times must be at least ${MIN_EXPIRATION_TTL_SECONDS} seconds in the future.`,
          )
        }
        expiresAtMs = expiration * 1000
      }

      store.set(key, { expiresAtMs, metadata: putOptions?.metadata, value: bytes })
    },
  }

  return namespace as unknown as KVNamespace
}
