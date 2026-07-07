/**
 * Canonical Redirect Middleware — redirects non-canonical URLs to the canonical domain.
 *
 * Uses the `SITE_URL` from runtime config to determine the canonical origin.
 * Redirects www. prefixed requests and HTTP→HTTPS upgrades.
 *
 * Only active in production when canonical host enforcement is enabled.
 */
import { defineEventHandler, getRequestURL, sendRedirect } from 'h3'
import { useRuntimeConfig } from 'nitropack/runtime'

import { useLogger } from '../utils/logger'
import { readRuntimeBoolean, readRuntimeString } from '../utils/runtime-env'

function isLocalhost(hostname: string) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
}

export function resolveCanonicalOrigin(
  event: Parameters<typeof readRuntimeString>[0],
  config: ReturnType<typeof useRuntimeConfig>,
) {
  const siteUrl = readRuntimeString(event, 'SITE_URL', { config, fallback: config.public.appUrl })
  if (!siteUrl) return null

  try {
    const canonicalOrigin = new URL(siteUrl)
    return isLocalhost(canonicalOrigin.hostname) ? null : canonicalOrigin
  } catch {
    return null
  }
}

export default defineEventHandler((event) => {
  // Skip in development
  if (import.meta.dev) return

  const config = useRuntimeConfig(event)
  const publicConfig = config.public as Record<string, unknown>
  const enforceCanonicalHost =
    readRuntimeBoolean(event, 'ENFORCE_CANONICAL_HOST', {
      config,
      fallback: publicConfig.enforceCanonicalHost,
    }) ||
    readRuntimeBoolean(event, 'AUTH_ENFORCE_CANONICAL_HOST', {
      config,
      fallback: publicConfig.authEnforceCanonicalHost,
    })
  if (!enforceCanonicalHost) return

  const canonicalOrigin = resolveCanonicalOrigin(event, config)
  if (!canonicalOrigin) return

  const requestUrl = getRequestURL(event)

  // Check if the request host matches the canonical host
  if (requestUrl.host !== canonicalOrigin.host) {
    const log = useLogger(event).child('Redirect')
    const redirectUrl = new URL(requestUrl.pathname + requestUrl.search, canonicalOrigin)
    log.debug('Canonical redirect', { from: requestUrl.host, to: canonicalOrigin.host })
    return sendRedirect(event, redirectUrl.toString(), 301)
  }
})
