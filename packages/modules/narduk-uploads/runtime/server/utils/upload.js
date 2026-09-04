import { createError } from 'h3'

export const ALLOWED_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
])

export const MAX_FILE_SIZE = 10 * 1024 * 1024
export const MAX_UPLOAD_REQUEST_SIZE = MAX_FILE_SIZE * 10
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
    if (!file.type || !ALLOWED_TYPES.has(file.type)) {
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
