/**
 * R2 image serving route.
 */
import { useR2 } from '@narduk-enterprises/narduk-uploads/runtime/server/utils/r2'
import { createError, defineEventHandler, getRouterParam, setResponseHeaders } from 'h3'

import { useLogger } from '#layer/server/utils/logger'

function isSvgUpload(slug, contentType) {
  const normalizedContentType = contentType.toLowerCase().split(';', 1)[0]?.trim()
  const normalizedSlug = slug.toLowerCase()
  return (
    normalizedContentType === 'image/svg+xml' ||
    normalizedSlug.endsWith('.svg') ||
    normalizedSlug.endsWith('.svgz')
  )
}

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

  const contentType = object.httpMetadata?.contentType ?? 'application/octet-stream'
  if (isSvgUpload(slug, contentType)) {
    log.warn('Blocked uploaded SVG image response', { slug })
    throw createError({ statusCode: 415, message: 'Unsupported image type' })
  }

  setResponseHeaders(event, {
    'Content-Type': contentType,
    'Cache-Control': 'public, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff',
    ETag: object.httpEtag,
  })

  log.debug('Image served', { slug, contentType })
  return object.body
})
