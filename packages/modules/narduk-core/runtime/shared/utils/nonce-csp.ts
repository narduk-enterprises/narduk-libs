/**
 * Nonce-CSP HTML is never shared-cache storable (narduk-libs#435).
 *
 * With `nardukCore.security.headers` on, nuxt-security mints one nonce per
 * request (`40-cspSsrNonce`), stamps it on every `<script>` in the SSR HTML,
 * and writes the same value into the CSP header (`50-updateCsp`). A shared
 * cache that stores that response hands one visitor's nonce to everyone inside
 * the TTL, which is exactly what a nonce exists to prevent. Logan chose
 * (askme 2026-09-18): "1: Refuse HTML caching on nonce apps (Recommended)".
 *
 * The flag below is set by the `nonce-csp-cache` Nitro plugin in
 * `render:before`, which only Nitro's render handler fires — so an API route
 * is never marked and its JSON (which carries no nonce) stays edge-cacheable.
 * `setCacheProfile` reads the flag to refuse a cacheable profile at call time,
 * and the plugin re-checks the final `content-type` in `render:response` as
 * the backstop.
 *
 * Framework-free like `shared-cache.ts`: the plugin, `cacheProfile.ts` and a
 * plain unit test all import it without booting h3 or Nitro.
 */

/** Set on `event.context` when this request is an SSR render under a nonce CSP. */
export const NONCE_CSP_HTML_CONTEXT_KEY = '~nardukNonceCspHtml'

/**
 * Set on `event.context` when a nonce-CSP render asked `setCacheProfile` for a
 * cacheable profile that was refused, so development can explain why.
 */
export const NONCE_CSP_CACHE_REQUESTED_CONTEXT_KEY = '~nardukNonceCspCacheRequested'

interface ContextEvent {
  context?: Record<string, unknown>
}

/**
 * Whether the resolved `nardukSecurityHeaders.mode` makes nuxt-security mint
 * a nonce. Both on-modes do: `buildNuxtSecurityConfig` sets `nonce: true` for
 * `report-only` as well as `enforce`, and nuxt-security 2.6's nonce plugins
 * have no report-only branch — only the header name changes.
 */
export function isNonceCspMode(mode: unknown): boolean {
  return mode === 'enforce' || mode === 'report-only'
}

/** Whether nuxt-security already minted a nonce onto this request. */
export function hasMintedNonce(event: ContextEvent | null | undefined): boolean {
  const security = event?.context?.security as { nonce?: unknown } | undefined
  return typeof security?.nonce === 'string' && security.nonce.length > 0
}

/**
 * Nuxt's payload-extraction requests (`/<route>/_payload.json`, or `.js`) go
 * through the same render handler but return the payload without any HTML or
 * nonce, so they must stay cacheable.
 */
const NUXT_PAYLOAD_PATH_RE = /\/_payload\.(?:json|js)(?:\?.*)?$/

export function isNuxtPayloadPath(path: unknown): boolean {
  return typeof path === 'string' && NUXT_PAYLOAD_PATH_RE.test(path)
}

export function isHtmlContentType(value: unknown): boolean {
  const text = Array.isArray(value) ? value.join(',') : typeof value === 'string' ? value : ''
  return /^\s*text\/html\b/i.test(text)
}

export function markNonceCspHtml(event: ContextEvent | null | undefined): void {
  if (!event) return
  event.context ??= {}
  event.context[NONCE_CSP_HTML_CONTEXT_KEY] = true
}

export function isNonceCspHtml(event: ContextEvent | null | undefined): boolean {
  return event?.context?.[NONCE_CSP_HTML_CONTEXT_KEY] === true
}

export function markNonceCspCacheRequested(event: ContextEvent | null | undefined): void {
  if (!event) return
  event.context ??= {}
  event.context[NONCE_CSP_CACHE_REQUESTED_CONTEXT_KEY] = true
}

export function wasNonceCspCacheRequested(event: ContextEvent | null | undefined): boolean {
  return event?.context?.[NONCE_CSP_CACHE_REQUESTED_CONTEXT_KEY] === true
}
