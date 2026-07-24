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
