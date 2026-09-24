import { sanitizeSameOriginPath } from './same-origin-path'

const ABSOLUTE_URL_PATTERN = /^[a-zA-Z][a-zA-Z+\-.]*:/u

function parseUrl(value: string): URL | undefined {
  try {
    return new URL(value)
  } catch {
    return undefined
  }
}

function siteRootHref(site: URL): string {
  return new URL('/', site).href
}

function parseSiteUrl(siteUrl?: string): URL | undefined {
  return typeof siteUrl === 'string' && siteUrl.trim() ? parseUrl(siteUrl.trim()) : undefined
}

function isTrustedSameOriginAbsolute(absolute: URL, site: URL): boolean {
  return absolute.origin === site.origin && !absolute.username && !absolute.password
}

function resolveRelativeCanonical(safePath: string, site: URL | undefined): string {
  if (!site) return safePath
  try {
    return new URL(safePath, site).href
  } catch {
    return siteRootHref(site)
  }
}

/**
 * Resolve one candidate, or return `undefined` when it is not usable.
 *
 * Returning `undefined` rather than the site root is what lets the caller try
 * the next candidate: a refused value and "the site root" are different
 * answers, and collapsing them is how a whole site ends up declaring the root
 * as every page's canonical.
 */
function resolveCandidate(value: unknown, site: URL | undefined): string | undefined {
  if (typeof value !== 'string') return undefined

  const trimmed = value.trim()
  if (!trimmed) return undefined

  if (ABSOLUTE_URL_PATTERN.test(trimmed)) {
    const absolute = parseUrl(trimmed)
    return site && absolute && isTrustedSameOriginAbsolute(absolute, site)
      ? absolute.href
      : undefined
  }

  const safePath = sanitizeSameOriginPath(trimmed, '')
  return safePath ? resolveRelativeCanonical(safePath, site) : undefined
}

function warnRefusedCanonical(value: unknown, site: URL | undefined, resolved: string): void {
  if (!import.meta.dev) return

  console.warn(
    `[narduk-seo] Refused the canonical ${JSON.stringify(value)}: it is not a path or an ` +
      `absolute URL on ${site ? site.origin : 'the configured site origin'}. ` +
      `Using ${resolved} instead. Pass a relative path such as "/lakes/texas" and let useSeo ` +
      `resolve it; building an absolute URL from runtime config silently breaks wherever that ` +
      `config is unset.`,
  )
}

/**
 * Resolve a router path or explicit canonical to a same-origin absolute URL.
 *
 * Protocol-relative values, backslash smuggling, and cross-origin absolutes are
 * refused. A refused value falls back to `fallbackPath` — the page's own route,
 * which is what the caller meant in every realistic case — and then to the site
 * root. When `siteUrl` does not parse there is no origin to resolve against, so
 * a usable path is returned as-is and anything else is omitted. Never throws:
 * default social meta runs on every page.
 *
 * An explicit absolute URL is allowed only when its origin equals the site
 * origin and it has no userinfo.
 *
 * The fallback matters more than it looks. An app that builds its canonical
 * from `runtimeConfig.public.siteUrl` gets `http://localhost:3000/lakes` in a
 * deployment where that variable is unset — refused here, correctly. Answering
 * the site root would then make every page on the site declare the root as its
 * own canonical and `og:url`: valid, plausible, and wrong everywhere at once.
 * Answering the route keeps the page's own identity, which is the one thing the
 * refused value and the route agreed on (lakestat-us#110, narduk-libs#590).
 */
export function resolveSafeCanonicalUrl(
  value: unknown,
  siteUrl?: string,
  fallbackPath?: unknown,
): string | undefined {
  const site = parseSiteUrl(siteUrl)

  const direct = resolveCandidate(value, site)
  if (direct) return direct

  if (fallbackPath !== undefined && fallbackPath !== value) {
    const routed = resolveCandidate(fallbackPath, site)
    if (routed) {
      warnRefusedCanonical(value, site, routed)
      return routed
    }
  }

  const root = site ? siteRootHref(site) : undefined
  if (root && value !== undefined) warnRefusedCanonical(value, site, root)
  return root
}
