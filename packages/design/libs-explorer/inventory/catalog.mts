/**
 * The curated half of the package catalog.
 *
 * Everything a manifest already says (name, version, description, exports,
 * peers, workspace dependencies) is read by `workspace.mts`. This file adds
 * what a manifest cannot: which kind of package it is, the capability words
 * people search for ("CSV", "callout", "upload"), what an app needs before it
 * can use it, and which Explorer demos show it.
 *
 * `check.mts` fails when a workspace package has no entry here, when an entry
 * names a package that no longer exists, or when a `demos` id is not in the
 * example registry — so this file cannot quietly fall behind the workspace.
 */

export type PackageKind = 'visual' | 'runtime' | 'server' | 'tooling' | 'contract'

export interface CatalogEntry {
  kind: PackageKind
  /** Search words and the capability list on the package page. */
  capabilities: string[]
  /** What an app needs before the package works: bindings, credentials, peers. */
  prerequisites?: string[]
  /** Example registry ids that demonstrate this package. */
  demos?: string[]
  /**
   * One-time app setup, copied from the package README rather than guessed
   * from `exports`. `check.mts` fails when a specifier here is not the package
   * name or one of its exported subpaths, so a renamed entry cannot linger.
   */
  setup?: PackageSetup
}

export interface PackageSetup {
  /** The `modules: [...]` entry for `nuxt.config.ts`. */
  nuxtModule?: string
  /** A stylesheet the app imports from its own CSS. */
  stylesheet?: string
  /** Said once on the package page, under the steps. */
  note?: string
  /** A command-line tool's documented invocation, instead of an install. */
  commands?: string[]
}

const SHELL_DEMOS = [
  'ne-page-header',
  'ne-section-header',
  'ne-status-badge',
  'ne-confirm-dialog',
  'ne-state-panel',
  'ne-pager',
  'ne-filter-bar',
  'ne-search-input',
  'ne-form',
  'ne-form-section',
  'ne-settings-page',
  'ne-kpi-tile',
  'ne-kpi-band',
  'ne-data-table',
  'ne-sort-header',
  'ne-csv-download',
  'formatters',
]

export const CATALOG: Record<string, CatalogEntry> = {
  '@narduk-enterprises/create-narduk-app': {
    kind: 'tooling',
    capabilities: ['app generator', 'scaffold', 'one-shot', 'Cloudflare Workers', 'Nuxt 4'],
    setup: { commands: ['pnpm dlx @narduk-enterprises/create-narduk-app <app-name>'] },
  },
  '@narduk-enterprises/design-system-build': {
    kind: 'tooling',
    capabilities: ['design cards', 'static export', 'Claude Design', 'NE Base'],
  },
  '@narduk-enterprises/eslint-config': {
    kind: 'tooling',
    capabilities: ['ESLint', 'lint budgets', 'narduk-lint', 'Nuxt UI rules', 'Tailwind rules'],
  },
  '@narduk-enterprises/geogrid-web': {
    kind: 'visual',
    capabilities: ['gridded data', 'raster overlay', 'WebGL2', 'tile render', 'color ramps'],
  },
  '@narduk-enterprises/journeys': {
    kind: 'tooling',
    capabilities: ['journeys', 'scenarios', 'screenshots', 'video', 'walkthrough', 'Playwright'],
  },
  '@narduk-enterprises/libs-explorer': {
    kind: 'tooling',
    capabilities: ['showcase', 'component explorer', 'package catalog', 'foundations'],
  },
  '@narduk-enterprises/narduk-ai': {
    kind: 'server',
    capabilities: ['xAI', 'prompt resolution', 'system prompts', 'admin AI settings'],
    prerequisites: ['An xAI API key in the app runtime config.'],
  },
  '@narduk-enterprises/narduk-analytics': {
    kind: 'runtime',
    capabilities: ['PostHog', 'Google Analytics', 'Search Console', 'IndexNow', 'admin dashboard'],
    prerequisites: ['@narduk-enterprises/narduk-core installed as a Nuxt module.'],
  },
  '@narduk-enterprises/narduk-app': {
    kind: 'runtime',
    capabilities: [
      'HTTP helpers',
      'error envelopes',
      'request body validation',
      'zod',
      'API errors',
    ],
  },
  '@narduk-enterprises/narduk-auth': {
    kind: 'runtime',
    capabilities: ['sessions', 'login', 'passkeys', 'protected routes', 'notifications', 'D1'],
    prerequisites: ['A D1 binding and the package migrations applied.'],
  },
  '@narduk-enterprises/narduk-charts': {
    kind: 'visual',
    capabilities: ['line chart', 'bar chart', 'pie chart', 'candlestick', 'studies', 'SVG', 'zoom'],
  },
  '@narduk-enterprises/narduk-core': {
    kind: 'runtime',
    capabilities: [
      'Nuxt module',
      'Worker runtime',
      'UI primitives',
      'D1 utilities',
      'canonical host',
    ],
    setup: { nuxtModule: '@narduk-enterprises/narduk-core' },
  },
  '@narduk-enterprises/narduk-devices': {
    kind: 'server',
    capabilities: ['device identity', 'claim ceremony', 'device sessions', 'lockouts', 'D1'],
    prerequisites: ['A D1 binding and the package migrations applied.'],
    setup: { nuxtModule: '@narduk-enterprises/narduk-devices/nuxt' },
  },
  '@narduk-enterprises/narduk-logging': {
    kind: 'runtime',
    capabilities: ['structured logs', 'private by default', 'OpenTelemetry', 'Worker', 'browser'],
  },
  '@narduk-enterprises/narduk-mapkit': {
    kind: 'visual',
    capabilities: ['Apple MapKit JS', 'map token', 'geometry', 'marks', 'callout', 'playback'],
    prerequisites: ['Apple MapKit JS signing key held server-side.'],
    setup: { nuxtModule: '@narduk-enterprises/narduk-mapkit/nuxt' },
  },
  '@narduk-enterprises/narduk-mapkit-nuxt': {
    kind: 'visual',
    capabilities: ['map component', 'token route', 'composables', 'Apple Maps'],
    prerequisites: ['Apple MapKit JS signing key held server-side.'],
    setup: { nuxtModule: '@narduk-enterprises/narduk-mapkit-nuxt' },
  },
  '@narduk-enterprises/narduk-platform': {
    kind: 'contract',
    capabilities: ['env catalog', 'list query', 'package registry', 'provider contracts'],
  },
  '@narduk-enterprises/narduk-postgres': {
    kind: 'server',
    capabilities: ['PostgreSQL', 'Hyperdrive', 'migrations runner', 'least-privilege roles'],
    prerequisites: ['A Hyperdrive binding or a direct PostgreSQL connection string.'],
  },
  '@narduk-enterprises/narduk-realtime': {
    kind: 'server',
    capabilities: ['Durable Objects', 'WebSocket', 'hibernation', 'upgrade router'],
    prerequisites: ['A Durable Object binding in wrangler config.'],
    setup: { nuxtModule: '@narduk-enterprises/narduk-realtime' },
  },
  '@narduk-enterprises/narduk-seo': {
    kind: 'runtime',
    capabilities: ['SEO', 'structured data', 'sitemap', 'robots', 'OpenGraph'],
    prerequisites: ['@narduk-enterprises/narduk-core installed as a Nuxt module.'],
  },
  '@narduk-enterprises/narduk-shell': {
    kind: 'visual',
    capabilities: [
      'data table',
      'CSV',
      'sort',
      'pager',
      'filter bar',
      'search',
      'forms',
      'settings page',
      'KPI',
      'status badge',
      'confirm dialog',
      'empty state',
      'formatters',
    ],
    prerequisites: ['@nuxt/ui installed as a Nuxt module.'],
    demos: SHELL_DEMOS,
    setup: {
      nuxtModule: '@narduk-enterprises/narduk-shell',
      note: 'With the default `theme: true` the module adds `@narduk-enterprises/narduk-shell/theme.css` to the app itself; no stylesheet import is needed. Components, `useCollection`, `useConfirm` and `defineStatusMap` are auto-imported.',
    },
  },
  '@narduk-enterprises/narduk-tenancy': {
    kind: 'server',
    capabilities: ['organizations', 'memberships', 'roles', 'invites', 'support grants', 'D1'],
    prerequisites: ['A D1 binding and the package migrations applied.'],
    setup: { nuxtModule: '@narduk-enterprises/narduk-tenancy/nuxt' },
  },
  '@narduk-enterprises/narduk-testkit': {
    kind: 'tooling',
    capabilities: ['Vitest', 'Playwright', 'accessibility', 'UI quality', 'D1 fixtures'],
  },
  '@narduk-enterprises/narduk-timeseries': {
    kind: 'server',
    capabilities: ['TimescaleDB', 'PostGIS', 'rollups', 'retention', 'telemetry history'],
    prerequisites: ['A TimescaleDB database with the package migrations applied.'],
  },
  '@narduk-enterprises/narduk-ui': {
    kind: 'visual',
    capabilities: [
      'status tokens',
      'instruments',
      'readout',
      'freshness',
      'range bar',
      'level well',
    ],
    setup: { stylesheet: '@narduk-enterprises/narduk-ui/tokens.css' },
  },
  '@narduk-enterprises/narduk-app-tools': {
    kind: 'tooling',
    capabilities: ['migrations', 'deploy', 'foundation checks', 'assets'],
  },
  '@narduk-enterprises/narduk-uploads': {
    kind: 'runtime',
    capabilities: ['upload', 'R2', 'image delivery', 'useUpload'],
    prerequisites: ['An R2 bucket binding.'],
    setup: { nuxtModule: '@narduk-enterprises/narduk-uploads/nuxt' },
  },
  '@narduk-enterprises/status-runtime': {
    kind: 'contract',
    capabilities: ['status apps', 'build-time config'],
  },
  '@narduk-enterprises/stylelint-config': {
    kind: 'tooling',
    capabilities: ['Stylelint', 'lint budgets', 'narduk-stylelint', 'design tokens', 'z-index'],
    setup: { commands: ['narduk-stylelint'] },
  },
}
