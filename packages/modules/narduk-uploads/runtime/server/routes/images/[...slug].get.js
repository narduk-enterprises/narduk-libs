/**
 * R2 image serving route, GET and HEAD (the module registers this handler for both).
 *
 * Public `/images/**` is first-party origin. Serve only objects whose content
 * type is in the same `ALLOWED_TYPES` allow-list as POST /api/upload.
 * `X-Content-Type-Options: nosniff` does not stop a declared `text/html` or
 * `application/javascript` object from executing; a deny-list (SVG only) is
 * not enough.
 *
 * Which keys are served, from which binding and with which cache policy comes
 * from the module's `images` option (runtime config `nardukUploads`). With
 * none configured it serves `uploads/` from `BUCKET` with a one-year
 * immutable cache, as before. A key outside every prefix is a 404 before R2
 * is read.
 */
import { useR2 } from '@narduk-enterprises/narduk-uploads/runtime/server/utils/r2'
import {
  isAllowedUploadContentType,
  normalizeUploadContentType,
} from '@narduk-enterprises/narduk-uploads/runtime/server/utils/upload'
import {
  createError,
  defineEventHandler,
  getRequestHeader,
  getRouterParam,
  setResponseHeaders,
  setResponseStatus,
} from 'h3'
import { useRuntimeConfig } from 'nitropack/runtime'

import { useLogger } from '#layer/server/utils/logger'

const DEFAULT_BINDING = 'BUCKET'
const DEFAULT_PREFIXES = [
  { prefix: 'uploads/', cacheControl: 'public, max-age=31536000, immutable' },
]

/** Extension to type, allow-listed rasters only: an extension never yields SVG. */
const EXTENSION_TYPES = {
  avif: 'image/avif',
  gif: 'image/gif',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
}

function imageConfig(event) {
  const config = useRuntimeConfig(event)?.nardukUploads ?? {}
  const prefixes = Array.isArray(config.imagePrefixes) ? config.imagePrefixes : []
  return {
    binding: config.imagesBinding || DEFAULT_BINDING,
    prefixes: prefixes.length > 0 ? prefixes : DEFAULT_PREFIXES,
  }
}

function contentTypeFor(slug, storedContentType, typeFromExtension) {
  if (typeFromExtension) {
    const extension = slug.slice(slug.lastIndexOf('.') + 1).toLowerCase()
    const byExtension = EXTENSION_TYPES[extension]
    if (byExtension) return byExtension
  }
  return storedContentType
}

function etagMatches(header, etag) {
  return !!header && !!etag && header.split(',').some((tag) => tag.trim() === etag)
}

export default defineEventHandler(async (event) => {
  const log = useLogger(event).child('Images')
  const slug = getRouterParam(event, 'slug')
  if (!slug) {
    throw createError({ statusCode: 400, message: 'Missing image path' })
  }
  const { binding, prefixes } = imageConfig(event)
  const served = prefixes.find((entry) => slug.startsWith(entry.prefix))
  if (!served) {
    log.warn('Blocked image key outside the served prefixes', { slug })
    throw createError({ statusCode: 404, message: 'Image not found' })
  }

  const isHead = event.method === 'HEAD'
  const r2 = useR2(event, binding)
  let object
  try {
    object = isHead ? await r2.head(slug) : await r2.get(slug)
  } catch (error) {
    log.error('Image storage read failed', { slug, error })
    // The cause is logged above; the response names no storage detail.
    throw createError({ statusCode: 500, message: 'Error retrieving image' })
  }

  if (!object) {
    log.warn('Image not found', { slug })
    throw createError({ statusCode: 404, message: 'Image not found' })
  }

  const storedContentType = object.httpMetadata?.contentType
  const candidate = contentTypeFor(slug, storedContentType, served.typeFromExtension === true)
  if (!isAllowedUploadContentType(candidate)) {
    log.warn('Blocked unsupported uploaded image type', { slug, contentType: storedContentType })
    throw createError({ statusCode: 415, message: 'Unsupported image type' })
  }

  const contentType = normalizeUploadContentType(candidate)
  const headers = {
    'Content-Type': contentType,
    'Content-Disposition': 'inline',
    'Cache-Control': served.cacheControl,
    'X-Content-Type-Options': 'nosniff',
    ETag: object.httpEtag,
  }
  // A 304 carries the validators and cache policy but no body, so no length.
  if (etagMatches(getRequestHeader(event, 'if-none-match'), object.httpEtag)) {
    setResponseHeaders(event, headers)
    setResponseStatus(event, 304)
    return null
  }
  if (typeof object.size === 'number') headers['Content-Length'] = String(object.size)
  setResponseHeaders(event, headers)

  log.debug('Image served', { slug, contentType })
  return isHead ? null : object.body
})
