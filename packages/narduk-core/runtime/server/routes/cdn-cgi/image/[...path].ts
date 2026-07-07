/**
 * Local-dev fallback for NuxtImg cloudflare provider.
 *
 * In production, Cloudflare handles `/cdn-cgi/image/<modifiers>/<path>`
 * natively. During local development there is no Cloudflare proxy, so
 * this route strips the modifiers and redirects to the underlying path.
 *
 * Only allows redirects to `/_og/` paths to prevent open-redirect abuse.
 */
import { createError, defineEventHandler, getRequestURL, getRouterParam, sendRedirect } from 'h3'

import { useLogger } from '../../../utils/logger'

export default defineEventHandler(async (event) => {
  const log = useLogger(event).child('Images')
  const rawPath = getRouterParam(event, 'path') ?? ''

  const segments = rawPath.split('/').filter(Boolean)
  if (segments.length < 2) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid Cloudflare image path' })
  }

  const [, ...rest] = segments
  const targetPath = `/${rest.join('/')}`

  if (!targetPath.startsWith('/_og/')) {
    throw createError({ statusCode: 404, statusMessage: 'Unsupported image source path' })
  }

  const requestUrl = getRequestURL(event)
  const forwarded = new URL(targetPath, 'http://localhost')
  for (const [key, value] of requestUrl.searchParams.entries()) {
    forwarded.searchParams.set(key, value)
  }

  log.debug('CDN image redirect', { targetPath })
  return sendRedirect(event, `${forwarded.pathname}${forwarded.search}`, 302)
})
