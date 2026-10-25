/**
 * Opt-in edge cache for anonymous public HTML (`nardukCore.htmlCache`).
 *
 * A crawler sweep over server-rendered pages pays a full SSR render per hit
 * (austin-texas-net, 2026-10-25: about 128 ms of Worker CPU a render; PerplexityBot
 * 185k requests on 10-14, AionBot about 43k a day). The `html-cache` Nitro plugin
 * serves such a request from `caches.default` in `render:before` and stores the
 * 200 render for `ttlSeconds`.
 *
 * It works under a nonce CSP too (D-HTML-CACHE-PUBLIC-1, Logan 2026-10-25, which
 * amends the 2026-09-18 "Refuse HTML caching on nonce apps", narduk-libs#435): only
 * anonymous requests (no Cookie, no Authorization) are served or stored, so no
 * session exists to take, and the page is stored with the nonce it was rendered
 * with, so the HTML and its CSP header still agree. Sign-in ends in a full page
 * load (narduk-auth), so no script from a cached page survives into a session.
 *
 * Framework-free: the module reads it at build time and the plugin at request time.
 */
export const DEFAULT_HTML_CACHE_TTL_SECONDS = 600

/** `nardukCore.htmlCache`. */
export interface HtmlCacheOptions {
  /**
   * Path patterns to cache. An exact path (`/food`), `*` for one segment
   * (`/places/*`), and a trailing `/**` for the path and everything under it.
   * Query strings are never cached: a request with one always renders.
   */
  routes: string[]
  /** Seconds a stored render is served. Default 600. */
  ttlSeconds?: number
}

export interface ResolvedHtmlCache {
  routes: string[]
  ttlSeconds: number
}

const PATTERN_CHARS = /^\/[\w\-./*~%@:]*$/u

function toRegExp(pattern: string): RegExp {
  if (!PATTERN_CHARS.test(pattern) || pattern.includes('***')) {
    throw new TypeError(
      `[narduk-core] nardukCore.htmlCache.routes entry ${JSON.stringify(pattern)} is not a path pattern.`,
    )
  }
  let source = ''
  const segments = pattern.split('/').slice(1)
  for (const [index, segment] of segments.entries()) {
    if (segment === '**') {
      if (index !== segments.length - 1) {
        throw new TypeError(
          `[narduk-core] nardukCore.htmlCache.routes entry ${JSON.stringify(pattern)}: ** is only allowed as the last segment.`,
        )
      }
      source += '(?:/.*)?'
      continue
    }
    const escaped = segment.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/gu, '\\$&'))
    source += `/${escaped.join('[^/]+')}`
  }
  return new RegExp(`^${source === '' ? '/' : source}$`, 'u')
}

/**
 * Normalise the option (or its runtime-config copy). `undefined`, `null` and
 * `false` mean off and return null; a wrong shape throws.
 */
export function resolveHtmlCacheOptions(input?: unknown): ResolvedHtmlCache | null {
  if (input === undefined || input === null || input === false) return null
  if (typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('[narduk-core] nardukCore.htmlCache must be an options object.')
  }
  const options = input as Record<string, unknown>
  const { routes, ttlSeconds } = options
  if (
    !Array.isArray(routes) ||
    routes.length === 0 ||
    routes.some((entry) => typeof entry !== 'string')
  ) {
    throw new TypeError(
      '[narduk-core] nardukCore.htmlCache.routes must be a non-empty array of path patterns.',
    )
  }
  for (const route of routes as string[]) toRegExp(route)
  if (
    ttlSeconds !== undefined &&
    (typeof ttlSeconds !== 'number' || !Number.isInteger(ttlSeconds) || ttlSeconds < 1)
  ) {
    throw new TypeError('[narduk-core] nardukCore.htmlCache.ttlSeconds must be a positive integer.')
  }
  return {
    routes: [...(routes as string[])],
    ttlSeconds: (ttlSeconds as number | undefined) ?? DEFAULT_HTML_CACHE_TTL_SECONDS,
  }
}

/** Compile the route patterns into one matcher over a pathname. */
export function createHtmlCacheMatcher(routes: readonly string[]): (path: string) => boolean {
  const patterns = routes.map(toRegExp)
  return (path) => patterns.some((pattern) => pattern.test(path))
}

export interface HtmlCacheRequest {
  headers: Headers
  host: string
  method: string
  path: string
}

/** The cache key for an anonymous GET of a cacheable page, or null when the request must render. */
export function htmlCacheKey(
  request: HtmlCacheRequest,
  buildId: string,
  matches: (path: string) => boolean,
): string | null {
  if (request.method !== 'GET' || request.path.includes('?')) return null
  if (request.headers.has('cookie') || request.headers.has('authorization')) return null
  if (!matches(request.path)) return null
  return `https://${request.host}/__narduk/html-cache/${encodeURIComponent(buildId)}${request.path}`
}

const META_TAG = /<meta\b[^>]*>/giu

/**
 * A render the cache may keep for everyone: no `noindex` robots meta. The robots
 * module renders `noindex` for some User-Agents, and that variant must not be
 * replayed to a search engine.
 */
export function isStorableHtml(html: string): boolean {
  return !(html.match(META_TAG) ?? []).some(
    (tag) => /\bname=["']?robots\b/iu.test(tag) && /\bnoindex\b/iu.test(tag),
  )
}
