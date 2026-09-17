/// <reference types="@cloudflare/workers-types" />
import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'

/**
 * Options for {@link createFakeR2Bucket}.
 */
export interface CreateFakeR2Options {
  /** Clock used to stamp `uploaded`. Defaults to `() => new Date()`. */
  now?: () => Date
}

interface StoredObject {
  body: Buffer
  customMetadata?: Record<string, string>
  etag: string
  httpMetadata?: R2HTTPMetadata
  uploaded: Date
}

async function normalizeBody(
  value: ArrayBuffer | ArrayBufferView | Blob | ReadableStream | string | null,
): Promise<Buffer> {
  if (value === null) return Buffer.alloc(0)
  if (typeof value === 'string') return Buffer.from(value)
  if (Buffer.isBuffer(value)) return value
  if (ArrayBuffer.isView(value)) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength)
  }
  if (value instanceof ArrayBuffer) return Buffer.from(value)
  if (typeof (value as Blob).arrayBuffer === 'function') {
    return Buffer.from(await (value as Blob).arrayBuffer())
  }

  const reader = (value as ReadableStream<Uint8Array>).getReader()
  const chunks: Uint8Array[] = []
  for (;;) {
    const { done, value: chunk } = await reader.read()
    if (done) break
    if (chunk) chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

function computeEtag(body: Buffer): string {
  // R2's real etag is an MD5 of the object body for a single-part upload, so
  // this fake computes the same thing -- close enough that an equality
  // assertion against a known body's etag actually means something, even
  // though R2 documents the format as an implementation detail.
  return createHash('md5').update(body).digest('hex')
}

function toR2Object(key: string, stored: StoredObject): R2Object {
  return {
    checksums: { toJSON: () => ({}) } as unknown as R2Object['checksums'],
    customMetadata: stored.customMetadata,
    etag: stored.etag,
    httpEtag: `"${stored.etag}"`,
    httpMetadata: stored.httpMetadata,
    key,
    size: stored.body.byteLength,
    storageClass: 'Standard',
    uploaded: stored.uploaded,
    version: stored.etag,
    writeHttpMetadata(headers: Headers) {
      if (stored.httpMetadata?.contentType)
        headers.set('content-type', stored.httpMetadata.contentType)
      if (stored.httpMetadata?.cacheControl)
        headers.set('cache-control', stored.httpMetadata.cacheControl)
    },
  } as unknown as R2Object
}

function toR2ObjectBody(key: string, stored: StoredObject): R2ObjectBody {
  let used = false
  const base = toR2Object(key, stored)
  return {
    ...base,
    async arrayBuffer() {
      used = true
      return stored.body.buffer.slice(
        stored.body.byteOffset,
        stored.body.byteOffset + stored.body.byteLength,
      )
    },
    get body() {
      return Readable.toWeb(Readable.from(stored.body)) as unknown as ReadableStream
    },
    get bodyUsed() {
      return used
    },
    async blob() {
      used = true
      return new Blob([new Uint8Array(stored.body)])
    },
    async bytes() {
      used = true
      return new Uint8Array(stored.body)
    },
    async json<T>() {
      used = true
      return JSON.parse(stored.body.toString('utf8')) as T
    },
    async text() {
      used = true
      return stored.body.toString('utf8')
    },
  } as unknown as R2ObjectBody
}

/**
 * An in-memory `R2Bucket` fake: `head`/`get`/`put`/`delete`/`list`, storing
 * the body as a `Buffer` and computing a real MD5 etag so equality
 * assertions against a known upload's etag hold.
 *
 * Not emulated: multipart uploads (`createMultipartUpload` and friends),
 * conditional requests (`onlyIf`), R2's real per-region consistency
 * behavior, and `list`'s `delimiter`/`include` options beyond a flat
 * `prefix` + `cursor` page.
 */
export function createFakeR2Bucket(options: CreateFakeR2Options = {}): R2Bucket {
  const now = options.now ?? (() => new Date())
  const store = new Map<string, StoredObject>()

  const bucket = {
    async delete(keys: string | string[]): Promise<void> {
      for (const key of Array.isArray(keys) ? keys : [keys]) store.delete(key)
    },

    async get(key: string): Promise<R2ObjectBody | null> {
      const stored = store.get(key)
      return stored ? toR2ObjectBody(key, stored) : null
    },

    async head(key: string): Promise<R2Object | null> {
      const stored = store.get(key)
      return stored ? toR2Object(key, stored) : null
    },

    async list(listOptions: R2ListOptions = {}): Promise<R2Objects> {
      const prefix = listOptions.prefix ?? ''
      const limit = listOptions.limit ?? 1000
      const objects = [...store.entries()]
        .filter(([key]) => key.startsWith(prefix))
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, stored]) => toR2Object(key, stored))

      const startIndex = listOptions.cursor ? Number.parseInt(listOptions.cursor, 10) : 0
      const page = objects.slice(startIndex, startIndex + limit)
      const truncated = startIndex + limit < objects.length

      return {
        delimitedPrefixes: [],
        objects: page,
        truncated,
        ...(truncated ? { cursor: String(startIndex + limit) } : {}),
      } as unknown as R2Objects
    },

    async put(
      key: string,
      value: ArrayBuffer | ArrayBufferView | Blob | ReadableStream | string | null,
      putOptions?: R2PutOptions,
    ): Promise<R2Object> {
      const body = await normalizeBody(value)
      const stored: StoredObject = {
        body,
        customMetadata: putOptions?.customMetadata,
        etag: computeEtag(body),
        httpMetadata: putOptions?.httpMetadata as R2HTTPMetadata | undefined,
        uploaded: now(),
      }
      store.set(key, stored)
      return toR2Object(key, stored)
    },
  }

  return bucket as unknown as R2Bucket
}
