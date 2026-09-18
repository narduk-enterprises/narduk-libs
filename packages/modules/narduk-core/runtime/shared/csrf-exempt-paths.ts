/**
 * App-declared CSRF exemptions (narduk-libs#239).
 *
 * The CSRF middleware refuses a state-changing request with no
 * `X-Requested-With`. A route that carries no ambient credential — a device
 * that calls before it has any account, session or cookie — gains nothing
 * from that check and cannot satisfy it, so an app declares the route here:
 *
 * ```ts
 * nardukCore: { csrf: { exemptPaths: ['/api/edge/v1/claim/start', '/api/devices/*'] } }
 * ```
 *
 * An entry is an exact path, or a prefix ending in `/*`. Declaring a route
 * that a signed-in browser also calls re-opens CSRF on it; that is the app's
 * responsibility, so the grammar keeps an entry as narrow as it can:
 *
 * - no query, fragment, percent escape, whitespace, empty or dot segment;
 * - `*` only as a whole final segment;
 * - no entry covering the whole site or the whole `/api` tree, and a prefix
 *   needs at least two segments before its `/*`.
 *
 * Dependency-free: the module validates at build time (a bad entry fails the
 * build) and the middleware re-validates at request time, so a
 * `NUXT_NARDUK_CSRF_EXEMPT_PATHS` runtime override can never widen past this
 * grammar.
 */

const FORBIDDEN_CHARACTERS = /[?#%\\\s]/
const TOO_BROAD_EXACT = new Set(['/', '/api'])
const MIN_PREFIX_SEGMENTS = 2

/** Why `entry` is not a valid exemption, or `null` when it is. */
export function csrfExemptPathError(entry: unknown): string | null {
  if (typeof entry !== 'string' || entry.length === 0) return 'must be a non-empty string'
  if (!entry.startsWith('/')) return 'must start with "/"'
  if (FORBIDDEN_CHARACTERS.test(entry)) {
    return 'must not contain a query, fragment, percent escape, backslash or whitespace'
  }

  const isPrefix = entry.endsWith('/*')
  const body = isPrefix ? entry.slice(0, -2) : entry
  if (body.includes('*')) return 'may use "*" only as a whole final segment ("/prefix/*")'

  const normalized = body.length > 1 && body.endsWith('/') ? body.slice(0, -1) : body
  const segments = normalized.split('/').slice(1)
  if (normalized !== '/' && segments.includes('')) {
    return 'must not contain an empty segment'
  }
  if (segments.some((segment) => segment === '.' || segment === '..')) {
    return 'must not contain a dot segment'
  }

  if (isPrefix) {
    if (normalized === '/' || segments.length < MIN_PREFIX_SEGMENTS || normalized === '/api') {
      return `a prefix must name at least ${MIN_PREFIX_SEGMENTS} segments, never the whole site or /api`
    }
  } else if (TOO_BROAD_EXACT.has(normalized)) {
    return 'must not exempt the whole site or the whole /api tree'
  }
  return null
}

/**
 * Build-time check: the entries of `value`, or an error naming every invalid
 * one. The module calls this so a bad entry fails the build instead of being
 * silently ignored at request time.
 */
export function assertCsrfExemptPaths(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new TypeError('[narduk-core] nardukCore.csrf.exemptPaths must be an array of paths.')
  }
  const invalid = value
    .map((entry: unknown) => ({ entry, error: csrfExemptPathError(entry) }))
    .filter(({ error }) => error !== null)
  if (invalid.length > 0) {
    throw new Error(
      '[narduk-core] nardukCore.csrf.exemptPaths has invalid entries: ' +
        invalid.map(({ entry, error }) => `${JSON.stringify(entry)} ${error}`).join('; '),
    )
  }
  return [...(value as string[])]
}

/** The valid entries of a runtime value; anything else exempts nothing. */
export function resolveCsrfExemptPaths(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter(
    (entry): entry is string => typeof entry === 'string' && csrfExemptPathError(entry) === null,
  )
}

/**
 * Whether the request path is covered by one of `entries`.
 *
 * The query string is ignored and one trailing slash is tolerated, because the
 * router dispatches both spellings to the same handler. A path containing a
 * percent escape, an empty segment or a dot segment is never exempt: the router
 * may resolve that spelling to a different route than the one declared, and
 * refusing it only costs a 403 on a spelling no device client sends.
 */
export function isCsrfExemptPath(path: string, entries: readonly string[]): boolean {
  if (entries.length === 0) return false
  const pathname = path.split('?')[0] ?? path
  if (pathname.includes('%') || pathname.includes('\\') || pathname.includes('//')) return false
  const segments = pathname.split('/')
  if (segments.some((segment) => segment === '.' || segment === '..')) return false

  const normalized =
    pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname
  return entries.some((entry) => {
    if (entry.endsWith('/*')) return normalized.startsWith(entry.slice(0, -1))
    return normalized === (entry.length > 1 && entry.endsWith('/') ? entry.slice(0, -1) : entry)
  })
}
