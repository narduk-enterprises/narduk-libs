/**
 * Route-pattern parsing shared by the build-time validator and the runtime
 * router, so an upgrade path can only ever mean one thing.
 *
 * The supported syntax is the h3/radix3 subset that an upgrade route can safely
 * use: literal segments and `:param`. Wildcards (`*`, `**`) are **rejected** --
 * an upgrade is a long-lived authenticated socket, and a pattern that matches
 * paths nobody enumerated is how one ends up reachable without a guard. Use one
 * entry per upgradeable route instead.
 */

/** A parsed path segment. */
export type UpgradePathSegment = { kind: 'static'; value: string } | { kind: 'param'; name: string }

/** A pattern that parsed, with the parameter names it declares. */
export interface UpgradePathParsed {
  ok: true
  segments: UpgradePathSegment[]
  params: string[]
}

/** A pattern that did not parse, and why. */
export interface UpgradePathRejected {
  ok: false
  reason: string
}

/**
 * Result of parsing a pattern.
 *
 * Spelled as two named arms rather than an inline union so that the two Prettier
 * versions in this workspace (3.8.3 in the package, 3.9.4 at the root) cannot
 * disagree about how to wrap it -- they do, for an inline union of this width.
 */
export type UpgradePathParse = UpgradePathParsed | UpgradePathRejected

/** A route parameter name. Same shape h3 accepts, and a JavaScript identifier. */
const PARAM_PATTERN = /^[A-Za-z_$][\w$]*$/u

/** Split a pathname into segments, tolerating one trailing slash. */
function segmentsOf(pathname: string): string[] {
  const trimmed = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname
  return trimmed.split('/').slice(1)
}

/**
 * Parse an upgrade route pattern.
 *
 * Never throws: the caller decides whether a bad pattern is a configuration
 * error (build time) or a programming error (runtime construction).
 */
export function parseUpgradePath(pattern: string): UpgradePathParse {
  if (typeof pattern !== 'string' || !pattern.startsWith('/')) {
    return { ok: false, reason: 'must be a path starting with "/", for example "/api/live/:id"' }
  }
  if (pattern === '/' || pattern === '//') {
    return { ok: false, reason: 'is the root path, which cannot carry an upgrade route' }
  }

  const segments: UpgradePathSegment[] = []
  const params: string[] = []

  for (const raw of segmentsOf(pattern)) {
    if (raw.length === 0) {
      return { ok: false, reason: 'has an empty path segment (a "//" or a bare trailing "/")' }
    }
    if (raw.includes('*')) {
      return {
        ok: false,
        reason:
          'uses a wildcard. An upgrade route is an authenticated socket, so it must name every path it answers: declare one entry per route instead',
      }
    }
    if (!raw.startsWith(':')) {
      segments.push({ kind: 'static', value: raw })
      continue
    }

    const name = raw.slice(1)
    if (!PARAM_PATTERN.test(name)) {
      return { ok: false, reason: `has the invalid route parameter ":${name}"` }
    }
    if (params.includes(name)) {
      return { ok: false, reason: `declares the route parameter ":${name}" twice` }
    }

    params.push(name)
    segments.push({ kind: 'param', name })
  }

  return { ok: true, segments, params }
}

/**
 * Match a request pathname against parsed segments.
 *
 * Returns the extracted parameters, or `undefined` when the path does not match.
 * A parameter is percent-decoded (as `getRouterParam` would) and must be
 * non-empty; an undecodable value does not match at all, so a malformed URL
 * falls through to the app rather than reaching a Durable Object name.
 */
export function matchUpgradePath(
  segments: readonly UpgradePathSegment[],
  pathname: string,
): Record<string, string> | undefined {
  const candidate = segmentsOf(pathname)
  if (candidate.length !== segments.length) return undefined

  const params: Record<string, string> = {}

  for (const [index, segment] of segments.entries()) {
    const value = candidate[index] ?? ''

    if (segment.kind === 'static') {
      if (value !== segment.value) return undefined
      continue
    }

    let decoded: string
    try {
      decoded = decodeURIComponent(value)
    } catch {
      return undefined
    }
    if (decoded.length === 0) return undefined

    params[segment.name] = decoded
  }

  return params
}
