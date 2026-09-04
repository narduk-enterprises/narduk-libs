// useSiteWebSiteSchema — fleet default WebSite JSON-LD from site config + runtime, with optional SearchAction from env.

import { useRuntimeConfig, useSiteConfig } from '#imports'

import { resolveSiteOriginForSchemaInput } from '../utils/resolveSiteOriginForSchema'

import { useWebSiteSchema, type WebSiteSchemaInput } from './useWebSiteSchema'

/**
 * Emits `WebSite` JSON-LD using `useSiteConfig()` + `runtimeConfig.public` (name, url, description),
 * and optionally `SearchAction` from `public.seoSearchActionUrlTemplate` (e.g. set in Doppler) or overrides.
 *
 * Call once on the home page (or a single layout) — avoid duplicating the same `WebSite` on every route
 * unless you intentionally want the node on each response.
 */
export function useSiteWebSiteSchema(overrides: WebSiteSchemaInput = {}): void {
  const site = useSiteConfig()
  const { public: pub } = useRuntimeConfig()
  const publicAppUrl = typeof pub.appUrl === 'string' ? pub.appUrl : undefined
  const siteUrl = typeof site.url === 'string' ? site.url : undefined
  const base = resolveSiteOriginForSchemaInput({ siteConfigUrl: siteUrl, publicAppUrl })
  if (!base) {
    return
  }

  const nameFromConfig =
    (typeof site.name === 'string' && site.name) ||
    (typeof pub.appName === 'string' && pub.appName) ||
    undefined
  const descriptionFromConfig = typeof site.description === 'string' ? site.description : undefined

  const fromEnv =
    typeof pub.seoSearchActionUrlTemplate === 'string' &&
    pub.seoSearchActionUrlTemplate.trim() !== ''
      ? pub.seoSearchActionUrlTemplate.trim()
      : undefined

  const searchActionUrlTemplate = Object.hasOwn(overrides, 'searchActionUrlTemplate')
    ? overrides.searchActionUrlTemplate
    : fromEnv

  useWebSiteSchema({
    sameAs: overrides.sameAs,
    isPartOfUrl: overrides.isPartOfUrl,
    name: overrides.name ?? nameFromConfig,
    url: overrides.url ?? base,
    description: overrides.description ?? descriptionFromConfig,
    searchActionUrlTemplate,
  })
}
