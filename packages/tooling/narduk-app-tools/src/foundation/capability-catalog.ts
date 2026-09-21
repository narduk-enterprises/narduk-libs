/**
 * GENERATED FILE -- do not edit by hand.
 *
 * Regenerate with `node scripts/generate-capability-catalog.mjs`;
 * `--check` fails when this file falls out of step with the workspace, and
 * runs inside `pnpm run scripts:test`.
 *
 * The catalog of shared capabilities item 9 (`foundation:check:coverage`)
 * scores an app against: every published `@narduk-enterprises/*` package in
 * the narduk-libs workspace, derived from `pnpm-workspace.yaml` rather than
 * hand-typed. Private workspace packages are excluded because an app cannot
 * depend on one.
 */

export interface SharedCapability {
  /** Stable capability id: the package name without its scope or `narduk-` prefix. */
  id: string
  /** The published package name an app depends on to adopt this capability. */
  package: string
  /** The `packages/<family>/` directory the package lives in. */
  family: string
  /** The package's own `description`, verbatim. */
  description: string
  /**
   * Path names an app-local copy of this package's internals lives under, e.g.
   * `utils/mapkit/*` or `mapkit.css` (narduk-libs#620). Opt-in, from
   * `FORK_STEMS` in the generator: a generic stem such as `auth` or `seo`
   * names ordinary app code.
   */
  forkStems?: readonly string[]
}

export const SHARED_CAPABILITY_CATALOG: readonly SharedCapability[] = [
  {
    id: 'create-narduk-app',
    package: '@narduk-enterprises/create-narduk-app',
    family: 'tooling',
    description: 'Deterministic, filesystem-only Narduk app generator.',
  },
  {
    id: 'eslint-config',
    package: '@narduk-enterprises/eslint-config',
    family: 'tooling',
    description:
      'Consolidated ESLint plugin and capability packs for Nuxt 4, Vue 3, Tailwind v4, and Nuxt UI v4 projects.',
  },
  {
    id: 'geogrid-web',
    package: '@narduk-enterprises/geogrid-web',
    family: 'modules',
    description:
      'Web twin of GeoGridKit: gridded geo-data overlay and Web-Mercator tile render (WebGL2 + CPU fallback).',
  },
  {
    id: 'journeys',
    package: '@narduk-enterprises/journeys',
    family: 'tooling',
    description:
      'Journey runner contract: repositories declare journeys and scenarios; the tool turns them into tests, screenshots, video and a walkthrough.',
  },
  {
    id: 'ai',
    package: '@narduk-enterprises/narduk-ai',
    family: 'modules',
    description:
      'Reusable AI contracts, xAI helpers, prompt resolution, and admin configuration for Narduk Nuxt apps.',
  },
  {
    id: 'analytics',
    package: '@narduk-enterprises/narduk-analytics',
    family: 'modules',
    description:
      'PostHog, GA, Search Console, and IndexNow Nuxt module for Narduk Cloudflare apps.',
  },
  {
    id: 'app',
    package: '@narduk-enterprises/narduk-app',
    family: 'modules',
    description: 'Runtime app helpers for Narduk Cloudflare and Nuxt apps.',
  },
  {
    id: 'app-tools',
    package: '@narduk-enterprises/narduk-app-tools',
    family: 'tooling',
    description: 'Focused app-local development, migration, deployment, and asset tools.',
  },
  {
    id: 'auth',
    package: '@narduk-enterprises/narduk-auth',
    family: 'modules',
    description:
      'Auth, user session, notification, and protected-route Nuxt module for Narduk Cloudflare apps.',
  },
  {
    id: 'charts',
    package: '@narduk-enterprises/narduk-charts',
    family: 'design',
    description:
      'NardukCharts — Vue 3 SVG charting for dashboards and trading-grade market UIs (TypeScript, themable, accessible). Package: @narduk-enterprises/narduk-charts.',
  },
  {
    id: 'core',
    package: '@narduk-enterprises/narduk-core',
    family: 'modules',
    description:
      'Core Nuxt module, Worker runtime helpers, UI primitives, and database utilities for Narduk Cloudflare apps.',
  },
  {
    id: 'devices',
    package: '@narduk-enterprises/narduk-devices',
    family: 'modules',
    description:
      'Generic device identity, claim ceremony, class-separated credentials, signed device sessions, and lockouts for Narduk Nuxt apps on D1.',
  },
  {
    id: 'logging',
    package: '@narduk-enterprises/narduk-logging',
    family: 'modules',
    description:
      'Structured, private-by-default logging for Narduk applications, services, and jobs.',
  },
  {
    id: 'mapkit',
    package: '@narduk-enterprises/narduk-mapkit',
    family: 'modules',
    description:
      'Framework-agnostic Apple MapKit JS token, geometry, runtime, and playback helpers.',
    forkStems: ['mapkit'],
  },
  {
    id: 'mapkit-nuxt',
    package: '@narduk-enterprises/narduk-mapkit-nuxt',
    family: 'modules',
    description:
      'Nuxt component, composables, and token route for @narduk-enterprises/narduk-mapkit.',
  },
  {
    id: 'platform',
    package: '@narduk-enterprises/narduk-platform',
    family: 'contracts',
    description:
      'Neutral environment, onboarding, package-registry, and provider contracts for independent Narduk apps.',
  },
  {
    id: 'postgres',
    package: '@narduk-enterprises/narduk-postgres',
    family: 'modules',
    description:
      'One PostgreSQL access surface for Narduk apps: Hyperdrive-bound Workers connections, direct Node connections, health checks, an immutable-file migrations runner and the three least-privilege roles.',
  },
  {
    id: 'realtime',
    package: '@narduk-enterprises/narduk-realtime',
    family: 'modules',
    description:
      'Durable Object build wiring, a WebSocket upgrade router, and a hibernating WebSocket base class for Narduk Cloudflare apps.',
  },
  {
    id: 'seo',
    package: '@narduk-enterprises/narduk-seo',
    family: 'modules',
    description:
      'SEO, structured data, sitemap, robots, and OpenGraph Nuxt module for Narduk Cloudflare apps.',
  },
  {
    id: 'shell',
    package: '@narduk-enterprises/narduk-shell',
    family: 'design',
    description:
      'Home of the app-tier Ne* component suite. A Nuxt module that registers every shared component with an explicit addComponent, wrapping Nuxt UI rather than reimplementing it.',
  },
  {
    id: 'tenancy',
    package: '@narduk-enterprises/narduk-tenancy',
    family: 'modules',
    description:
      'Generic organization, membership, role, invite, and time-boxed support-grant tenancy for Narduk Nuxt apps on D1.',
  },
  {
    id: 'testkit',
    package: '@narduk-enterprises/narduk-testkit',
    family: 'tooling',
    description: 'Dev-only Vitest, Playwright, and UI-quality test helpers for Narduk apps.',
  },
  {
    id: 'timeseries',
    package: '@narduk-enterprises/narduk-timeseries',
    family: 'modules',
    description:
      'A TelemetryHistoryStore boundary for Narduk products: a TimescaleDB + PostGIS adapter with bounded batched writes, rollup and track queries, tier-parameterized retention, and a read-only Influx adapter for dual-run parity.',
  },
  {
    id: 'ui',
    package: '@narduk-enterprises/narduk-ui',
    family: 'design',
    description:
      'Narduk shared interface library. Ships the Narduk Status Design System token layer and the instruments component family.',
  },
  {
    id: 'uploads',
    package: '@narduk-enterprises/narduk-uploads',
    family: 'modules',
    description: 'R2 upload and image delivery Nuxt module for Narduk Cloudflare apps.',
  },
  {
    id: 'status-runtime',
    package: '@narduk-enterprises/status-runtime',
    family: 'design',
    description: 'Shared build-time configuration for the five status applications.',
  },
]

/** Private workspace packages deliberately left out of the catalog. */
export const CATALOG_EXCLUDED_PRIVATE_PACKAGES: readonly string[] = [
  '@narduk-enterprises/design-system-build',
  '@narduk-enterprises/libs-explorer',
]

const BY_PACKAGE = new Map(
  SHARED_CAPABILITY_CATALOG.map((capability) => [capability.package, capability]),
)

/** The catalog entry for a package name, or `undefined` for a package the
 * estate does not publish from this workspace (a retired or renamed pin). */
export function capabilityForPackage(packageName: string): SharedCapability | undefined {
  return BY_PACKAGE.get(packageName)
}
