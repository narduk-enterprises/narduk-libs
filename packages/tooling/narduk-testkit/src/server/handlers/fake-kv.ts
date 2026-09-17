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
  value: string
}

function isExpired(entry: StoredEntry, nowMs: number): boolean {
  return entry.expiresAtMs !== undefined && entry.expiresAtMs <= nowMs
}

function resolveType(typeOrOptions: KVNamespaceGetOptions<string> | string | undefined): string {
  if (typeof typeOrOptions === 'string') return typeOrOptions
  return typeOrOptions?.type ?? 'text'
}

function decodeValue(value: string, type: string): unknown {
  if (type === 'json') return JSON.parse(value)
  if (type === 'arrayBuffer') {
    const buf = Buffer.from(value, 'utf8')
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  }
  if (type === 'stream') {
    return Readable.toWeb(Readable.from([Buffer.from(value, 'utf8')]))
  }
  return value
}

/**
 * An in-memory `KVNamespace` fake: `get`/`put`/`delete`/`list`, with
 * expiration (`expiration` and `expirationTtl`, evaluated lazily on read so a
 * fake clock can prove expiry deterministically) and `metadata`, matching the
 * subset of the KV binding narduk-core and its consumers actually call (see
 * `packages/modules/narduk-core/runtime/server/utils/kv.ts`).
 *
 * Not emulated: KV's real eventual consistency (a write here is visible to
 * every subsequent read immediately, which a real KV replica does not
 * promise), per-namespace size/key-count limits, and `list`'s `cursor` is a
 * plain offset rather than KV's opaque cursor token — good enough to page
 * through a `list` result in a test, not to model a stable cursor across
 * concurrent writes.
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
      store.delete(key)
    },

    async get(
      key: string,
      typeOrOptions?: KVNamespaceGetOptions<string> | string,
    ): Promise<unknown> {
      const entry = readEntry(key)
      if (!entry) return null
      return decodeValue(entry.value, resolveType(typeOrOptions))
    },

    async getWithMetadata(
      key: string,
      typeOrOptions?: KVNamespaceGetOptions<string> | string,
    ): Promise<KVNamespaceGetWithMetadataResult<unknown, unknown>> {
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
          ? { keys: page, list_complete: true }
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
      const text =
        typeof value === 'string'
          ? value
          : Buffer.isBuffer(value)
            ? value.toString('utf8')
            : ArrayBuffer.isView(value)
              ? Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString('utf8')
              : value instanceof ArrayBuffer
                ? Buffer.from(value).toString('utf8')
                : (() => {
                    throw new TypeError(
                      'createFakeKVNamespace: put() only accepts a string, Buffer, ArrayBuffer, or ArrayBufferView in this fake — streamed bodies are not supported.',
                    )
                  })()

      let expiresAtMs: number | undefined
      if (putOptions?.expirationTtl !== undefined) {
        expiresAtMs = now() + putOptions.expirationTtl * 1000
      } else if (putOptions?.expiration !== undefined) {
        expiresAtMs = putOptions.expiration * 1000
      }

      store.set(key, { expiresAtMs, metadata: putOptions?.metadata, value: text })
    },
  }

  return namespace as unknown as KVNamespace
}
