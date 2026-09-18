import { createError } from 'h3'

export const ALLOWED_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
])

/**
 * Strip MIME parameters and lowercase so `image/PNG; charset=x` matches
 * `ALLOWED_TYPES`. Used by POST /api/upload and GET /images/** so the
 * two cannot drift.
 */
export function normalizeUploadContentType(contentType) {
  if (typeof contentType !== 'string') return ''
  return contentType.toLowerCase().split(';', 1)[0]?.trim() ?? ''
}

export function isAllowedUploadContentType(contentType) {
  return ALLOWED_TYPES.has(normalizeUploadContentType(contentType))
}

function asciiAt(bytes, offset, text) {
  if (bytes.length < offset + text.length) return false
  for (let index = 0; index < text.length; index += 1) {
    if (bytes[offset + index] !== text.charCodeAt(index)) return false
  }
  return true
}

function startsWith(bytes, signature) {
  if (bytes.length < signature.length) return false
  return signature.every((byte, index) => bytes[index] === byte)
}

const AVIF_BRANDS = ['avif', 'avis']

function isAvif(bytes) {
  if (!asciiAt(bytes, 4, 'ftyp')) return false
  const boxSize = ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0
  const end = Math.min(boxSize, bytes.length)
  if (end < 16) return false
  // Major brand at 8, minor version at 12, compatible brands from 16.
  if (AVIF_BRANDS.some((brand) => asciiAt(bytes, 8, brand))) return true
  for (let offset = 16; offset + 4 <= end; offset += 4) {
    if (AVIF_BRANDS.some((brand) => asciiAt(bytes, offset, brand))) return true
  }
  return false
}

/**
 * The allow-listed raster type the bytes actually are, or `''`.
 *
 * The multipart `part.type` is a client header, so an HTML or SVG payload can
 * arrive labelled `image/png` (DR-DATA-7). The upload route stores the type
 * this returns, never the label, and refuses a file it cannot identify.
 */
export function sniffUploadImageType(bytes) {
  if (!bytes || typeof bytes.length !== 'number') return ''
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (asciiAt(bytes, 0, 'GIF87a') || asciiAt(bytes, 0, 'GIF89a')) return 'image/gif'
  if (asciiAt(bytes, 0, 'RIFF') && asciiAt(bytes, 8, 'WEBP')) return 'image/webp'
  if (isAvif(bytes)) return 'image/avif'
  return ''
}

export const MAX_FILE_SIZE = 10 * 1024 * 1024
export const MAX_UPLOAD_REQUEST_SIZE = MAX_FILE_SIZE * 10

function chunkByteLength(chunk) {
  if (chunk == null) return 0
  if (typeof chunk.byteLength === 'number') return chunk.byteLength
  if (typeof chunk.length === 'number') return chunk.length
  return 0
}

/**
 * Hard-stop an incoming Node body once it exceeds `maxBytes`. h3's
 * `readMultipartFormData` buffers the whole stream with no limit, so a
 * lying Content-Length would otherwise land the full body in memory.
 * Destroying the request is the stop; the caller maps that to 413.
 */
export function capIncomingMessageBytes(req, maxBytes) {
  if (!req || typeof req.on !== 'function') return
  let seen = 0
  req.on('data', (chunk) => {
    seen += chunkByteLength(chunk)
    if (seen <= maxBytes) return
    const error = new Error(`Upload request exceeds ${maxBytes / 1024 / 1024}MB limit`)
    error.statusCode = 413
    if (typeof req.destroy === 'function') req.destroy(error)
    else req.emit?.('error', error)
  })
}

const H3_RAW_BODY = Symbol.for('h3RawBody')

function uploadTooLargeError(maxBytes) {
  return createError({
    statusCode: 413,
    message: `Upload request exceeds ${maxBytes / 1024 / 1024}MB limit`,
  })
}

function isWebReadableStream(value) {
  return typeof value?.getReader === 'function'
}

function isNodeReadableStream(value) {
  return typeof value?.pipe === 'function' && typeof value?.on === 'function'
}

/**
 * Read a web `ReadableStream` while counting bytes, and abort the moment the
 * running total would pass `maxBytes`. The overflowing chunk is never kept and
 * no further chunk is pulled, so at most `maxBytes + one chunk` is ever read.
 * The source is cancelled on abort so the Worker stops reading the request.
 */
export async function readCappedWebStream(stream, maxBytes) {
  const reader = stream.getReader()
  const chunks = []
  let seen = 0

  try {
    for (;;) {
      // Sequential by design: each chunk has to be counted before the next is
      // pulled, so the cap stops the stream instead of racing a parallel drain.
      // eslint-disable-next-line no-await-in-loop -- see above
      const { done, value } = await reader.read()
      if (done) break
      const size = chunkByteLength(value)
      if (seen + size > maxBytes) throw uploadTooLargeError(maxBytes)
      seen += size
      chunks.push(value)
    }
  } catch (error) {
    await reader.cancel(error).catch(() => {})
    throw error
  }

  if (chunks.length === 1) return chunks[0]

  const body = new Uint8Array(seen)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunkByteLength(chunk)
  }
  return body
}

/**
 * Hold `maxBytes` while the request body is READ, before the multipart parse.
 *
 * `capIncomingMessageBytes` only covers a live Node request stream. On
 * Cloudflare Workers — the only runtime Narduk apps deploy to — there is no
 * such stream: h3 resolves the body from `event._requestBody` /
 * `event.web.request.body` (a web `ReadableStream`, which `readRawBody`
 * buffers with no limit) or from the bytes the Nitro `cloudflare_module`
 * handler already materialised onto `event.node.req.body`. A client that
 * declares a small `Content-Length` and then sends more passes the header
 * check and is bounded by neither.
 *
 * Resolution order mirrors h3's own so no body shape it would read is missed.
 * A web stream is read through a counting reader; already-materialised bytes
 * are measured and refused before the parse; a live Node stream is left to
 * `capIncomingMessageBytes`, which owns that path.
 */
export async function enforceUploadBodyByteCap(event, maxBytes) {
  const req = event?.node?.req
  let body =
    event?._requestBody ??
    event?.web?.request?.body ??
    req?.[H3_RAW_BODY] ??
    req?.rawBody ??
    req?.body
  if (typeof body?.then === 'function') body = await body
  if (body == null || isNodeReadableStream(body)) return undefined

  if (!isWebReadableStream(body)) {
    if (chunkByteLength(body) > maxBytes) throw uploadTooLargeError(maxBytes)
    return body
  }

  const bytes = await readCappedWebStream(body, maxBytes)
  // Zero-copy view so h3's `Buffer.isBuffer` short-circuit skips another copy.
  const bounded = globalThis.Buffer
    ? globalThis.Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    : bytes
  // h3 reads `_requestBody` first, so the parse gets these bounded bytes and
  // never touches the stream we just drained.
  event._requestBody = bounded
  return bounded
}
export const PUBLIC_RASTER_WARNING_SIZE = 800 * 1024
export const CRITICAL_RASTER_WARNING_SIZE = 350 * 1024

const CRITICAL_IMAGE_NAME_PATTERN = /hero|cover|banner|landing|home|card|logo/iu
const WARNING_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif'])

export function getUploadPerformanceWarnings(file) {
  if (!file.type || !WARNING_IMAGE_TYPES.has(file.type)) return []

  const warnings = []
  const filename = file.filename ?? ''
  const sizeBytes = file.data.byteLength
  const criticalThreshold = CRITICAL_IMAGE_NAME_PATTERN.test(filename)
    ? CRITICAL_RASTER_WARNING_SIZE
    : null

  if (criticalThreshold && sizeBytes > criticalThreshold) {
    warnings.push({
      code: 'large-critical-raster',
      message: `Likely above-the-fold image exceeds ${Math.round(criticalThreshold / 1024)}KB; resize or compress before publishing.`,
      sizeBytes,
      thresholdBytes: criticalThreshold,
    })
  } else if (sizeBytes > PUBLIC_RASTER_WARNING_SIZE) {
    warnings.push({
      code: 'large-public-raster',
      message: `Public raster image exceeds ${Math.round(PUBLIC_RASTER_WARNING_SIZE / 1024)}KB; resize or compress before publishing.`,
      sizeBytes,
      thresholdBytes: PUBLIC_RASTER_WARNING_SIZE,
    })
  }

  return warnings
}

export function validateUploadFiles(files) {
  for (const file of files) {
    if (!isAllowedUploadContentType(file.type)) {
      throw createError({
        statusCode: 400,
        message: `Unsupported file type: ${file.type ?? 'unknown'}`,
      })
    }
    if (file.data.byteLength > MAX_FILE_SIZE) {
      throw createError({
        statusCode: 400,
        message: `File exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB limit`,
      })
    }
  }
}

export function normalizeExtension(mimeType) {
  const sub = mimeType.split('/')[1] ?? 'bin'
  return sub.replace('jpeg', 'jpg').replace('svg+xml', 'svg')
}
