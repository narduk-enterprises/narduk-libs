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

/**
 * `list`'s options, plus the `include` the runtime honours.
 *
 * `@cloudflare/workers-types@4.20260511.1` omits `include` from
 * `R2ListOptions`, but a real bucket does gate `httpMetadata`/`customMetadata`
 * on it (verified against workerd via miniflare), so the fake must accept it.
 */
export type FakeR2ListOptions = R2ListOptions & {
  include?: Array<'customMetadata' | 'httpMetadata'>
}

/** The byte window a `get` resolved to, in the `{ offset, length }` shape R2 reports. */
interface ResolvedRange {
  length: number
  offset: number
}

/**
 * Resolve an `R2Range` against a known object size the way R2 does: `suffix`
 * counts back from the end, a bare `offset` runs to the end, and a window that
 * starts past the end is unsatisfiable rather than empty.
 */
function resolveRange(range: Headers | R2Range | undefined, size: number): ResolvedRange {
  if (!range) return { length: size, offset: 0 }

  if (typeof (range as Headers).get === 'function') {
    throw new TypeError(
      'createFakeR2Bucket: get() does not accept a `Range` header object — pass the `{ offset, length }` / `{ suffix }` form instead.',
    )
  }

  if ('suffix' in range && range.suffix !== undefined) {
    const length = Math.min(range.suffix, size)
    return { length, offset: size - length }
  }

  const offset = 'offset' in range && range.offset !== undefined ? range.offset : 0
  if (offset >= size && size > 0) {
    throw new Error('get: The requested range is not satisfiable (10039)')
  }
  const requested = 'length' in range && range.length !== undefined ? range.length : size - offset
  return { length: Math.min(requested, size - offset), offset }
}

function toR2Object(key: string, stored: StoredObject, range?: ResolvedRange): R2Object {
  return {
    checksums: { toJSON: () => ({ md5: stored.etag }) } as unknown as R2Object['checksums'],
    // R2 reports `{}` rather than `undefined` when an object carries no
    // metadata, so a handler doing `object.customMetadata.owner` throws in
    // exactly the same place it would in production.
    customMetadata: stored.customMetadata ?? {},
    etag: stored.etag,
    httpEtag: `"${stored.etag}"`,
    httpMetadata: stored.httpMetadata ?? {},
    key,
    range: range ?? { length: stored.body.byteLength, offset: 0 },
    // `size` is always the whole object's size, even for a ranged read.
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

/** The message R2 itself raises when a body is consumed twice. */
const BODY_ALREADY_USED =
  'Body has already been used. It can only be used once. Use tee() first if you need to read it twice.'

function toR2ObjectBody(key: string, stored: StoredObject, range: ResolvedRange): R2ObjectBody {
  let used = false
  const base = toR2Object(key, stored, range)
  const bytes = stored.body.subarray(range.offset, range.offset + range.length)

  // R2's body is single-use: a second read throws rather than replaying the
  // bytes. A fake that replays them hides a double-read bug until production.
  const consume = (): Buffer => {
    if (used) throw new TypeError(BODY_ALREADY_USED)
    used = true
    return bytes
  }

  return {
    ...base,
    async arrayBuffer() {
      const body = consume()
      const copy = Buffer.from(body)
      return copy.buffer.slice(copy.byteOffset, copy.byteOffset + copy.byteLength)
    },
    get body() {
      const body = consume()
      return Readable.toWeb(Readable.from(body)) as unknown as ReadableStream
    },
    get bodyUsed() {
      return used
    },
    async blob() {
      return new Blob([new Uint8Array(consume())])
    },
    async bytes() {
      return new Uint8Array(consume())
    },
    async json<T>() {
      return JSON.parse(consume().toString('utf8')) as T
    },
    async text() {
      return consume().toString('utf8')
    },
  } as unknown as R2ObjectBody
}

/**
 * An in-memory `R2Bucket` fake: `head`/`get`/`put`/`delete`/`list`, storing
 * the body as a `Buffer` and computing a real MD5 etag so equality
 * assertions against a known upload's etag hold.
 *
 * Ranged reads (`get(key, { range })`), R2's single-use body, and `list`'s
 * `include` gate on the two metadata maps all behave as the real binding
 * does, because each is a place where a more permissive fake would turn a
 * broken handler into a green test.
 *
 * Not emulated: multipart uploads (`createMultipartUpload` and friends),
 * conditional requests (`onlyIf` — `get` throws rather than quietly ignoring
 * it), R2's real per-region consistency behavior, and `list`'s `delimiter`
 * beyond a flat `prefix` + `cursor` page.
 */
export function createFakeR2Bucket(options: CreateFakeR2Options = {}): R2Bucket {
  const now = options.now ?? (() => new Date())
  const store = new Map<string, StoredObject>()

  const bucket = {
    async delete(keys: string | string[]): Promise<void> {
      for (const key of Array.isArray(keys) ? keys : [keys]) store.delete(key)
    },

    async get(key: string, getOptions?: R2GetOptions): Promise<R2ObjectBody | null> {
      if (getOptions?.onlyIf !== undefined) {
        // Silently ignoring `onlyIf` would be the worst outcome: a real bucket
        // answers a failed precondition with a body-less R2Object, so a
        // handler that mishandles that path would pass here and 500 in
        // production. Refusing is honest about the gap.
        throw new Error(
          'createFakeR2Bucket: get() does not emulate conditional requests (`onlyIf`) — a real bucket answers a failed precondition with a body-less R2Object. Test that path against a real (or `wrangler dev`) binding.',
        )
      }

      const stored = store.get(key)
      if (!stored) return null
      return toR2ObjectBody(key, stored, resolveRange(getOptions?.range, stored.body.byteLength))
    },

    async head(key: string): Promise<R2Object | null> {
      const stored = store.get(key)
      return stored ? toR2Object(key, stored) : null
    },

    async list(listOptions: FakeR2ListOptions = {}): Promise<R2Objects> {
      const prefix = listOptions.prefix ?? ''
      const limit = listOptions.limit ?? 1000
      // `list` omits both metadata maps unless the caller opts in with
      // `include`, so a test that reads `object.customMetadata` off a list
      // result fails here exactly as it would against a real bucket.
      const include = new Set(listOptions.include ?? [])
      const objects = [...store.entries()]
        .filter(([key]) => key.startsWith(prefix))
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, stored]) =>
          toR2Object(key, {
            ...stored,
            customMetadata: include.has('customMetadata') ? stored.customMetadata : undefined,
            httpMetadata: include.has('httpMetadata') ? stored.httpMetadata : undefined,
          }),
        )

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
