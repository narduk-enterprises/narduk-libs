/**
 * Response-header rules shared by the `h3` and `worker` adapters.
 *
 * Both adapters stamp per-request correlation and timing onto an outgoing response, and both have
 * to answer the same two questions: may this response carry a value that belongs to exactly one
 * request, and what happens to a `Server-Timing` an upstream already set?
 */

/** Directives that hand a response to a cache shared between users. */
const SHARED_CACHE_DIRECTIVE = /(?:^|,)\s*(?:public|s-maxage|immutable)\b/i
/** `private` and `no-store` keep a response in one user's browser, or out of caches entirely. */
const PRIVATE_DIRECTIVE = /(?:^|,)\s*(?:private|no-store)\b/i

/**
 * True when `cache-control` lets a shared cache (Cloudflare's edge, a CDN, a proxy) store this
 * response and replay it to other clients.
 *
 * A per-request `x-request-id` or `Server-Timing` must not be stamped onto such a response:
 * whichever request happened to miss the cache would have its correlation ID served to every
 * later client, so a log search for that ID returns one request while the header claims many.
 * `private`/`no-store` win when both appear — they already exclude the shared cache.
 */
export function isSharedCacheable(cacheControl?: string | null): boolean {
  if (!cacheControl) return false
  if (PRIVATE_DIRECTIVE.test(cacheControl)) return false
  return SHARED_CACHE_DIRECTIVE.test(cacheControl)
}

/**
 * Appends this request's timing to whatever `Server-Timing` is already on the response instead of
 * replacing it, so an upstream `fetch` or CDN metric (`cf-cache;dur=3`) survives.
 */
export function mergeServerTiming(existing: string | null | undefined, addition: string): string {
  const current = existing?.trim()
  return current ? `${current}, ${addition}` : addition
}
