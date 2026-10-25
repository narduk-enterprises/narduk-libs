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
   * Query parameter names that are part of the cache key. Default none: a request
   * with any query string renders. A request with a parameter not listed here
   * also renders, so random query strings never add keys.
   */
  queryKeys?: string[]
  /**
   * Serve and store only when `event.context.robots.indexable === true`, the
   * flag @nuxtjs/robots sets on a request it will index. Default `true`; `false`
   * is for an app without the robots module.
   */
  requireIndexable?: boolean
  /**
   * Path patterns to cache. An exact path (`/food`), `*` for one segment
   * (`/places/*`), and a trailing `/**` for the path and everything under it.
   * Matched against the normalized path (dot segments resolved).
   */
  routes: string[]
  /**
   * Seconds a stored render is served. Default 600. A long, release-tied value is
   * fine: the key carries `app.buildId`, so a deploy never serves the old build's HTML.
   */
  ttlSeconds?: number
}

export interface ResolvedHtmlCache {
  queryKeys: string[]
  requireIndexable: boolean
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
  const { queryKeys, requireIndexable } = options
  if (
    queryKeys !== undefined &&
    (!Array.isArray(queryKeys) || queryKeys.some((key) => typeof key !== 'string' || key === ''))
  ) {
    throw new TypeError('[narduk-core] nardukCore.htmlCache.queryKeys must be an array of names.')
  }
  if (requireIndexable !== undefined && typeof requireIndexable !== 'boolean') {
    throw new TypeError('[narduk-core] nardukCore.htmlCache.requireIndexable must be a boolean.')
  }
  return {
    queryKeys: [...((queryKeys as string[] | undefined) ?? [])],
    requireIndexable: requireIndexable !== false,
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
  /** The raw request path, query string included. */
  path: string
}

const BASE = 'http://html-cache.invalid'

/** Decode escapes of unreserved characters and upper-case the rest, so `/%62` and `/b` share a key. */
function normalizeEscapes(path: string): string {
  return path.replaceAll(/%([\da-f]{2})/giu, (match, hex: string) => {
    const char = String.fromCharCode(Number.parseInt(hex, 16))
    return /^[\w.~-]$/u.test(char) ? char : `%${hex.toUpperCase()}`
  })
}

/**
 * The request path with dot segments resolved and percent-encoding normalized, and
 * its query reduced to the allowed keys (sorted). Null when it has a query key that
 * is not allowed or is not an absolute path, so `/a/../b` and `/b` share one key.
 */
export function normalizeHtmlCachePath(
  raw: string,
  queryKeys: readonly string[] = [],
): { path: string; query: string } | null {
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return null
  let url: URL
  try {
    url = new URL(raw, BASE)
  } catch {
    return null
  }
  if (url.origin !== BASE) return null
  const allowed = new Set(queryKeys)
  const pairs: Array<[string, string]> = []
  for (const [name, value] of url.searchParams) {
    if (!allowed.has(name)) return null
    pairs.push([name, value])
  }
  // By name only, stable: the order of a repeated name's values is part of the key.
  pairs.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  const query = pairs
    .map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(value)}`)
    .join('&')
  return { path: normalizeEscapes(url.pathname), query: query === '' ? '' : `?${query}` }
}

/**
 * Whether the raw request path is already its normalized form. The key is built from
 * the normalized path but Nuxt renders the raw one, so a request that normalizes to
 * something else (`/a/../b`, `/%62`) always renders and is never stored or served.
 */
export function isCanonicalHtmlCachePath(raw: string, queryKeys: readonly string[] = []): boolean {
  const normalized = normalizeHtmlCachePath(raw, queryKeys)
  return normalized !== null && (raw.split('?')[0] ?? raw) === normalized.path
}

/** The cache key for an anonymous GET of a cacheable page, or null when the request must render. */
export function htmlCacheKey(
  request: HtmlCacheRequest,
  buildId: string,
  matches: (path: string) => boolean,
  queryKeys: readonly string[] = [],
): string | null {
  if (request.method !== 'GET' || request.host === '') return null
  if (request.headers.has('cookie') || request.headers.has('authorization')) return null
  const normalized = normalizeHtmlCachePath(request.path, queryKeys)
  if (!normalized || !matches(normalized.path)) return null
  return `https://${request.host.toLowerCase()}/__narduk/html-cache/${encodeURIComponent(buildId)}${normalized.path}${normalized.query}`
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
