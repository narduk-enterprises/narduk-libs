interface SeoPrivateRuntimeConfig {
  /**
   * RFC 9116 security.txt body baked at build from `nardukSeo.securityTxt`.
   * `null` when the app has not set a contact; this package never invents one.
   */
  nardukSeoSecurityTxt: string | null
}

interface SeoPublicRuntimeConfig {
  /** App-owned public fallback; null until the app supplies a real asset. */
  nardukSeoDefaultImage: { url: string; alt: string } | null
  /**
   * Absolute HTTPS endpoint serving the Narduk network directory feed for
   * `/narduk-network`. Empty by design — an unset value disables the directory
   * feature and suppresses the outbound fetch entirely.
   */
  nardukNetworkDirectoryUrl: string
  /**
   * Build-baked flag for the production build-once indexing contract: when
   * true, runtime guards serve `noindex, nofollow` on any non-canonical
   * request host (e.g. `workers.dev` preview aliases) while the canonical
   * site host stays indexable.
   */
  nardukSeoHostAwareIndexing: boolean
  /**
   * True when this layer installed `nuxt-og-image`. False when the optional
   * peer is omitted or `ogImage.enabled` is false (narduk-libs#170); `useSeo`
   * then emits the static image instead of calling `defineOgImage`.
   */
  nardukSeoOgImageModule: boolean
  /** Enables the internal OG image preview lab in local and approved preview envs. */
  ogImagePreviewLab: boolean
  /**
   * Base URL for the public Narduk catalog hub. Used for fleet-catalog
   * cross-links and JSON-LD `isPartOf` wiring.
   */
  publicCatalogBaseUrl: string
  /**
   * @deprecated Unused since narduk-libs#349. `useSeo` no longer emits any
   * `twitter:*` meta — X reads `og:*` instead, and Unhead 3 reports every
   * `twitter:*` name as deprecated. The key stays accepted so existing apps and
   * `NUXT_PUBLIC_TWITTER_SITE` deployments keep booting; nothing reads it.
   */
  twitterSite: string
  /**
   * Optional `SearchAction` URL template for `useSiteWebSiteSchema`.
   */
  seoSearchActionUrlTemplate: string
}

declare module 'nuxt/schema' {
  interface RuntimeConfig extends SeoPrivateRuntimeConfig {}
  interface PublicRuntimeConfig extends SeoPublicRuntimeConfig {}
}

declare module '@nuxt/schema' {
  interface RuntimeConfig extends SeoPrivateRuntimeConfig {}
  interface PublicRuntimeConfig extends SeoPublicRuntimeConfig {}
}

export {}
