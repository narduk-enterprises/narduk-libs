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
