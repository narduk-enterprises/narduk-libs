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
 * True for a host that can never be a deployed site's canonical host: loopback
 * addresses, `localhost`, `*.localhost` and `*.test`. Input goes through
 * {@link normalizeIndexingHost}, so a value that does not normalize is not
 * "local" here; callers treat that case separately.
 */
export function isLocalIndexingHost(value: unknown): boolean {
  const host = normalizeIndexingHost(value)
  if (!host) return false

  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.test') ||
    host === '0.0.0.0' ||
    host === '[::1]' ||
    host === '[::]' ||
    /^127(?:\.\d{1,3}){3}$/.test(host)
  )
}

/**
 * The canonical host to compare requests against, or '' when the configured
 * site URL cannot be one: it does not normalize, or it is a local origin such
 * as the `http://localhost:3000` an app falls back to when `SITE_URL` was not
 * set at build time (narduk-libs#1480). '' means "no usable canonical host",
 * and every caller fails open on it.
 */
function resolveCanonicalIndexingHost(value: unknown): string {
  return isLocalIndexingHost(value) ? '' : normalizeIndexingHost(value)
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
  const canonicalHost = resolveCanonicalIndexingHost(canonicalSiteUrl)
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
 * normalize is non-canonical. A canonical hostname that does not normalize, or
 * is a local origin such as the `http://localhost:3000` an app falls back to
 * when `SITE_URL` was unset at build time, fails open, as in
 * {@link isNonCanonicalIndexingHost}, so a misconfigured canonical host cannot
 * noindex production (narduk-libs#1480).
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

  const canonicalHost = resolveCanonicalIndexingHost(canonicalHostname)
  if (!canonicalHost) return canonicalRobots

  const host = normalizeIndexingHost(hostname)
  if (!host) return nonCanonicalRobots
  if (host === canonicalHost) return canonicalRobots

  const aliases = options.additionalCanonicalHostnames ?? []
  const isAlias = aliases.some((alias) => normalizeIndexingHost(alias) === host)

  return isAlias ? canonicalRobots : nonCanonicalRobots
}
