/**
 * Resolve a single origin string for JSON-LD and canonical SEO helpers.
 * Prefer Nuxt site config URL, then `runtimeConfig.public.appUrl` (common on fleet apps).
 */
export function resolveSiteOriginForSchemaInput(input: {
  publicAppUrl?: string
  siteConfigUrl?: string
}): string {
  const fromSite = typeof input.siteConfigUrl === 'string' ? input.siteConfigUrl.trim() : ''
  if (fromSite) {
    return fromSite.replace(/\/$/, '')
  }
  const fromRuntime = typeof input.publicAppUrl === 'string' ? input.publicAppUrl.trim() : ''
  if (fromRuntime) {
    return fromRuntime.replace(/\/$/, '')
  }
  return ''
}
