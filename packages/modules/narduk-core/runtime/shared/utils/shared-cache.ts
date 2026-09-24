/**
 * The one place a response gets pinned `private, no-store` for a shared
 * (CDN/edge) cache — narduk-libs#386 (preference-shaped responses) and
 * narduk-libs#429 (thrown 4xx/5xx/429 responses) both call through here so the
 * header-strip list cannot drift between the two call sites.
 *
 * Cloudflare honours `CDN-Cache-Control` / `Cloudflare-CDN-Cache-Control` over
 * `Cache-Control`, so rewriting only the latter still stores the body at the
 * edge. Every helper below strips the full shared-cache header set before
 * writing `Cache-Control: private, no-store`.
 *
 * Framework-free on purpose: the preferences cookie codec, the Nitro
 * `preferences-cache` plugin, the Nitro `error-cache` plugin, and a plain unit
 * test all import this module, and none of them should have to boot h3 or
 * Nitro to do it.
 */

/**
 * Shared-cache headers a no-store response must not leave in place.
 * Cloudflare honours `CDN-Cache-Control` / `Cloudflare-CDN-Cache-Control`
 * over `Cache-Control`, so rewriting only the latter still stores the body.
 */
export const SHARED_CACHE_HEADER_NAMES = [
  'cache-control',
  'cdn-cache-control',
  'cloudflare-cdn-cache-control',
  'surrogate-control',
  'cache-tag',
  'expires',
  'age',
] as const

const SHARED_CACHE_HEADER_NAME_SET = new Set<string>(SHARED_CACHE_HEADER_NAMES)

/** The one value this module ever writes to `Cache-Control`. */
const NO_STORE_CACHE_CONTROL = 'private, no-store'

/** The minimal shape of an H3 event this module touches, so it imports no h3. */
export interface CacheAwareEvent {
  context?: Record<string, unknown>
}

/** The Node response surface this module duck-types, so it imports no h3. */
interface NodeResponseLike {
  getHeaders?: () => Record<string, unknown>
  headersSent?: boolean
  removeHeader?: (name: string) => void
  setHeader?: (name: string, value: number | string | readonly string[]) => void
  writableEnded?: boolean
}

/**
 * Append `tokens` onto an existing `Vary` value, case-insensitively and
 * without duplicating them. `*` is left alone: it already varies on everything.
 */
export function appendVaryTokens(
  existing: string | null | undefined,
  tokens: readonly string[],
): string {
  const names = (existing ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean)
  if (names.includes('*')) return '*'
  const seen = new Set(names.map((name) => name.toLowerCase()))
  const out = [...names]
  for (const token of tokens) {
    if (seen.has(token.toLowerCase())) continue
    seen.add(token.toLowerCase())
    out.push(token)
  }
  return out.join(', ')
}

function headerValue(
  value: string | number | Array<string | number> | undefined,
): string | undefined {
  if (value === undefined) return undefined
  return Array.isArray(value) ? value.map(String).join(', ') : String(value)
}

/**
 * Rewrite a header map so a response cannot be stored in a shared cache:
 * `private, no-store`, no CDN/surrogate/tag headers, and — when `varyTokens`
 * is non-empty — those tokens merged into `Vary`. An empty (default)
 * `varyTokens` leaves whatever `Vary` survived the strip untouched.
 */
export function applyNoStoreHeaders(
  headers: Record<string, string | number | Array<string | number> | undefined>,
  varyTokens: readonly string[] = [],
): Record<string, string> {
  const kept: Record<string, string> = {}
  let vary: string | undefined

  for (const [name, value] of Object.entries(headers)) {
    const lowered = name.toLowerCase()
    if (SHARED_CACHE_HEADER_NAME_SET.has(lowered)) continue
    if (lowered === 'vary') {
      const text = headerValue(value) ?? ''
      vary = vary === undefined ? text : `${vary}, ${text}`
      continue
    }
    const text = headerValue(value)
    if (text !== undefined) kept[name] = text
  }

  const mergedVary = varyTokens.length > 0 ? appendVaryTokens(vary, varyTokens) : vary
  return mergedVary
    ? { ...kept, 'cache-control': NO_STORE_CACHE_CONTROL, vary: mergedVary }
    : { ...kept, 'cache-control': NO_STORE_CACHE_CONTROL }
}

function nodeResponseOf(event: CacheAwareEvent): NodeResponseLike | undefined {
  const node = (event as { node?: { res?: NodeResponseLike } }).node
  return node?.res
}

/**
 * Apply {@link applyNoStoreHeaders} to an event's Node response, if one is
 * present. No-op on the client and on a plain `{ context }` test double.
 *
 * Node throws `ERR_HTTP_HEADERS_SENT` from `setHeader` once the response has
 * started, so a late call — an async component resolving after a streamed SSR
 * document began, a util calling in after `send()` — must not take the page
 * down. It is already too late to protect that response.
 */
export function applyNoStoreToEvent(
  event: CacheAwareEvent | null | undefined,
  varyTokens: readonly string[] = [],
): void {
  if (!event) return
  const res = nodeResponseOf(event)
  if (!res?.setHeader || !res.removeHeader) return
  if (res.headersSent === true || res.writableEnded === true) return

  const current = res.getHeaders?.() ?? {}
  const flattened: Record<string, string> = {}
  for (const [name, value] of Object.entries(current)) {
    const text = headerValue(value as string | number | Array<string | number> | undefined)
    if (text !== undefined) flattened[name] = text
  }
  const next = applyNoStoreHeaders(flattened, varyTokens)
  for (const name of SHARED_CACHE_HEADER_NAMES) {
    res.removeHeader(name)
  }
  res.setHeader('Cache-Control', next['cache-control'] ?? NO_STORE_CACHE_CONTROL)
  if (next.vary) res.setHeader('Vary', next.vary)
}

/** Statuses the Fetch spec forbids a body on, so a rebuilt response must pass `null`. */
const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304])

export function isWebResponseLike(value: unknown): value is Response {
  if (!value || typeof value !== 'object') return false
  const headers = (value as { headers?: unknown }).headers
  if (!headers || typeof headers !== 'object') return false
  const candidate = headers as { delete?: unknown; get?: unknown; set?: unknown }
  return (
    typeof candidate.get === 'function' &&
    typeof candidate.set === 'function' &&
    typeof candidate.delete === 'function' &&
    typeof (value as { status?: unknown }).status === 'number'
  )
}

/**
 * Strip the shared-cache headers off a web `Response` a handler returned.
 *
 * h3 runs `onBeforeResponse` **before** `handleHandlerResponse`, so a returned
 * `Response` copies its own headers onto `event.node.res` after every strip
 * this module does. Without this, the documented shape — `return new
 * Response(body, { headers })` — ships `CDN-Cache-Control` intact and
 * Cloudflare stores it.
 *
 * Headers from a `fetch()` response are immutable, so an in-place edit that
 * throws falls back to rebuilding the response around the same body.
 */
export function applyNoStoreToWebResponse(
  response: unknown,
  varyTokens: readonly string[] = [],
): Response | undefined {
  if (!isWebResponseLike(response)) return undefined
  const vary =
    varyTokens.length > 0 ? appendVaryTokens(response.headers.get('vary'), varyTokens) : undefined

  try {
    for (const name of SHARED_CACHE_HEADER_NAMES) response.headers.delete(name)
    response.headers.set('Cache-Control', NO_STORE_CACHE_CONTROL)
    if (vary) response.headers.set('Vary', vary)
    return response
  } catch {
    const headers = new Headers(response.headers)
    for (const name of SHARED_CACHE_HEADER_NAMES) headers.delete(name)
    headers.set('Cache-Control', NO_STORE_CACHE_CONTROL)
    if (vary) headers.set('Vary', vary)
    return new Response(NULL_BODY_STATUSES.has(response.status) ? null : response.body, {
      headers,
      status: response.status,
      statusText: response.statusText,
    })
  }
}

/**
 * Headers that belong to exactly one request or one caller, and so must not
 * ride on a response a shared cache may store and replay to everyone else
 * (narduk-libs#412, #418): the `RateLimit-*` quota family — both the draft-11
 * pair and the widely deployed triad — the request's correlation id, and its
 * timing. `Retry-After` joins them on a success; on a denial it is the
 * response's meaning, and a denial is `no-store` anyway.
 */
export const PER_REQUEST_HEADER_NAMES = [
  'ratelimit',
  'ratelimit-policy',
  'ratelimit-limit',
  'ratelimit-remaining',
  'ratelimit-reset',
  'x-request-id',
  'server-timing',
] as const

const RETRY_AFTER = 'retry-after'

const PRIVATE_OR_NO_STORE = /(?:^|,)\s*(?:private|no-store)\b/i
const SHARED_DIRECTIVE = /(?:^|,)\s*(?:public|s-maxage=\d+|immutable|max-age=0*[1-9]\d*)\b/i

/**
 * True when a shared cache (Cloudflare's edge, a CDN, a proxy) may store this
 * response as its headers stand. `read` returns one response header by its
 * lower-case name.
 *
 * `private` / `no-store` in `Cache-Control` rule it out whatever else says —
 * `setCacheProfile` never pairs them with an edge directive. Otherwise an edge
 * directive (`CDN-Cache-Control`, `Cloudflare-CDN-Cache-Control`) that is not
 * itself `no-store`/`private` makes it shared-cacheable, and so does a
 * `Cache-Control` that is `public`, `immutable`, or carries a positive
 * `max-age` / `s-maxage` (RFC 9111 lets a shared cache store those).
 */
export function isSharedCacheable(read: (name: string) => string | undefined): boolean {
  const cacheControl = read('cache-control')
  if (cacheControl && PRIVATE_OR_NO_STORE.test(cacheControl)) return false
  for (const name of ['cdn-cache-control', 'cloudflare-cdn-cache-control']) {
    const value = read(name)
    if (value && !PRIVATE_OR_NO_STORE.test(value)) return true
  }
  return Boolean(cacheControl && SHARED_DIRECTIVE.test(cacheControl))
}

/** Read a header off an event's Node response, joined, lower-case name. */
function nodeHeader(res: NodeResponseLike, name: string): string | undefined {
  const value = res.getHeaders?.()[name]
  return headerValue(value as string | number | Array<string | number> | undefined)
}

/**
 * Remove the {@link PER_REQUEST_HEADER_NAMES} (and `Retry-After`) from an
 * event's Node response. Unconditional: callers decide shared-cacheability.
 * No-op once headers are sent, for the reason {@link applyNoStoreToEvent}
 * gives.
 */
export function stripPerRequestHeadersFromEvent(event: CacheAwareEvent | null | undefined): void {
  if (!event) return
  const res = nodeResponseOf(event)
  if (!res?.removeHeader) return
  if (res.headersSent === true || res.writableEnded === true) return
  for (const name of PER_REQUEST_HEADER_NAMES) res.removeHeader(name)
  res.removeHeader(RETRY_AFTER)
}

/**
 * Strip per-request headers from an event whose response is shared-cacheable
 * and not an error. Returns whether it stripped.
 */
export function stripPerRequestHeadersIfShared(
  event: CacheAwareEvent | null | undefined,
  status: number,
): boolean {
  if (!event || status >= 400) return false
  const res = nodeResponseOf(event)
  if (!res?.getHeaders) return false
  if (!isSharedCacheable((name) => nodeHeader(res, name))) return false
  stripPerRequestHeadersFromEvent(event)
  return true
}

/**
 * The same strip for a web `Response` a handler returned, which h3 copies onto
 * the event only *after* `beforeResponse` (see
 * {@link applyNoStoreToWebResponse}). Returns the response to send — the same
 * object, or a rebuilt one when its headers were immutable — or undefined when
 * `response` is not a web `Response` or needed nothing.
 */
export function stripPerRequestHeadersFromWebResponse(response: unknown): Response | undefined {
  if (!isWebResponseLike(response)) return undefined
  if (response.status >= 400) return undefined
  if (!isSharedCacheable((name) => response.headers.get(name) ?? undefined)) return undefined
  const names = [...PER_REQUEST_HEADER_NAMES, RETRY_AFTER]
  try {
    for (const name of names) response.headers.delete(name)
    return response
  } catch {
    const headers = new Headers(response.headers)
    for (const name of names) headers.delete(name)
    return new Response(NULL_BODY_STATUSES.has(response.status) ? null : response.body, {
      headers,
      status: response.status,
      statusText: response.statusText,
    })
  }
}
