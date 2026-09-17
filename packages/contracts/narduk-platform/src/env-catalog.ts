/**
 * env-catalog: the canonical list of environment variables used by independent
 * Narduk apps. It describes ownership and destination planes for onboarding and
 * status tooling; it does not provision or mutate any provider.
 *
 * Each entry has six fields. Everything else is derived.
 *
 *   key     - the env var name consumers read at build or runtime.
 *   from    - where the value originates. One of:
 *               doppler:<project>/<config>/<source-key>
 *               registry:global:<key>         shared registry-managed plain value
 *               registry:app:<key>            per-app registry-managed plain value
 *               derive:<formula>              computed; formulas below
 *               generate:<policy>             minted once at bootstrap
 *               app-config:<field>            value lives in the app's own configuration
 *   to      - flat list of destinations. Each of:
 *               cf:build-var | cf:build-secret | cf:runtime-var | cf:runtime-secret
 *               gh:repo-var | gh:repo-secret | gh:org-var | gh:org-secret
 *   scope   - every-app | one-app
 *               every-app    every app that SELECTS THIS MODULE has this key,
 *                            and the resolved VALUE is shared across those apps
 *                            (e.g. every app on the `supabase` module points at
 *                            the same Supabase project URL). Not "every fleet
 *                            app regardless of modules" — a core-only app that
 *                            has no Supabase module correctly does not provision
 *                            SUPABASE_URL.
 *               one-app      every app that SELECTS THIS MODULE has this key,
 *                            but the resolved VALUE is per-app (e.g. per-app GA
 *                            measurement id).
 *   secret  - true for values that must never appear in logs or the UI value cell.
 *               Redundant with `to` for storage, kept as a UI hint.
 *   module  - app capability grouping (posthog, supabase, ...).
 *
 * Formulas accepted in `derive:` (intentionally tiny DSL):
 *
 *   const:<literal>                 a constant string (e.g. `const:supabase`)
 *   alias:<key>                     copy the resolved value of another catalog key
 *   hostname:<key>                  hostname of a URL-valued key
 *   sc-domain:<key>                 `sc-domain:<hostname(key)>`
 *   site-url                        the app's SITE_URL value
 *
 * Policies accepted in `generate:`:
 *
 *   nonce-32                        32-byte random, hex-encoded, minted once at bootstrap
 */

export const CATALOG_SCOPES = ['every-app', 'one-app'] as const
export type CatalogScope = (typeof CATALOG_SCOPES)[number]

export const CATALOG_DESTINATIONS = [
  'cf:build-var',
  'cf:build-secret',
  'cf:runtime-var',
  'cf:runtime-secret',
  'gh:repo-var',
  'gh:repo-secret',
  'gh:org-var',
  'gh:org-secret',
] as const
export type CatalogDestination = (typeof CATALOG_DESTINATIONS)[number]

export const CATALOG_RUNTIME_PLANES = ['build', 'runtime', 'hybrid'] as const
export type CatalogRuntimePlane = (typeof CATALOG_RUNTIME_PLANES)[number]

/**
 * ModuleId — capability grouping. Matches the product language the Variables UI
 * displays. Every catalog entry belongs to exactly one app capability.
 */
export const APP_CAPABILITY_IDS = [
  'site',
  'session',
  'cf-builds',
  'gh-packages',
  'supabase',
  'auth-config',
  'og-image',
  'posthog',
  'ga',
  'search-console',
  'indexnow',
  'ingestion',
  'xai',
  'apple-maps',
  'r2-uploads',
] as const

/** @deprecated Use APP_CAPABILITY_IDS. */
export const FLEET_MODULE_IDS = APP_CAPABILITY_IDS
export const MODULE_IDS = APP_CAPABILITY_IDS
export type AppCapabilityId = (typeof APP_CAPABILITY_IDS)[number]
/** @deprecated Use AppCapabilityId. */
export type FleetModuleId = AppCapabilityId
export type ModuleId = (typeof MODULE_IDS)[number]

export interface ModuleDefinition {
  id: ModuleId
  label: string
  description: string
}

/** Module catalog — source of truth for Variables UI grouping. */
export const MODULE_CATALOG: Record<ModuleId, ModuleDefinition> = {
  site: {
    id: 'site',
    label: 'Site',
    description: 'Canonical app origin and identity.',
  },
  session: {
    id: 'session',
    label: 'Session',
    description: 'Session signing key for protected routes.',
  },
  'cf-builds': {
    id: 'cf-builds',
    label: 'Cloudflare Builds',
    description: 'Workers Builds platform settings.',
  },
  'gh-packages': {
    id: 'gh-packages',
    label: 'GitHub Packages',
    description: 'Read token for private GitHub package installs during build.',
  },
  supabase: {
    id: 'supabase',
    label: 'Supabase',
    description: 'Supabase project URL and keys.',
  },
  'auth-config': {
    id: 'auth-config',
    label: 'Auth Config',
    description: 'Auth feature flags (providers, signup, MFA).',
  },
  'og-image': {
    id: 'og-image',
    label: 'OG Image',
    description: 'Open Graph image signing.',
  },
  posthog: {
    id: 'posthog',
    label: 'PostHog',
    description: 'PostHog analytics and query credentials.',
  },
  ga: {
    id: 'ga',
    label: 'Google Analytics',
    description: 'GA client and admin property identifiers.',
  },
  'search-console': {
    id: 'search-console',
    label: 'Search Console',
    description: 'Google Search Console credentials and site identity.',
  },
  indexnow: {
    id: 'indexnow',
    label: 'IndexNow',
    description: 'IndexNow key for search engine URL submission.',
  },
  ingestion: {
    id: 'ingestion',
    label: 'Ingestion',
    description: 'Protected scheduled ingestion and external trigger access.',
  },
  xai: {
    id: 'xai',
    label: 'xAI',
    description: 'xAI / Grok API key.',
  },
  'apple-maps': {
    id: 'apple-maps',
    label: 'Apple Maps',
    description: 'MapKit JS credentials (Apple team, key, server token).',
  },
  'r2-uploads': {
    id: 'r2-uploads',
    label: 'R2 Uploads',
    description: 'Cloudflare R2 bucket binding for uploads.',
  },
}

export function listModuleDefinitions(): readonly ModuleDefinition[] {
  return MODULE_IDS.map((id) => MODULE_CATALOG[id])
}

export function listAppCapabilityDefinitions(): readonly ModuleDefinition[] {
  return APP_CAPABILITY_IDS.map((id) => MODULE_CATALOG[id])
}

/** @deprecated Use listAppCapabilityDefinitions. */
export function listFleetModuleDefinitions(): readonly ModuleDefinition[] {
  return listAppCapabilityDefinitions()
}

export function resolveCatalogRuntimePlane(entry: CatalogEntry): CatalogRuntimePlane {
  if (entry.plane) return entry.plane

  const hasBuildPlane = entry.to.includes('cf:build-var') || entry.to.includes('cf:build-secret')
  const hasRuntimePlane =
    entry.to.includes('cf:runtime-var') || entry.to.includes('cf:runtime-secret')

  if (hasBuildPlane && hasRuntimePlane) return 'hybrid'
  if (hasRuntimePlane) return 'runtime'
  return 'build'
}

export function resolveCatalogRuntimePlaneNote(entry: CatalogEntry): string {
  if (entry.planeNote) return entry.planeNote

  switch (resolveCatalogRuntimePlane(entry)) {
    case 'build':
      return 'Required during build or local tooling; not expected to change through Worker runtime bindings.'
    case 'hybrid':
      return 'Kept on the build plane for compatibility, but request-time code should prefer live Worker runtime bindings.'
    case 'runtime':
      return 'Read from live Worker runtime bindings so value changes do not require rebuilding the app bundle.'
  }
}

export function isKnownModuleId(value: string | null | undefined): value is ModuleId {
  if (!value) return false
  return (MODULE_IDS as readonly string[]).includes(value)
}

export type CatalogFrom =
  | `doppler:${string}/${string}/${string}`
  | `registry:global:${string}`
  | `registry:app:${string}`
  | `derive:${string}`
  | `generate:${string}`
  | `app-config:${string}`

export interface CatalogEntry {
  key: string
  from: CatalogFrom
  to: readonly CatalogDestination[]
  scope: CatalogScope
  secret: boolean
  module: ModuleId
  /**
   * Optional explicit override for the effective env plane. When omitted,
   * callers should derive the plane from `to` via `resolveCatalogRuntimePlane`.
   */
  plane?: CatalogRuntimePlane
  /**
   * Short explanation for why this key belongs on its effective plane.
   */
  planeNote?: string
  /**
   * Optional human hint. Terse: what does this value mean? Do not put provider plumbing
   * notes here; the structured fields already describe plumbing.
   */
  note?: string
  /**
   * When set, the catalog allows an app to override the derived value via registry inputs.
   * Only meaningful for `derive:` or `registry:app:` entries.
   */
  allowAppOverride?: boolean
  /**
   * Optional runtime knobs are cataloged so layer code cannot invent platform-facing
   * env names, but they do not become required app env contract entries.
   */
  optional?: boolean
}

// ─── app-wide, always-on (provided by core) ──────────────────────────────────
// Conservative runtime-overlay migration: several safe public/server values
// still list `cf:build-var` / `cf:build-secret` for downstream compatibility,
// but runtime code should prefer live Worker bindings via the shared overlay.
// Remove legacy build-plane destinations only after fleet validation proves no
// remaining Nuxt config build read depends on them.

const APP_BASE: CatalogEntry[] = [
  {
    key: 'SITE_URL',
    from: 'app-config:url',
    to: ['cf:build-var', 'cf:runtime-var'],
    scope: 'every-app',
    secret: false,
    module: 'site',
    note: 'Canonical app origin; drives DNS, callbacks, derived analytics hostnames.',
  },
  {
    key: 'NUXT_PUBLIC_ALLOW_GEOLOCATION',
    from: 'registry:app:NUXT_PUBLIC_ALLOW_GEOLOCATION',
    to: ['cf:build-var', 'cf:runtime-var'],
    scope: 'one-app',
    secret: false,
    module: 'site',
    note: 'Public opt-in flag that allows browser geolocation prompts via Permissions-Policy. Request-time headers read the Worker binding. Workers Builds does not copy wrangler.json vars into `nuxt build`, so a nuxt.config bake of this flag is the same class of bug as empty analytics keys (buoys#133).',
  },
  {
    key: 'GH_PACKAGES_READ',
    from: 'doppler:narduk/tokens/GH_PACKAGES_READ',
    to: ['cf:build-secret'],
    scope: 'every-app',
    secret: true,
    module: 'gh-packages',
    note: 'GitHub Packages read token for Workers Builds installs.',
  },
  {
    key: 'NARDUK_VERBOSE_BUILD_LOGS',
    from: 'registry:app:NARDUK_VERBOSE_BUILD_LOGS',
    to: ['cf:build-var'],
    scope: 'one-app',
    secret: false,
    module: 'cf-builds',
    optional: true,
    note: 'Optional diagnostic flag for verbose Nuxt layer build logging.',
  },
  {
    key: 'NUXT_SESSION_PASSWORD',
    from: 'generate:nonce-32',
    to: ['cf:build-secret', 'cf:runtime-secret'],
    scope: 'every-app',
    secret: true,
    module: 'session',
    note: 'Session signing key. Stable across deploys; never rotated without user logout.',
  },
  {
    key: 'LOG_LEVEL',
    from: 'registry:app:LOG_LEVEL',
    to: ['cf:runtime-var'],
    scope: 'one-app',
    secret: false,
    module: 'site',
    optional: true,
    note: 'Optional runtime log verbosity override for structured server logs.',
  },
]

// ─── supabase ────────────────────────────────────────────────────────────────

const SUPABASE_MODULE: CatalogEntry[] = [
  {
    key: 'AUTH_AUTHORITY_URL',
    from: 'doppler:narduk/tokens/AUTH_AUTHORITY_URL',
    to: ['cf:build-var', 'cf:runtime-var'],
    scope: 'every-app',
    secret: false,
    module: 'supabase',
    note: 'Supabase project base URL. Callback-form URLs normalize at resolve time.',
  },
  {
    key: 'SUPABASE_URL',
    from: 'derive:alias:AUTH_AUTHORITY_URL',
    to: ['cf:build-var', 'cf:runtime-var'],
    scope: 'every-app',
    secret: false,
    module: 'supabase',
  },
  {
    key: 'SUPABASE_ANON_KEY',
    from: 'doppler:narduk/tokens/SUPABASE_ANON_KEY',
    to: ['cf:build-var', 'cf:runtime-var'],
    scope: 'every-app',
    secret: false,
    module: 'supabase',
    note: 'Public anon key. Plain-text on purpose (client reads it).',
  },
  {
    key: 'AUTH_ANON_KEY',
    from: 'derive:alias:SUPABASE_ANON_KEY',
    to: ['cf:build-var', 'cf:runtime-var'],
    scope: 'every-app',
    secret: false,
    module: 'supabase',
    note: 'Legacy auth-layer alias for the public Supabase anon key.',
  },
  {
    key: 'SUPABASE_AUTH_ANON_KEY',
    from: 'derive:alias:SUPABASE_ANON_KEY',
    to: ['cf:build-var', 'cf:runtime-var'],
    scope: 'every-app',
    secret: false,
    module: 'supabase',
    note: 'Legacy Supabase auth alias for the public anon key.',
  },
  {
    key: 'SUPABASE_PUBLISHABLE_KEY',
    from: 'derive:alias:SUPABASE_ANON_KEY',
    to: ['cf:build-var', 'cf:runtime-var'],
    scope: 'every-app',
    secret: false,
    module: 'supabase',
  },
  {
    key: 'SUPABASE_SERVICE_ROLE_KEY',
    from: 'doppler:narduk/tokens/SUPABASE_SERVICE_ROLE_KEY',
    to: ['cf:runtime-secret'],
    scope: 'every-app',
    secret: true,
    module: 'supabase',
    note: 'Supabase admin key. Server-only.',
  },
  {
    key: 'AUTH_SERVICE_ROLE_KEY',
    from: 'derive:alias:SUPABASE_SERVICE_ROLE_KEY',
    to: ['cf:runtime-secret'],
    scope: 'every-app',
    secret: true,
    module: 'supabase',
    note: 'Legacy auth-layer alias for the Supabase service role key.',
  },
  {
    key: 'SUPABASE_AUTH_SERVICE_ROLE_KEY',
    from: 'derive:alias:SUPABASE_SERVICE_ROLE_KEY',
    to: ['cf:runtime-secret'],
    scope: 'every-app',
    secret: true,
    module: 'supabase',
    note: 'Legacy Supabase auth alias for the service role key.',
  },
]

// ─── auth-config ─────────────────────────────────────────────────────────────

const AUTH_CONFIG_MODULE: CatalogEntry[] = [
  {
    key: 'AUTH_BACKEND',
    from: 'derive:const:supabase',
    to: ['cf:build-var', 'cf:runtime-var'],
    scope: 'every-app',
    secret: false,
    module: 'auth-config',
  },
  {
    key: 'APP_BACKEND_PRESET',
    from: 'registry:app:APP_BACKEND_PRESET',
    to: ['cf:build-var', 'cf:runtime-var'],
    scope: 'one-app',
    secret: false,
    module: 'auth-config',
    note: 'Optional app backend preset consumed by auth and runtime-public helpers.',
    optional: true,
  },
  {
    key: 'AUTH_PROVIDERS',
    from: 'derive:const:apple,email',
    to: ['cf:build-var', 'cf:runtime-var'],
    scope: 'every-app',
    secret: false,
    module: 'auth-config',
  },
  {
    key: 'AUTH_ENFORCE_CANONICAL_HOST',
    from: 'derive:const:true',
    to: ['cf:build-var', 'cf:runtime-var'],
    scope: 'every-app',
    secret: false,
    module: 'auth-config',
  },
  {
    key: 'AUTH_PUBLIC_SIGNUP',
    from: 'derive:const:true',
    to: ['cf:build-var', 'cf:runtime-var'],
    scope: 'every-app',
    secret: false,
    module: 'auth-config',
  },
  {
    key: 'AUTH_REQUIRE_MFA',
    from: 'derive:const:false',
    to: ['cf:build-var', 'cf:runtime-var'],
    scope: 'every-app',
    secret: false,
    module: 'auth-config',
  },
  {
    key: 'AUTH_FORCE_LOCAL',
    from: 'registry:app:AUTH_FORCE_LOCAL',
    to: ['cf:build-var', 'cf:runtime-var'],
    scope: 'one-app',
    secret: false,
    module: 'auth-config',
    note: 'Emergency app-level override that keeps auth in local mode even when Supabase keys exist.',
    optional: true,
  },
  {
    key: 'TURNSTILE_SECRET_KEY',
    from: 'doppler:narduk/tokens/TURNSTILE_SECRET_KEY',
    to: ['cf:runtime-secret'],
    scope: 'every-app',
    secret: true,
    module: 'auth-config',
  },
  {
    key: 'TURNSTILE_SITE_KEY',
    from: 'doppler:narduk/tokens/TURNSTILE_SITE_KEY',
    to: ['cf:build-var', 'cf:runtime-var'],
    scope: 'every-app',
    secret: false,
    module: 'auth-config',
  },
]

// ─── og-image ────────────────────────────────────────────────────────────────

const OG_IMAGE_MODULE: CatalogEntry[] = [
  {
    key: 'NUXT_OG_IMAGE_SECRET',
    from: 'generate:nonce-32',
    to: ['cf:build-secret', 'cf:runtime-secret', 'gh:repo-secret'],
    scope: 'every-app',
    secret: true,
    module: 'og-image',
    note: 'Signing key for OG image URLs. Stable across deploys.',
  },
]

// ─── posthog ─────────────────────────────────────────────────────────────────

const POSTHOG_MODULE: CatalogEntry[] = [
  {
    key: 'POSTHOG_PUBLIC_KEY',
    from: 'registry:global:POSTHOG_PUBLIC_KEY',
    to: ['cf:build-var', 'cf:runtime-var'],
    scope: 'every-app',
    secret: false,
    module: 'posthog',
    note: 'Public PostHog project key. `cf:runtime-var` is the contract: narduk-core applies it to SSR `__NUXT__` from the Worker env. Workers Builds does not copy wrangler.json vars into `nuxt build`, so `cf:build-var` is optional/legacy. Do not read wrangler.json from nuxt.config to fill the bake (buoys#133). Optional alias: NUXT_PUBLIC_POSTHOG_PUBLIC_KEY.',
  },
  {
    key: 'POSTHOG_HOST',
    from: 'registry:global:POSTHOG_HOST',
    to: ['cf:build-var', 'cf:runtime-var'],
    scope: 'every-app',
    secret: false,
    module: 'posthog',
    note: 'Browser ingest host.',
  },
  {
    key: 'POSTHOG_PROJECT_ID',
    from: 'registry:global:POSTHOG_PROJECT_ID',
    to: ['cf:build-var', 'cf:runtime-var'],
    scope: 'every-app',
    secret: false,
    module: 'posthog',
    note: 'Server-side query context for admin analytics.',
  },
  {
    key: 'POSTHOG_PERSONAL_API_KEY',
    from: 'doppler:narduk/tokens/POSTHOG_PERSONAL_API_KEY',
    to: ['cf:build-secret', 'cf:runtime-secret'],
    scope: 'every-app',
    secret: true,
    module: 'posthog',
  },
  {
    key: 'POSTHOG_DOMAIN',
    from: 'derive:hostname:SITE_URL',
    to: ['cf:build-var', 'cf:runtime-var'],
    scope: 'every-app',
    secret: false,
    module: 'posthog',
    allowAppOverride: true,
    note: 'Canonical site hostname for PostHog admin analytics scoping.',
  },
  {
    key: 'POSTHOG_API_HOST',
    from: 'derive:const:https://p.nard.uk',
    to: ['cf:build-var', 'cf:runtime-var'],
    scope: 'every-app',
    secret: false,
    module: 'posthog',
    note: 'Admin PostHog API base URL.',
  },
  {
    key: 'POSTHOG_SESSION_REPLAY_ENABLED',
    from: 'registry:app:POSTHOG_SESSION_REPLAY_ENABLED',
    to: ['cf:build-var', 'cf:runtime-var'],
    scope: 'one-app',
    secret: false,
    module: 'posthog',
    note: 'Per-app runtime flag for PostHog session replay.',
    optional: true,
  },
  {
    key: 'POSTHOG_SURVEYS_ENABLED',
    from: 'registry:app:POSTHOG_SURVEYS_ENABLED',
    to: ['cf:build-var', 'cf:runtime-var'],
    scope: 'one-app',
    secret: false,
    module: 'posthog',
    note: 'Per-app runtime flag for PostHog surveys.',
    optional: true,
  },
  {
    key: 'POSTHOG_DEAD_CLICKS_ENABLED',
    from: 'registry:app:POSTHOG_DEAD_CLICKS_ENABLED',
    to: ['cf:build-var', 'cf:runtime-var'],
    scope: 'one-app',
    secret: false,
    module: 'posthog',
    note: 'Per-app runtime flag for PostHog dead-click capture.',
    optional: true,
  },
  {
    key: 'POSTHOG_FEATURE_FLAGS_ENABLED',
    from: 'registry:app:POSTHOG_FEATURE_FLAGS_ENABLED',
    to: ['cf:build-var', 'cf:runtime-var'],
    scope: 'one-app',
    secret: false,
    module: 'posthog',
    note: 'Per-app runtime flag for PostHog feature flags.',
    optional: true,
  },
  {
    key: 'POSTHOG_EXTERNAL_DEPENDENCY_LOADING_ENABLED',
    from: 'registry:app:POSTHOG_EXTERNAL_DEPENDENCY_LOADING_ENABLED',
    to: ['cf:build-var', 'cf:runtime-var'],
    scope: 'one-app',
    secret: false,
    module: 'posthog',
    note: 'Per-app runtime flag for PostHog external dependency loading.',
    optional: true,
  },
]

// ─── ga ──────────────────────────────────────────────────────────────────────

const GA_MODULE: CatalogEntry[] = [
  {
    key: 'GA_MEASUREMENT_ID',
    from: 'registry:app:GA_MEASUREMENT_ID',
    to: ['cf:build-var', 'cf:runtime-var'],
    scope: 'one-app',
    secret: false,
    module: 'ga',
    note: 'Public GA client id; set per app. `cf:runtime-var` is the contract: narduk-core applies it to SSR `__NUXT__` from the Worker env. Workers Builds does not copy wrangler.json vars into `nuxt build`, so `cf:build-var` is optional/legacy. Do not read wrangler.json from nuxt.config to fill the bake (buoys#133). Optional alias: NUXT_PUBLIC_GA_MEASUREMENT_ID.',
  },
  {
    key: 'GA_PROPERTY_ID',
    from: 'registry:app:GA_PROPERTY_ID',
    to: ['cf:runtime-var'],
    scope: 'one-app',
    secret: false,
    module: 'ga',
    note: 'Server-only GA property id for admin analytics.',
  },
]

// ─── search-console ──────────────────────────────────────────────────────────

const SEARCH_CONSOLE_MODULE: CatalogEntry[] = [
  {
    key: 'GSC_SERVICE_ACCOUNT_JSON',
    from: 'doppler:narduk/tokens/GSC_SERVICE_ACCOUNT_JSON',
    to: ['cf:build-secret', 'cf:runtime-secret'],
    scope: 'every-app',
    secret: true,
    module: 'search-console',
    note: 'Shared Google service account JSON copied directly to the app provider planes during onboarding.',
  },
  {
    key: 'GSC_SITE_URL',
    from: 'derive:sc-domain:SITE_URL',
    to: ['cf:build-var', 'cf:runtime-var'],
    scope: 'every-app',
    secret: false,
    module: 'search-console',
    allowAppOverride: true,
    note: 'Search Console property id. Defaults to `sc-domain:<hostname(SITE_URL)>`.',
  },
]

// ─── indexnow ────────────────────────────────────────────────────────────────

const INDEXNOW_MODULE: CatalogEntry[] = [
  {
    key: 'INDEXNOW_KEY',
    from: 'doppler:narduk/tokens/INDEXNOW_KEY',
    to: ['cf:build-var', 'cf:runtime-var'],
    scope: 'every-app',
    secret: false,
    module: 'indexnow',
    note: 'Shared IndexNow key copied directly to the app provider planes during onboarding.',
  },
]

// ─── ingestion ───────────────────────────────────────────────────────────────

const INGESTION_MODULE: CatalogEntry[] = [
  {
    key: 'CRON_SECRET',
    from: 'generate:nonce-32',
    to: ['cf:runtime-secret', 'gh:repo-secret'],
    scope: 'one-app',
    secret: true,
    module: 'ingestion',
    note: 'Bearer token for protected ingestion cron routes.',
  },
]

// ─── xai ─────────────────────────────────────────────────────────────────────

const XAI_MODULE: CatalogEntry[] = [
  {
    key: 'XAI_API_KEY',
    from: 'doppler:narduk/tokens/XAI_API_KEY',
    to: ['cf:runtime-secret'],
    scope: 'every-app',
    secret: true,
    module: 'xai',
  },
]

// ─── apple-maps ──────────────────────────────────────────────────────────────

const APPLE_MAPS_MODULE: CatalogEntry[] = [
  // Apple developer credentials are shared across the whole fleet: the same
  // Apple Developer Team publishes every Narduk property, so all maps-enabled
  // apps use the same KEY_ID / TEAM_ID / PRIVATE_KEY. Source them once from
  // `narduk/tokens` Doppler and let the env-contract reconcile propagate to
  // every app that declares the maps bundle, instead of forcing operators to
  // paste per-app values into app-local config.
  {
    key: 'APPLE_TEAM_ID',
    from: 'doppler:narduk/tokens/APPLE_TEAM_ID',
    to: ['cf:runtime-var'],
    scope: 'every-app',
    secret: false,
    module: 'apple-maps',
  },
  {
    key: 'NUXT_APPLE_TEAM_ID',
    from: 'derive:alias:APPLE_TEAM_ID',
    to: ['cf:runtime-var'],
    scope: 'every-app',
    secret: false,
    module: 'apple-maps',
    note: 'Nuxt runtime-config alias for appleTeamId when values are provided only at Worker runtime.',
  },
  {
    key: 'APPLE_KEY_ID',
    from: 'doppler:narduk/tokens/APPLE_KEY_ID',
    to: ['cf:runtime-var'],
    scope: 'every-app',
    secret: false,
    module: 'apple-maps',
  },
  {
    key: 'NUXT_APPLE_KEY_ID',
    from: 'derive:alias:APPLE_KEY_ID',
    to: ['cf:runtime-var'],
    scope: 'every-app',
    secret: false,
    module: 'apple-maps',
    note: 'Nuxt runtime-config alias for appleKeyId when values are provided only at Worker runtime.',
  },
  {
    key: 'APPLE_PRIVATE_KEY',
    from: 'doppler:narduk/tokens/APPLE_PRIVATE_KEY',
    to: ['cf:runtime-secret'],
    scope: 'every-app',
    secret: true,
    module: 'apple-maps',
  },
  {
    key: 'NUXT_APPLE_SECRET_KEY',
    from: 'derive:alias:APPLE_PRIVATE_KEY',
    to: ['cf:runtime-secret'],
    scope: 'every-app',
    secret: true,
    module: 'apple-maps',
    note: 'Nuxt runtime-config alias for appleSecretKey when values are provided only at Worker runtime.',
  },
  {
    key: 'MAPKIT_SERVER_API_KEY',
    from: 'app-config:maps.mapkitServerApiKey',
    to: ['cf:runtime-secret'],
    scope: 'one-app',
    secret: true,
    module: 'apple-maps',
  },
  {
    key: 'NUXT_MAPKIT_SERVER_API_KEY',
    from: 'derive:alias:MAPKIT_SERVER_API_KEY',
    to: ['cf:runtime-secret'],
    scope: 'one-app',
    secret: true,
    module: 'apple-maps',
    note: 'Nuxt runtime-config alias for mapkitServerApiKey when values are provided only at Worker runtime.',
  },
  {
    key: 'APPLE_MAPS_APP_ID',
    from: 'app-config:maps.appleMapsAppId',
    to: ['cf:runtime-var'],
    scope: 'one-app',
    secret: false,
    module: 'apple-maps',
  },
  {
    key: 'MAPKIT_ALLOWED_ORIGINS',
    from: 'app-config:maps.mapkitAllowedOrigins',
    to: ['cf:runtime-var'],
    scope: 'one-app',
    secret: false,
    module: 'apple-maps',
  },
]

// ─── r2-uploads ──────────────────────────────────────────────────────────────

const R2_UPLOADS_MODULE: CatalogEntry[] = [
  {
    key: 'R2_BUCKET',
    from: 'app-config:uploads.r2Bucket',
    to: ['cf:runtime-var'],
    scope: 'one-app',
    secret: false,
    module: 'r2-uploads',
    note: 'R2 binding name.',
  },
]

export const ENV_CATALOG: readonly CatalogEntry[] = Object.freeze(
  [
    ...APP_BASE,
    ...SUPABASE_MODULE,
    ...AUTH_CONFIG_MODULE,
    ...OG_IMAGE_MODULE,
    ...POSTHOG_MODULE,
    ...GA_MODULE,
    ...SEARCH_CONSOLE_MODULE,
    ...INDEXNOW_MODULE,
    ...INGESTION_MODULE,
    ...XAI_MODULE,
    ...APPLE_MAPS_MODULE,
    ...R2_UPLOADS_MODULE,
  ].sort((left, right) => left.key.localeCompare(right.key)),
)

const CATALOG_BY_KEY = new Map(ENV_CATALOG.map((entry) => [entry.key, entry]))

export function getCatalogEntry(key: string | null | undefined): CatalogEntry | null {
  const normalized = key?.trim()
  if (!normalized) return null
  return CATALOG_BY_KEY.get(normalized) ?? null
}

export function listCatalogEntries(): readonly CatalogEntry[] {
  return ENV_CATALOG
}

export function listCatalogEntriesForScope(scope: CatalogScope): readonly CatalogEntry[] {
  return ENV_CATALOG.filter((entry) => entry.scope === scope)
}

export function listCatalogEntriesForModule(module: ModuleId): readonly CatalogEntry[] {
  return ENV_CATALOG.filter((entry) => entry.module === module)
}

export function listCatalogEntriesForModules(
  modules: readonly ModuleId[],
): readonly CatalogEntry[] {
  const set = new Set(modules)
  return ENV_CATALOG.filter((entry) => set.has(entry.module))
}

export function listKeysForModule(module: ModuleId): string[] {
  return listCatalogEntriesForModule(module).map((entry) => entry.key)
}

export function listKeysForModules(modules: readonly ModuleId[]): string[] {
  return listCatalogEntriesForModules(modules)
    .filter((entry) => !entry.optional)
    .map((entry) => entry.key)
}

// ─── from: parsing ───────────────────────────────────────────────────────────

export type CatalogFromParsed =
  | { kind: 'doppler'; project: string; config: string; key: string }
  | { kind: 'registry-global'; key: string }
  | { kind: 'registry-app'; key: string }
  | { kind: 'derive'; formula: DeriveFormula }
  | { kind: 'generate'; policy: GeneratePolicy }
  | { kind: 'app-config'; field: string }

export type DeriveFormula =
  | { op: 'const'; value: string }
  | { op: 'alias'; key: string }
  | { op: 'hostname'; key: string }
  | { op: 'sc-domain'; key: string }
  | { op: 'site-url' }

export type GeneratePolicy = { policy: 'nonce-32' }

export function parseCatalogFrom(from: CatalogFrom): CatalogFromParsed {
  if (from.startsWith('doppler:')) {
    const rest = from.slice('doppler:'.length)
    const [project, config, key] = rest.split('/')
    if (!project || !config || !key) {
      throw new Error(`Invalid doppler from: "${from}" (expected doppler:<project>/<config>/<key>)`)
    }
    return { kind: 'doppler', project, config, key }
  }

  if (from.startsWith('registry:global:')) {
    return { kind: 'registry-global', key: from.slice('registry:global:'.length) }
  }

  if (from.startsWith('registry:app:')) {
    return { kind: 'registry-app', key: from.slice('registry:app:'.length) }
  }

  if (from.startsWith('derive:')) {
    return { kind: 'derive', formula: parseDeriveFormula(from.slice('derive:'.length)) }
  }

  if (from.startsWith('generate:')) {
    const policy = from.slice('generate:'.length)
    if (policy !== 'nonce-32') {
      throw new Error(`Unknown generate policy: "${policy}" (known: nonce-32)`)
    }
    return { kind: 'generate', policy: { policy: 'nonce-32' } }
  }

  if (from.startsWith('app-config:')) {
    return { kind: 'app-config', field: from.slice('app-config:'.length) }
  }

  throw new Error(`Unknown catalog from: "${from}"`)
}

function parseDeriveFormula(spec: string): DeriveFormula {
  if (spec === 'site-url') return { op: 'site-url' }

  if (spec.startsWith('const:')) {
    return { op: 'const', value: spec.slice('const:'.length) }
  }

  if (spec.startsWith('alias:')) {
    return { op: 'alias', key: spec.slice('alias:'.length) }
  }

  if (spec.startsWith('hostname:')) {
    return { op: 'hostname', key: spec.slice('hostname:'.length) }
  }

  if (spec.startsWith('sc-domain:')) {
    return { op: 'sc-domain', key: spec.slice('sc-domain:'.length) }
  }

  throw new Error(`Unknown derive formula: "${spec}"`)
}
