export const hostAwareNoindexRule = 'noindex, nofollow'

/**
 * Normalizes a site URL or request host to a lowercase hostname for
 * indexing-host comparison. Ports and schemes are ignored; invalid or empty
 * input normalizes to '' so callers can fail open (stay indexable) rather
 * than accidentally noindex a misconfigured production host.
 */
export function normalizeIndexingHost(value: unknown): string {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  if (!trimmed) return ''

  try {
    const url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`)

    return url.hostname.toLowerCase()
  } catch {
    return ''
  }
}

/**
 * True only when both hosts resolve and the request host differs from the
 * canonical site host — the case where a build-once immutable deployment is
 * being served from a non-canonical alias (for example a route-free
 * `workers.dev` preview URL) and must advertise noindex at runtime.
 */
export function isNonCanonicalIndexingHost(
  requestHost: unknown,
  canonicalSiteUrl: unknown,
): boolean {
  const canonicalHost = normalizeIndexingHost(canonicalSiteUrl)
  const host = normalizeIndexingHost(requestHost)
  if (!canonicalHost || !host) return false

  return host !== canonicalHost
}

/**
 * Default robots directive for an indexable route on the canonical host in
 * {@link canonicalRobotsPolicy}: indexable, followable, and eligible for large
 * image previews in search results.
 */
export const hostAwareIndexRule = 'index, follow, max-image-preview:large'

export interface CanonicalRobotsPolicyOptions {
  /**
   * Other hostnames (or URLs) that serve the canonical site, for example a
   * `www.` alias. Each goes through {@link normalizeIndexingHost}; values that
   * do not normalize are ignored. Preview hosts do not belong here: every host
   * not listed is non-canonical.
   */
  additionalCanonicalHostnames?: readonly unknown[]
  /** Directive for an indexable route on a canonical host. Defaults to {@link hostAwareIndexRule}. */
  canonicalRobots?: string
  /**
   * Route-level indexability. `false` returns the noindex directive even on
   * the canonical host. Defaults to `true`.
   */
  indexable?: boolean
  /**
   * Directive for every other case: a non-canonical host, a request host that
   * does not normalize, or `indexable: false`. Defaults to
   * {@link hostAwareNoindexRule}.
   */
  nonCanonicalRobots?: string
}

/**
 * Returns the full robots directive (robots meta content or `X-Robots-Tag`
 * value) for a request served on `hostname`, given the site's canonical
 * hostname or site URL.
 *
 * Both hosts go through {@link normalizeIndexingHost}, so scheme, path, port
 * and case are ignored. `www.` and trailing dots are not stripped: list such
 * aliases in `additionalCanonicalHostnames`. A request host that does not
 * normalize is non-canonical. A canonical hostname that does not normalize
 * fails open, as in {@link isNonCanonicalIndexingHost}, so a misconfigured
 * canonical host cannot noindex production.
 *
 * ```ts
 * canonicalRobotsPolicy('example.com', 'example.com') // 'index, follow, max-image-preview:large'
 * canonicalRobotsPolicy('abc.workers.dev', 'example.com') // 'noindex, nofollow'
 * canonicalRobotsPolicy('example.com', 'example.com', { indexable: false }) // 'noindex, nofollow'
 * ```
 */
export function canonicalRobotsPolicy(
  hostname: unknown,
  canonicalHostname: unknown,
  options: CanonicalRobotsPolicyOptions = {},
): string {
  const canonicalRobots = options.canonicalRobots ?? hostAwareIndexRule
  const nonCanonicalRobots = options.nonCanonicalRobots ?? hostAwareNoindexRule
  if (options.indexable === false) return nonCanonicalRobots

  const canonicalHost = normalizeIndexingHost(canonicalHostname)
  if (!canonicalHost) return canonicalRobots

  const host = normalizeIndexingHost(hostname)
  if (!host) return nonCanonicalRobots
  if (host === canonicalHost) return canonicalRobots

  const aliases = options.additionalCanonicalHostnames ?? []
  const isAlias = aliases.some((alias) => normalizeIndexingHost(alias) === host)

  return isAlias ? canonicalRobots : nonCanonicalRobots
}
