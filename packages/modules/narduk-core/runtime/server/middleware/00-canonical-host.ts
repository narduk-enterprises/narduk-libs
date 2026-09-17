import {
  appendResponseHeader,
  defineEventHandler,
  getRequestHeader,
  getRequestURL,
  sendRedirect,
  setResponseHeader,
} from 'h3'
import { useRuntimeConfig } from 'nitropack/runtime'

import { readRuntimeBoolean, readRuntimeString } from '../utils/runtime-env'

import type { H3Event } from 'h3'

function isLocalHost(hostname: string) {
  return hostname.startsWith('localhost') || hostname.startsWith('127.0.0.1')
}

/**
 * Paths a browser only ever requests as a sub-resource: the app's own API and
 * the framework-internal trees (`/_nuxt`, `/__nuxt*`, `/_ipx`, `/_payload.json`).
 * Consulted only when a request carries no fetch metadata at all.
 */
function isSubresourceOnlyPath(pathname: string) {
  return pathname === '/api' || pathname.startsWith('/api/') || pathname.startsWith('/_')
}

/**
 * A canonical-host redirect is for top-level document navigations: that is where
 * canonicalisation buys SEO, bookmarks and an auth cookie set on the right host.
 * Redirecting a `fetch()` or a sub-resource to another origin can only ever end
 * in a CORS failure -- the 308 response carries no `Access-Control-Allow-Origin`
 * -- while the canonical host still runs the handler, so the route's cost (an
 * Apple MapKit token mint and a rate-limit slot, in the case that found this) is
 * paid for a response the browser then throws away. narduk-libs#408.
 *
 * `Sec-Fetch-Dest` is the signal, measured in Chromium 1243: `document` for a
 * top-level navigation, `empty` for a same-origin `fetch()`, `script`/`image`/...
 * for sub-resources. A request with no fetch metadata at all (curl, a crawler,
 * pre-16.4 Safari, server-to-server) keeps today's behaviour on page paths so
 * canonicalisation still reaches crawlers, and is never redirected on the
 * API and framework-internal paths that only a sub-resource request asks for.
 */
function isDocumentNavigation(event: H3Event) {
  const destination = getRequestHeader(event, 'sec-fetch-dest')?.trim().toLowerCase()
  if (destination) return destination === 'document'

  return !isSubresourceOnlyPath(getRequestURL(event).pathname)
}

export default defineEventHandler((event) => {
  if (event.method !== 'GET' && event.method !== 'HEAD') {
    return
  }

  if (!isDocumentNavigation(event)) {
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

  // 308 is cacheable by default; this response varies by Sec-Fetch-Dest.
  appendResponseHeader(event, 'Vary', 'Sec-Fetch-Dest')
  setResponseHeader(event, 'Cache-Control', 'private, no-store')

  return sendRedirect(event, redirectUrl.toString(), 308)
})
