import { defineEventHandler, getRequestHeader, getRequestURL, sendRedirect } from 'h3'
import { useRuntimeConfig } from 'nitropack/runtime'

import { readRuntimeBoolean, readRuntimeString } from '../utils/runtime-env'

function isLocalHost(hostname: string) {
  return hostname.startsWith('localhost') || hostname.startsWith('127.0.0.1')
}

export default defineEventHandler((event) => {
  if (event.method !== 'GET' && event.method !== 'HEAD') {
    return
  }

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
  if (!enforceCanonicalHost) {
    return
  }

  const appUrl = readRuntimeString(event, 'SITE_URL', { config, fallback: config.public.appUrl })
  if (!appUrl) {
    return
  }

  let canonicalUrl: URL
  try {
    canonicalUrl = new URL(appUrl)
  } catch {
    return
  }

  if (canonicalUrl.protocol !== 'https:' || isLocalHost(canonicalUrl.hostname)) {
    return
  }

  // Use only the `host` header. On Cloudflare Workers the `host` header is set
  // by the edge to the actual requested hostname and is not client-spoofable.
  // Trusting `x-forwarded-host` first would let a client bypass this redirect
  // by sending `X-Forwarded-Host: <canonical-host>` while accessing a
  // non-canonical URL.
  const requestHostHeader = getRequestHeader(event, 'host') ?? ''
  const requestHost = requestHostHeader.split(',')[0]?.trim().toLowerCase()
  const canonicalHost = canonicalUrl.host.toLowerCase()
  if (!requestHost) {
    return
  }

  const requestUrl = getRequestURL(event)
  if (requestHost === canonicalHost && requestUrl.protocol === canonicalUrl.protocol) {
    return
  }

  const redirectUrl = new URL(
    `${requestUrl.pathname}${requestUrl.search}${requestUrl.hash}`,
    canonicalUrl,
  )

  return sendRedirect(event, redirectUrl.toString(), 308)
})
