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
