/**
 * Read an upstream response body with a hard size ceiling (narduk-libs#565).
 *
 * The ceiling is enforced against bytes actually accumulated, so an upstream
 * that omits or lies about `content-length` cannot push more than one chunk
 * past it into isolate memory; the stream is cancelled rather than drained.
 * `response.text()` followed by a length check does not do this: it buffers the
 * whole body before it looks.
 */

/** Thrown when a body is larger than the ceiling it was read with. */
export class BoundedBodyTooLargeError extends Error {
  readonly maxBytes: number

  constructor(maxBytes: number, label?: string) {
    super(`${label ?? 'Response body'} exceeds the ${maxBytes}-byte ceiling.`)
    this.name = 'BoundedBodyTooLargeError'
    this.maxBytes = maxBytes
  }
}

export interface ReadBoundedBodyOptions {
  /** Names the body in the default error message, e.g. the upstream it came from. */
  label?: string
  /** Builds the error thrown at the ceiling, for a caller with its own error type. */
  tooLarge?: () => Error
}

/**
 * Read `response`'s body, never holding more than `maxBytes` of it. A
 * single-chunk body is returned as-is, so the common small response never pays
 * for a merged copy.
 */
export async function readBoundedBody(
  response: Response,
  maxBytes: number,
  options: ReadBoundedBodyOptions = {},
): Promise<Uint8Array<ArrayBuffer>> {
  const tooLarge = () =>
    options.tooLarge?.() ?? new BoundedBodyTooLargeError(maxBytes, options.label)

  const declaredLength = Number(response.headers.get('content-length') ?? '')
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw tooLarge()
  }

  const body = response.body
  if (!body) {
    const buffered = new Uint8Array(await response.arrayBuffer())
    if (buffered.byteLength > maxBytes) throw tooLarge()
    return buffered
  }

  const reader = body.getReader()
  const chunks: Array<Uint8Array<ArrayBufferLike>> = []
  let byteCount = 0
  try {
    for (;;) {
      // eslint-disable-next-line no-await-in-loop -- a stream is read one chunk at a time; that is the point of the ceiling
      const { done, value } = await reader.read()
      if (done) break
      byteCount += value.byteLength
      if (byteCount > maxBytes) {
        // eslint-disable-next-line no-await-in-loop -- cancelling stops the download instead of draining the rest of it
        await reader.cancel()
        throw tooLarge()
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const only = chunks.length === 1 ? chunks[0] : undefined
  if (only && only.byteLength === byteCount && only.buffer instanceof ArrayBuffer) {
    return only as Uint8Array<ArrayBuffer>
  }
  const merged = new Uint8Array(byteCount)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return merged
}

/** `readBoundedBody`, decoded as UTF-8 and parsed as JSON. */
export async function readBoundedJson<T = unknown>(
  response: Response,
  maxBytes: number,
  options: ReadBoundedBodyOptions = {},
): Promise<T> {
  const bytes = await readBoundedBody(response, maxBytes, options)
  return JSON.parse(new TextDecoder().decode(bytes)) as T
}
