interface SeoPublicRuntimeConfig {
  /** Enables the internal OG image preview lab in local and approved preview envs. */
  ogImagePreviewLab: boolean
  /**
   * Base URL for the public Narduk catalog hub. Used for fleet-catalog
   * cross-links and JSON-LD `isPartOf` wiring.
   */
  publicCatalogBaseUrl: string
  /**
   * Optional X/Twitter @handle or URL for `twitter:site` on pages using `useSeo`.
   */
  twitterSite: string
  /**
   * Optional `SearchAction` URL template for `useSiteWebSiteSchema`.
   */
  seoSearchActionUrlTemplate: string
}

declare module 'nuxt/schema' {
  interface PublicRuntimeConfig extends SeoPublicRuntimeConfig {}
}

declare module '@nuxt/schema' {
  interface PublicRuntimeConfig extends SeoPublicRuntimeConfig {}
}

export {}
