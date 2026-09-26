/**
 * RuntimeConfig type augmentation.
 *
 * Provides full type safety for `useRuntimeConfig()` across the layer and
 * all downstream apps. Eliminates the need for `as any` or `as string` casts.
 */
import type { RequestLoggingOptions } from '@narduk-enterprises/narduk-logging/h3'

import type { RateLimitRuntimeConfig } from '../../server/rate-limit/policy'

interface CoreRuntimeConfig {
  /** Explicit logging identity and controls; absent level retains legacy logLevel behavior. */
  nardukLogging?: Partial<Omit<RequestLoggingOptions, 'sinks' | 'clock' | 'context'>>
  /**
   * SQL backend: D1 (the default), Postgres via Hyperdrive, or `none` for an app
   * without a database. Set it with the `nardukCore.databaseBackend` module
   * option or `NUXT_DATABASE_BACKEND`; the module writes the resolved value here.
   */
  databaseBackend: 'd1' | 'postgres' | 'none'
  /**
   * Where `databaseBackend` came from. `default` means the app declared nothing
   * and inherited D1, so `/api/health` treats a missing D1 binding as degraded
   * rather than as a failed declared dependency.
   */
  databaseBackendSource: 'option' | 'env' | 'runtimeConfig' | 'default'
  /** Built-in `/api/health` probes other modules switch on. */
  nardukHealth?: {
    /** Set by narduk-auth: also verify the `users`, `sessions` and `api_keys` tables. */
    authTables?: boolean
    /**
     * Opt-in deploy identity on `/api/health` (narduk-libs#1022). Header names
     * are the app's own; `body: true` appends `identity` after `checks`.
     */
    identity?: {
      /** The `version_metadata` binding. Default `CF_VERSION_METADATA`. */
      binding?: string
      body?: boolean
      revisionHeader?: string
      workerVersionHeader?: string
    }
  }
  /** Wrangler Hyperdrive binding name; used by `useHyperdriveConnectionString`. */
  hyperdriveBinding: string
  /**
   * Defaults and per-route overrides for `defineRateLimitedHandler`. An
   * operator can retune a route's allowance here without editing route code;
   * `routes[key]` wins over what the route itself declared.
   */
  nardukRateLimit?: RateLimitRuntimeConfig
  /**
   * Edge-cache tuning for `setCacheProfile`. An app overrides the seconds of a
   * named profile here instead of editing a route. `sMaxAge` is the edge TTL and
   * is emitted as `CDN-Cache-Control: max-age`, never as `Cache-Control:
   * s-maxage` — `s-maxage` disables `stale-while-revalidate` (RFC 9111 §4.2.4).
   */
  cache: {
    profiles: Record<
      string,
      {
        maxAge?: number
        noStore?: boolean
        private?: boolean
        sMaxAge?: number
        swr?: number
      }
    >
  }
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
  /** Public GA4 measurement id (`G-…`). Filled at request time from Worker env. */
  gaMeasurementId: string
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
  cspMediaSrc: string
  enforceCanonicalHost: boolean
  /**
   * Hosts the canonical-host middleware redirects to `appUrl`, comma-separated
   * or a list. When set, only these hosts redirect and every other host --
   * `*.workers.dev` previews included -- is served where it was asked
   * (narduk-libs#515). Env: `CANONICAL_REDIRECT_HOSTS`.
   */
  canonicalRedirectHosts?: string | string[]
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
