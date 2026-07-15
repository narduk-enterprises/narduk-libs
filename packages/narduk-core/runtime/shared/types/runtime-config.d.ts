/**
 * RuntimeConfig type augmentation.
 *
 * Provides full type safety for `useRuntimeConfig()` across the layer and
 * all downstream apps. Eliminates the need for `as any` or `as string` casts.
 */
interface CoreRuntimeConfig {
  /** SQL backend: D1 (default) or Postgres via Hyperdrive. */
  databaseBackend: 'd1' | 'postgres'
  /** Wrangler Hyperdrive binding name; used by `useHyperdriveConnectionString`. */
  hyperdriveBinding: string
  /** Optional per-policy server-side rate limit overrides for shared layer routes. */
  rateLimitPolicies: Record<
    string,
    {
      namespace?: string
      maxRequests?: number
      windowMs?: number
    }
  >
}

interface CorePublicRuntimeConfig {
  appUrl: string
  /** Backward-compatible alias for appUrl used by older shared/app share surfaces. */
  siteUrl: string
  appName: string
  /**
   * Runtime analytics/telemetry guard. Per `docs/architecture/platform.md`
   * the fleet only has one deploy environment (`production`), but the
   * starter `nuxt.config.ts` still normalizes legacy branch/CI hints into
   * `'staging'` / `'preview'` so the analytics layer can fall back to a
   * safe-mode render. This value is orthogonal to Wrangler environments
   * and will be renamed `analyticsDisabled` in a follow-up (see platform.md
   * §7 "Known Transitional Debt").
   */
  deploymentTarget: 'production' | 'staging' | 'preview'
  previewSafeMode: boolean
  analyticsLoadStrategy: 'immediate' | 'idle' | 'interaction' | 'off'
  appVersion: string
  /** Enables the internal OG image preview lab in local and approved preview envs. */
  ogImagePreviewLab: boolean
  /**
   * Base URL for the public Narduk catalog hub (`layers/seo` default). Used for
   * fleet-catalog cross-links and JSON-LD `isPartOf` wiring.
   */
  publicCatalogBaseUrl: string
  /**
   * Optional X (Twitter) @handle or URL for `twitter:site` on pages using
   * `useSeo` (from `NUXT_PUBLIC_TWITTER_SITE`).
   */
  twitterSite: string
  /**
   * Optional `SearchAction` `urlTemplate` for `useSiteWebSiteSchema`, e.g.
   * `https://example.com/search?q={search_term_string}` (from
   * `NUXT_PUBLIC_SEO_SEARCH_ACTION_URL_TEMPLATE`).
   */
  seoSearchActionUrlTemplate: string
  posthogPublicKey: string
  posthogHost: string
  posthogDeadClicksEnabled: boolean
  posthogExternalDependencyLoadingEnabled: boolean
  posthogFeatureFlagsEnabled: boolean
  posthogSessionReplayEnabled: boolean
  posthogSurveysEnabled: boolean
  indexNowKey: string
  /** Allow browser geolocation prompts for apps that explicitly need location features. */
  allowGeolocation: boolean
  cspScriptSrc: string
  cspConnectSrc: string
  cspFrameSrc: string
  cspWorkerSrc: string
  enforceCanonicalHost: boolean
  /** Set at build time for "latest build" checks (e.g. CI or curl script). */
  buildVersion: string
  /** ISO string set at build time. */
  buildTime: string
}

declare module 'nuxt/schema' {
  interface RuntimeConfig extends CoreRuntimeConfig {}

  interface PublicRuntimeConfig extends CorePublicRuntimeConfig {}
}

declare module '@nuxt/schema' {
  interface RuntimeConfig extends CoreRuntimeConfig {}

  interface PublicRuntimeConfig extends CorePublicRuntimeConfig {}
}

declare global {
  interface Window {
    __NARDUK_BUILD__?:
      | {
          appName: string
          appVersion: string
          buildVersion: string
          buildTime: string
          localBuildTime?: string
        }
      | undefined
    __NARDUK_BUILD_LOGGED__?: string | undefined
  }
}

export {}
