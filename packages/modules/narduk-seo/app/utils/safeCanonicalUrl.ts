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

/** Accept a same-origin absolute, otherwise fall back to the site root. */
function resolveAbsoluteCanonical(trimmed: string, site: URL | undefined): string | undefined {
  const absolute = parseUrl(trimmed)
  if (site && absolute && isTrustedSameOriginAbsolute(absolute, site)) {
    return absolute.href
  }
  return site ? siteRootHref(site) : undefined
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
 * Resolve a router path or explicit canonical to a same-origin absolute URL.
 *
 * Protocol-relative values, backslash smuggling, and cross-origin absolutes
 * fall back to the site root when `siteUrl` parses, or are omitted when it
 * does not. Never throws: default social meta runs on every page.
 *
 * An explicit absolute URL is allowed only when its origin equals the site
 * origin and it has no userinfo.
 */
export function resolveSafeCanonicalUrl(value: unknown, siteUrl?: string): string | undefined {
  const site = parseSiteUrl(siteUrl)

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed && ABSOLUTE_URL_PATTERN.test(trimmed)) {
      return resolveAbsoluteCanonical(trimmed, site)
    }

    const safePath = sanitizeSameOriginPath(trimmed, '')
    if (safePath) {
      return resolveRelativeCanonical(safePath, site)
    }
  }

  return site ? siteRootHref(site) : undefined
}
