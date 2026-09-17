/**
 * R2 image serving route.
 *
 * Public `/images/**` is first-party origin. Serve only objects whose stored
 * content type is in the same `ALLOWED_TYPES` allow-list as POST /api/upload.
 * `X-Content-Type-Options: nosniff` does not stop a declared `text/html` or
 * `application/javascript` object from executing; a deny-list (SVG only) is
 * not enough.
 */
import { useR2 } from '@narduk-enterprises/narduk-uploads/runtime/server/utils/r2'
import {
  isAllowedUploadContentType,
  normalizeUploadContentType,
} from '@narduk-enterprises/narduk-uploads/runtime/server/utils/upload'
import { createError, defineEventHandler, getRouterParam, setResponseHeaders } from 'h3'

import { useLogger } from '#layer/server/utils/logger'

function isPublicUploadKey(slug) {
  return slug.startsWith('uploads/')
}

export default defineEventHandler(async (event) => {
  const log = useLogger(event).child('Images')
  const slug = getRouterParam(event, 'slug')
  if (!slug) {
    throw createError({ statusCode: 400, message: 'Missing image path' })
  }
  if (!isPublicUploadKey(slug)) {
    log.warn('Blocked non-upload image key', { slug })
    throw createError({ statusCode: 404, message: 'Image not found' })
  }

  const r2 = useR2(event)
  const object = await r2.get(slug)

  if (!object) {
    log.warn('Image not found', { slug })
    throw createError({ statusCode: 404, message: 'Image not found' })
  }

  const storedContentType = object.httpMetadata?.contentType
  if (!isAllowedUploadContentType(storedContentType)) {
    log.warn('Blocked unsupported uploaded image type', { slug, contentType: storedContentType })
    throw createError({ statusCode: 415, message: 'Unsupported image type' })
  }

  const contentType = normalizeUploadContentType(storedContentType)
  setResponseHeaders(event, {
    'Content-Type': contentType,
    'Content-Disposition': 'inline',
    'Cache-Control': 'public, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff',
    ETag: object.httpEtag,
  })

  log.debug('Image served', { slug, contentType })
  return object.body
})
