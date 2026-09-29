/** Snapshot document-entry attribution before deferred loading or SPA navigation. */
export function analyticsLandingAttribution(href: string, referrer: string, strict: boolean) {
  const properties: Record<string, string> = {}
  try {
    const origin = new URL(referrer).origin
    if (/^https?:/u.test(origin)) properties.landing_referrer_origin = origin
  } catch {
    /* Direct or unavailable referrer. */
  }
  // Private apps never capture campaign query values, even as custom properties.
  if (strict) return properties
  try {
    const url = new URL(href)
    for (const name of ['utm_source', 'utm_medium', 'utm_campaign']) {
      const value = url.searchParams.get(name)
      // Marketing labels only, bounded; no freeform content, credentials or URLs.
      if (value && /^[\w-]{1,80}$/u.test(value)) properties['landing_' + name] = value
    }
  } catch {
    /* No parseable document-entry URL. */
  }
  return properties
}
