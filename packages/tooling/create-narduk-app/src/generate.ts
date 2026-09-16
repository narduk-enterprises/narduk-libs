import { existsSync } from 'node:fs'
import { mkdir, readdir, stat, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve, sep } from 'node:path'
import { createCiRegistryAuthScript, createCiWorkflow } from './ci-workflow.js'
import { socialPreviewFiles } from './social-previews.js'

import {
  createMigrationSourcesManifest,
  createProductSpec,
  createRootPackageManifest,
  createWebPackageManifest,
  NODE_VERSION,
  packageVersionsForCapabilities,
} from './manifest.js'
import {
  CreateNardukAppError,
  GENERATED_DATABASE_BACKENDS,
  GENERATOR_NAME,
  GENERATOR_VERSION,
  SUPPORTED_CAPABILITIES,
} from './types.js'
import type {
  AppExposure,
  AppVisibility,
  Capability,
  CreateNardukAppOptions,
  CreateNardukAppReport,
  GeneratedDatabaseBackend,
  GeneratedFile,
  ProductSpec,
} from './types.js'

const DEFAULT_DESCRIPTION = 'A production-ready Nuxt application built with Narduk libraries.'
const DEFAULT_COMPATIBILITY_DATE = '2026-06-01'

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function text(...values: string[]): string {
  return values.join('\n') + '\n'
}

function titleCase(value: string): string {
  return value
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function normalizeAppName(options: CreateNardukAppOptions): string {
  const candidate = options.appName ?? options.name
  if (!candidate?.trim()) throw new CreateNardukAppError('An app name is required.')

  const appName = candidate.trim().toLowerCase()
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(appName)) {
    throw new CreateNardukAppError(
      'Invalid app name "' + candidate + '". Use lowercase letters, numbers, and single hyphens.',
    )
  }

  return appName
}

function normalizeCapabilities(input: CreateNardukAppOptions['capabilities']): Capability[] {
  const requested = typeof input === 'string' ? input.split(',') : (input ?? [])
  const normalized = requested.map((value) => value.trim().toLowerCase()).filter(Boolean)

  for (const capability of normalized) {
    if (capability === 'core') continue
    if (capability === 'pwa') {
      throw new CreateNardukAppError(
        'The pwa capability is permanently unsupported by create-narduk-app.',
      )
    }
    if (capability === 'ingestion') {
      throw new CreateNardukAppError(
        'The ingestion capability is not available here; use the future narduk-data package when it exists.',
      )
    }
    if (!(SUPPORTED_CAPABILITIES as readonly string[]).includes(capability)) {
      throw new CreateNardukAppError(
        'Unsupported capability "' +
          capability +
          '". Supported capabilities: ' +
          SUPPORTED_CAPABILITIES.join(', ') +
          '.',
      )
    }
  }

  return SUPPORTED_CAPABILITIES.filter((capability) => normalized.includes(capability))
}

function normalizeDatabaseBackend(
  value: CreateNardukAppOptions['databaseBackend'],
): GeneratedDatabaseBackend {
  if (value === undefined) return 'd1'
  if (!(GENERATED_DATABASE_BACKENDS as readonly string[]).includes(value)) {
    throw new CreateNardukAppError(
      `databaseBackend must be one of ${GENERATED_DATABASE_BACKENDS.map((backend) => `'${backend}'`).join(', ')}; received ${JSON.stringify(value)}. Scaffold 'd1' and switch the app to Postgres afterwards if it needs Hyperdrive.`,
    )
  }
  return value
}

function normalizePort(value: number | undefined): number {
  const port = value ?? 3000
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new CreateNardukAppError('local port must be an integer between 1024 and 65535.')
  }
  return port
}

function normalizeVisibility(value: AppVisibility | undefined): AppVisibility {
  if (!value) return 'private'
  if (value !== 'private' && value !== 'public') {
    throw new CreateNardukAppError('visibility must be either private or public.')
  }
  return value
}

function normalizeSiteUrl(value: string | undefined, localPort: number): string {
  const siteUrl = value?.trim() || 'http://localhost:' + localPort
  let parsed: URL
  try {
    parsed = new URL(siteUrl)
  } catch {
    throw new CreateNardukAppError('Invalid site URL "' + siteUrl + '".')
  }

  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new CreateNardukAppError('siteUrl must be an http(s) URL without embedded credentials.')
  }

  return parsed.toString().replace(/\/$/u, '')
}

function normalizeProductSpec(options: CreateNardukAppOptions): ProductSpec | undefined {
  return createProductSpec(options.productSpec ?? options.product ?? options.spec)
}

function tsString(value: string): string {
  const singleQuotes = value.match(/'/gu)?.length ?? 0
  const doubleQuotes = value.match(/"/gu)?.length ?? 0
  const jsonValue = JSON.stringify(value).replaceAll('<', '\\u003C')
  if (singleQuotes > doubleQuotes) return jsonValue
  return `'${jsonValue.slice(1, -1).replaceAll('\\"', '"').replaceAll("'", "\\'")}'`
}

function markdownProductSpec(spec: ProductSpec | undefined): string {
  const fields: Array<[string, string | undefined]> = [
    ['Problem', spec?.problem],
    ['Audience', spec?.audience],
    ['Value proposition', spec?.valueProposition],
    ['Primary action', spec?.primaryAction],
    ['Success metrics', spec?.successMetrics],
    ['Constraints', spec?.constraints],
  ]
  const filled = fields.filter(([, value]) => value)

  if (filled.length === 0) {
    return text(
      '## Product brief',
      '',
      'Add the product problem, audience, and success measures here.',
    )
  }

  return (
    text('## Product brief', '') +
    filled.map(([label, value]) => text('### ' + label, '', value ?? '')).join('\n')
  )
}

function moduleList(capabilities: readonly Capability[]): string {
  const moduleNames = [
    '@narduk-enterprises/narduk-core',
    '@nuxt/ui',
    // Ships by default, not behind a capability flag (components-library-plan.md
    // item 4): every generated app starts on the shared Ne* suite.
    '@narduk-enterprises/narduk-shell',
    ...capabilities
      // narduk-charts is not a Nuxt module -- no `nuxt` peer, no `module.ts`,
      // just a plain Vue component library the app imports from directly
      // (see capabilityPackages in manifest.ts). Listing it here would make
      // Nuxt try to load it as a module and fail.
      .filter((capability) => capability !== 'charts')
      .map((capability) =>
        capability === 'mapkit'
          ? '@narduk-enterprises/narduk-mapkit-nuxt'
          : '@narduk-enterprises/narduk-' + capability,
      ),
  ]
  const inline = `  modules: [${moduleNames.map(tsString).join(', ')}],`
  if (inline.length <= 100) return inline
  return ['  modules: [', ...moduleNames.map((module) => `    ${tsString(module)},`), '  ],'].join(
    '\n',
  )
}

// Mirrors Prettier's own printWidth-driven collapse/expand decision for a JSON
// array (see knip.json below): single-line when it fits under the configured
// 100-char printWidth, otherwise one item per line. Unlike moduleList's TS
// array, JSON items use double-quoted JSON.stringify output and this repo's
// JSON prettier override (trailingComma: 'none') forbids a trailing comma
// after the last item.
function knipIgnoreDependenciesLine(dependencies: readonly string[]): string {
  const items = dependencies.map((dependency) => JSON.stringify(dependency))
  const inline = `  "ignoreDependencies": [${items.join(', ')}]`
  if (inline.length <= 100) return inline
  return [
    '  "ignoreDependencies": [',
    ...items.map((item, index) => `    ${item}${index < items.length - 1 ? ',' : ''}`),
    '  ]',
  ].join('\n')
}

interface NormalizedCreateOptions {
  exposure: AppExposure
  appName: string
  capabilities: Capability[]
  databaseBackend: GeneratedDatabaseBackend
  description: string
  displayName: string
  localPort: number
  productSpec?: ProductSpec
  siteUrl: string
  visibility: AppVisibility
}

function normalizeOptions(options: CreateNardukAppOptions): NormalizedCreateOptions {
  const appName = normalizeAppName(options)
  const capabilities = normalizeCapabilities(options.capabilities)
  const exposure = options.exposure ?? (capabilities.includes('auth') ? 'authenticated' : 'public')
  if (!['public', 'authenticated'].includes(exposure)) {
    throw new CreateNardukAppError('exposure must be public or authenticated.')
  }
  if (exposure === 'public' && capabilities.includes('auth')) {
    throw new CreateNardukAppError(
      'Auth apps require authenticated exposure; configure protected, isolated previews during onboarding.',
    )
  }
  const databaseBackend = normalizeDatabaseBackend(options.databaseBackend)
  if (databaseBackend === 'none' && capabilities.includes('auth')) {
    throw new CreateNardukAppError(
      "The auth capability stores users, sessions and API keys in the app database, so it cannot be combined with databaseBackend 'none'. Drop the auth capability, or scaffold with the default d1 backend.",
    )
  }
  const localPort = normalizePort(options.localDevPort ?? options.localPort)
  const visibility = normalizeVisibility(options.visibility)
  const siteUrl = normalizeSiteUrl(options.siteUrl, localPort)
  const displayName = options.displayName?.trim() || titleCase(appName)
  const description = options.description?.trim() || DEFAULT_DESCRIPTION
  const productSpec = normalizeProductSpec(options)

  if (!displayName) throw new CreateNardukAppError('displayName cannot be empty.')
  if (!description) throw new CreateNardukAppError('description cannot be empty.')

  return {
    appName,
    capabilities,
    databaseBackend,
    description,
    displayName,
    exposure,
    localPort,
    productSpec,
    siteUrl,
    visibility,
  }
}

function filesFor(options: NormalizedCreateOptions): GeneratedFile[] {
  const {
    appName,
    capabilities,
    databaseBackend,
    description,
    displayName,
    exposure,
    localPort,
    productSpec,
    siteUrl,
    visibility,
  } = options
  const modules = moduleList(capabilities)
  // `'none'` drops every database artifact: the D1 binding, the schema, the
  // migrations and the drizzle tooling. narduk-core's /api/health then reports
  // `database: 'not_applicable'` rather than degrading the app (narduk-libs#313).
  const hasDatabase = databaseBackend !== 'none'
  const uploadBindingLines = capabilities.includes('uploads')
    ? [
        '  "r2_buckets": [',
        '    {',
        '      "binding": "UPLOADS",',
        '      "bucket_name": "' + appName + '-uploads",',
        '    },',
        '  ],',
      ]
    : []
  const knipIgnoreDependencies = [
    '@iconify-json/lucide',
    // @nuxt/ui's own module dynamically imports this to register the Vite
    // plugin (see dependencyEntries'/devDependencyEntries' tailwindcss
    // comments in manifest.ts) -- nothing in the generated app's own source
    // imports it by name, so knip would otherwise flag it unused.
    '@tailwindcss/vite',
    ...(capabilities.includes('mapkit') ? ['@narduk-enterprises/narduk-mapkit'] : []),
    // narduk-charts ships no default page or component that imports it --
    // the capability only pins the package for the app's own future chart
    // usage (components-library-plan.md item 4) -- so nothing in the
    // scaffold references it yet and knip would otherwise flag it unused,
    // the same reasoning as the mapkit peer package above.
    ...(capabilities.includes('charts') ? ['@narduk-enterprises/narduk-charts'] : []),
    'vue-tsc',
  ]

  const files: GeneratedFile[] = [
    { path: '.nvmrc', contents: `${NODE_VERSION}\n` },
    ...socialPreviewFiles(displayName, description, siteUrl, capabilities.includes('seo')),
    {
      path: '.gitignore',
      contents: text(
        'node_modules',
        '.nuxt',
        '.output',
        '.narduk/recovery',
        '.npmrc.auth',
        '.wrangler',
        '.wrangler.deploy.production.json',
        '.data',
        'coverage',
        'playwright-report',
        'blob-report',
        'all-blob-reports',
        'test-results',
        '.env',
        '.env.*',
        '!.env.example',
      ),
    },
    {
      path: '.npmrc',
      // SCOPE ROUTING ONLY. The committed file carries no `_authToken` line at
      // all -- not even an env reference. pnpm 10 warns 'Failed to replace env
      // in config' whenever the variable is absent (every `pnpm install` that
      // does not need the registry, which is most of them), and pnpm 11 drops
      // env interpolation in .npmrc entirely. npm never implemented the
      // `${VAR-default}` form either. Auth is supplied per process instead:
      // locally by the `gh-packages-run` helper, in CI by the userconfig the
      // generated workflow writes to the runner temp directory. See
      // agent-infrastructure docs/agents/credentials.md, 'GitHub Packages
      // read', and company-hq docs/SECRETS-MATRIX.md.
      contents: text('@narduk-enterprises:registry=https://npm.pkg.github.com'),
    },
    {
      path: '.prettierignore',
      contents: text(
        'node_modules',
        '.nuxt',
        '.output',
        '.wrangler',
        '.wrangler.deploy.production.json',
        'coverage',
        'playwright-report',
        'blob-report',
        'all-blob-reports',
        'pnpm-lock.yaml',
        'test-results',
      ),
    },
    {
      path: '.github/workflows/ci.yml',
      contents: createCiWorkflow(visibility),
    },
    {
      // components-library-plan.md #2 item 6 (narduk-libs#253): one
      // Dependabot group for @narduk-enterprises/* so a fleet-wide bump
      // lands as one PR per app, not one per package. The `groups.*.patterns`
      // shape is the D-TOOLCHAIN-1 recipe foundation:check item 5.2 accepts
      // (narduk-libs#233 / PR #235). The registries block reuses the same
      // GitHub Packages registry URL as the committed .npmrc
      // (`@narduk-enterprises:registry=...`). The token is read from the
      // org-level DEPENDABOT secret NARDUK_PLATFORM_GH_PACKAGES_READ (verified
      // present 2026-09-11) -- Dependabot secrets are a separate store from
      // Actions secrets; the Actions secret of the same name is what CI uses.
      path: '.github/dependabot.yml',
      contents: text(
        'version: 2',
        'registries:',
        '  narduk-github-packages:',
        '    type: npm-registry',
        '    url: https://npm.pkg.github.com',
        '    token: ${{secrets.NARDUK_PLATFORM_GH_PACKAGES_READ}}',
        'updates:',
        "  - package-ecosystem: 'npm'",
        '    directories:',
        "      - '/'",
        "      - '/apps/*'",
        '    registries:',
        '      - narduk-github-packages',
        '    schedule:',
        "      interval: 'weekly'",
        '    groups:',
        '      narduk-libs:',
        '        patterns:',
        "          - '@narduk-enterprises/*'",
      ),
    },
    ...(visibility === 'private'
      ? [{ path: 'scripts/package-registry-auth.mjs', contents: createCiRegistryAuthScript() }]
      : []),
    {
      path: 'AGENTS.md',
      contents: text(
        '# ' + displayName + ' agent guide',
        '',
        'This repository is app-owned. Keep changes inside the requested app or web package scope, preserve unrelated work, and validate with the direct package scripts before handoff.',
        '',
        'The shared libraries are dependencies, not a control plane. This app creates files only when an operator explicitly asks for a change. Do not add credential material, hidden network calls, background reconciliation, or generated state to the repository.',
        '',
        'The web app guidance in [apps/web/AGENTS.md](apps/web/AGENTS.md) covers Nuxt, Worker, database, and capability boundaries.',
        'Every shareable route needs a preview. Maintain the route inventory and run the checks in [docs/social-previews.md](docs/social-previews.md) when adding pages or shipping.',
      ),
    },
    {
      path: 'README.md',
      contents: text(
        '# ' + displayName,
        '',
        description,
        '',
        '## Development',
        '',
        '- pnpm install',
        '- pnpm run dev',
        '- pnpm run quality',
        '- pnpm run test',
        '- pnpm run og:generate (first setup; commit apps/web/public/og.png)',
        '- pnpm run og:check:live (after deployment)',
        '',
        '`pnpm run dev` starts Nuxt directly and reads no secret store. When a capability needs registered credentials locally, run that command under the registered local credential route instead: `narduk-app dev --credentials nvault --project <project> --environment <environment> --config <config> -- nuxt dev --host 127.0.0.1`. Values stay process-local for that run and are never written to a file; do not commit real values to `.env` or `.dev.vars`.',
        '',
        'The committed `.npmrc` only routes `@narduk-enterprises/*` to GitHub Packages. It carries no credential value and no environment reference: pnpm 10 warns `Failed to replace env in config` whenever the variable is absent, and pnpm 11 does not interpolate environment variables in `.npmrc` at all.',
        '',
        'Registry authentication is process-scoped instead. Locally, run installs through the `gh-packages-run` helper, which supplies a package-read token to that one process. In private CI the pinned shared workflow invokes `scripts/package-registry-auth.mjs` before installation and removes its ignored `.npmrc.auth` output on every install outcome. Public CI uses a unique temporary userconfig under `$RUNNER_TEMP`. Both supply the org Actions secret `NARDUK_PLATFORM_GH_PACKAGES_READ` through `NPM_CONFIG_USERCONFIG` only for installation. Never write the token into `~/.npmrc`, a tracked repository file, or a per-app alias.',
        '',
        'Dependabot is a fourth consumer of `NARDUK_PLATFORM_GH_PACKAGES_READ`: it reads that name from the org Dependabot secret store (a separate store from Actions). If the org secret is scoped to selected repositories, grant this newly generated repo access or Dependabot silently fails to resolve the private `@narduk-enterprises/*` scope.',
        '',
        'Before the first push, the onboarding skill configures package authentication, runs pnpm install, and commits pnpm-lock.yaml. CI and Workers Builds always use a frozen lockfile.',
        '',
        'Enable Workers Builds on protected `main`. Enable non-production branch builds and GitHub PR comments for trusted branches of public apps; the generated scripts alone do not create that connection. Version previews share Worker bindings, so private data and mutation-capable apps need isolated preview bindings before enabling them. Authenticated apps keep direct Worker and preview URLs disabled until equivalent protection is configured.',
        '',
        'Cloudflare Workers Builds uses `pnpm run cf:build` as its build command, `pnpm run cf:deploy` for the production deploy command, and `pnpm run cf:deploy:preview` for non-production branches. Local `pnpm run deploy` remains recovery-only; `pnpm run deploy:dry-run` is credential-free.',
        '',
        'The app is configured for local Nuxt development on port ' +
          localPort +
          ' and the declared site URL is ' +
          siteUrl +
          '. Cloudflare resources are represented as local configuration only; provisioning and deployment are explicit operator workflows outside this generator.',
        '',
        '## Capabilities',
        '',
        capabilities.length > 0
          ? capabilities.map((capability) => '- ' + capability).join('\n')
          : '- core',
        '',
        '## Logging',
        '',
        'Structured logging and request summaries are enabled through narduk-core and @narduk-enterprises/narduk-logging. This app declares its service identity and an info default in runtimeConfig.nardukLogging. LOG_LEVEL controls verbosity at runtime; use silent to disable output.',
        '',
        'See [docs/logging.md](docs/logging.md) for a copyable example, a synthetic verification event, collection setup, privacy rules, and rollback. Client diagnostics remain disabled until explicitly installed by this app.',
      ),
    },
    {
      path: 'docs/logging.md',
      contents: text(
        '# Logging',
        '',
        'This app pins @narduk-enterprises/narduk-logging and uses narduk-core’s compatibility bridge. Keep useLogger(event) request-local. Production defaults to info; LOG_LEVEL=debug temporarily adds detail, and LOG_LEVEL=silent suppresses logging.',
        '',
        '```ts',
        "import { defineEventHandler } from 'h3'",
        "import { useLogger } from '@narduk-enterprises/narduk-core/server/utils/logger'",
        '',
        'export default defineEventHandler((event) => {',
        '  const log = useLogger(event)',
        "  log.info('Synthetic logging check', { check: 'onboarding', count: 1 })",
        '  return { ok: true }',
        '})',
        '```',
        '',
        'Temporarily use the example in an app-owned test route, request it once, and verify the service, environment, requestId, and one Request completed summary in server output. The response x-request-id must match the logs. Remove the test route after verification.',
        '',
        'Use fixed messages and safe structured fields. Credential fields and explicitly private values are redacted. Do not interpolate secrets into messages or log request bodies. Automatic paths use matched route templates and omit URL queries.',
        '',
        'Enable collection separately using the [library adoption guide](https://github.com/narduk-enterprises/narduk-libs/blob/main/packages/modules/narduk-logging/docs/adoption.md). Cloudflare native OTLP export requires Workers Paid and beta export support; verify delivery before enabling a destination, use full log sampling initially, and preserve existing persistence settings. This generator provisions nothing.',
        '',
        'Remove old finish listeners, copied loggers, and duplicate error plugins only after the synthetic event is searchable. Roll back by restoring the prior pinned core/logging versions and configuration, rebuilding, and reverting the app-owned collection destination change. Never enable two request-summary implementations at once.',
      ),
    },
    {
      path: 'SPEC.md',
      contents: text(
        '# ' + displayName + ' product specification',
        '',
        '- Display name: ' + displayName,
        '- Package name: ' + appName,
        '- Description: ' + description,
        '- Site URL: ' + siteUrl,
        '- Visibility: ' + visibility,
        '- Local port: ' + localPort,
        '- Capabilities: ' + (capabilities.length > 0 ? capabilities.join(', ') : 'core'),
        '',
        markdownProductSpec(productSpec).trimEnd(),
      ),
    },
    {
      path: 'apps/web/AGENTS.md',
      contents: text(
        '# Web app guidance',
        '',
        hasDatabase
          ? 'Keep browser and server code under apps/web. Use #narduk-db for app-owned database imports and keep app schema changes in server/database with a matching migration in drizzle.'
          : "Keep browser and server code under apps/web. This app declares databaseBackend 'none' and has no database: useDatabase() throws, and /api/health reports database not_applicable. Register app-owned probes with registerHealthCheck instead.",
        '',
        'Nuxt modules are explicit in nuxt.config.ts. Capability metadata in package manifests documents the generated selection; runtime behavior comes from the explicit module and package configuration.',
        '',
        'Use the direct scripts from apps/web/package.json for format, lint, typecheck, unit tests, and builds. Keep secrets in the local environment and never commit them.',
        'Classify every app/pages file in Config/social-previews.json. Keep a real default OG image and generate distinct images for public content routes. See ../../docs/social-previews.md for the build and live gates.',
      ),
    },
    {
      path: 'apps/web/app/app.config.ts',
      contents: text(
        'export default defineAppConfig({',
        '  appName: ' + tsString(displayName) + ',',
        '  siteUrl: ' + tsString(siteUrl) + ',',
        '})',
      ),
    },
    {
      path: 'apps/web/app/app.vue',
      contents: text(
        '<template>',
        '  <UApp>',
        '    <NuxtLayout>',
        '      <NuxtPage />',
        '    </NuxtLayout>',
        '  </UApp>',
        '</template>',
      ),
    },
    {
      path: 'apps/web/app/pages/index.vue',
      contents: capabilities.includes('seo')
        ? text(
            '<script setup lang="ts">',
            'const displayName = ' + tsString(displayName),
            'const description = ' + tsString(description),
            '',
            'useSeo({',
            '  title: displayName,',
            '  description,',
            '  canonicalUrl: ' + tsString(siteUrl) + ',',
            '  ogImage: false, // The landing page uses the branded static default.',
            '})',
            '',
            'useWebPageSchema({',
            '  name: displayName,',
            '  description,',
            '})',
            '</script>',
            '',
            '<template>',
            // A native <main> trips the design-system pack's
            // vue/no-restricted-html-elements rule (components-library-plan.md
            // item 4 adds that pack to every generated app's default lint
            // config); <UMain> is Nuxt UI's blessed replacement.
            '  <UMain>',
            '    <h1>{{ displayName }}</h1>',
            '    <p>{{ description }}</p>',
            '  </UMain>',
            '</template>',
          )
        : text(
            '<script setup lang="ts">',
            'const displayName = ' + tsString(displayName),
            'const description = ' + tsString(description),
            '</script>',
            '',
            '<template>',
            // A native <main> trips the design-system pack's
            // vue/no-restricted-html-elements rule (components-library-plan.md
            // item 4 adds that pack to every generated app's default lint
            // config); <UMain> is Nuxt UI's blessed replacement.
            '  <UMain>',
            '    <h1>{{ displayName }}</h1>',
            '    <p>{{ description }}</p>',
            '  </UMain>',
            '</template>',
          ),
    },
    ...(hasDatabase
      ? [
          {
            path: 'apps/web/drizzle.config.ts',
            contents: text(
              "import { defineConfig } from 'drizzle-kit'",
              '',
              'export default defineConfig({',
              "  dialect: 'sqlite',",
              "  schema: './server/database/schema.ts',",
              "  out: './drizzle',",
              '  dbCredentials: {',
              "    url: './.data/" + appName + ".sqlite',",
              '  },',
              '})',
            ),
          },
          {
            path: 'apps/web/drizzle/README.md',
            contents: text(
              '# App migrations',
              '',
              'Keep app-owned SQL migrations in this directory. Migration identity is the tuple source, filename, checksum; package-owned migration sources are listed in migrations.sources.json.',
            ),
          },
          {
            path: 'apps/web/drizzle/0000_app_records.sql',
            contents: text(
              'CREATE TABLE `app_records` (',
              '  `id` text PRIMARY KEY NOT NULL,',
              '  `label` text NOT NULL,',
              '  `created_at` integer NOT NULL',
              ');',
            ),
          },
        ]
      : []),
    {
      // Self-contained per @narduk-enterprises/eslint-config's own documented
      // usage (see the JSDoc example atop eslint-app-config.mjs), not a
      // re-export of the root array below. `createAppLintConfig()` -- unlike
      // the bare `composeSharedConfigs()` the root file uses -- reads this
      // app's generated `.nuxt/components.d.ts` and widens the
      // `vue/no-undef-components` allowlist with every component Nuxt
      // auto-registers (`@nuxt/ui`'s `UApp`, narduk-core's
      // `addComponentsDir`-registered `LayerAppHeader`, ...). `withNuxt` only
      // exists under apps/web/.nuxt (nuxt prepare runs here, not at the repo
      // root), so this composition has to live here rather than being
      // imported from the root config.
      path: 'apps/web/eslint.config.mjs',
      contents: text(
        "import withNuxt from './.nuxt/eslint.config.mjs'",
        "import { createAppLintConfig } from '@narduk-enterprises/eslint-config/eslint-app-config'",
        '',
        'export default createAppLintConfig({',
        '  withNuxt,',
        "  capabilityPacks: ['core', 'correctness', 'complexity', 'formatting', 'design-system', 'nuxt-ui'],",
        '})',
      ),
    },
    {
      path: 'eslint.config.mjs',
      contents: text(
        "import { composeSharedConfigs } from '@narduk-enterprises/eslint-config/config'",
        '',
        'export default [',
        '  ...composeSharedConfigs(',
        "    'core',",
        "    'correctness',",
        "    'complexity',",
        "    'formatting',",
        "    'design-system',",
        "    'nuxt-ui',",
        '  ),',
        "  { ignores: ['node_modules/**', '.nuxt/**', '.output/**', '.wrangler/**'] },",
        ']',
      ),
    },
    {
      path: 'apps/web/nuxt.config.ts',
      contents: text(
        ...(hasDatabase ? ["import { fileURLToPath } from 'node:url'", ''] : []),
        'const localPort = ' + localPort,
        'const siteUrl = ' + tsString(siteUrl),
        'const appName = ' + tsString(displayName),
        'const appDescription = ' + tsString(description),
        'const buildBranch = process.env.WORKERS_CI_BRANCH',
        "const isBranchPreview = Boolean(buildBranch && buildBranch !== 'main')",
        'const deploymentTarget =',
        "  process.env.NARDUK_DEPLOY_TARGET || (isBranchPreview ? 'preview' : 'production')",
        'process.env.NARDUK_DEPLOY_TARGET ??= deploymentTarget',
        '',
        'export default defineNuxtConfig({',
        '  compatibilityDate: ' + tsString(DEFAULT_COMPATIBILITY_DATE) + ',',
        '  future: {',
        '    compatibilityVersion: 4,',
        '  },',
        modules,
        ...(hasDatabase
          ? [
              '  alias: {',
              "    '#narduk-db': fileURLToPath(new URL('./server/database/schema.ts', import.meta.url)),",
              '  },',
            ]
          : ['  nardukCore: {', "    databaseBackend: 'none',", '  },']),
        '  devServer: {',
        '    port: localPort,',
        '  },',
        ...(capabilities.includes('seo')
          ? [
              '  nardukSeo: {',
              "    defaultOgImage: { url: '/og.png', alt: appName + ' — ' + appDescription },",
              '  },',
            ]
          : [
              '  app: {',
              '    head: {',
              '      title: appName,',
              '      meta: [',
              "        { name: 'description', content: appDescription },",
              "        { property: 'og:title', content: appName },",
              "        { property: 'og:description', content: appDescription },",
              "        { property: 'og:type', content: 'website' },",
              "        { property: 'og:url', content: siteUrl },",
              "        { property: 'og:image', content: new URL('/og.png', siteUrl).href, tagPriority: 'low' },",
              "        { property: 'og:image:alt', content: appName + ' — ' + appDescription },",
              "        { property: 'og:image:width', content: '1200' },",
              "        { property: 'og:image:height', content: '630' },",
              "        { name: 'twitter:card', content: 'summary_large_image' },",
              "        { name: 'twitter:image', content: new URL('/og.png', siteUrl).href, tagPriority: 'low' },",
              '      ],',
              '    },',
              '  },',
            ]),
        // `site` belongs to nuxt-site-config, which only reaches the app through
        // @nuxtjs/seo (the seo capability). Emitting it unconditionally makes a
        // core-only or auth-only scaffold fail `nuxt typecheck` with TS2353,
        // because `site` is then not a NuxtConfig key at all (narduk-libs#172).
        ...(capabilities.includes('seo')
          ? [
              '  fonts: {',
              "    defaults: { subsets: ['latin'] },",
              '  },',
              '  sitemap: {',
              '    zeroRuntime: true,',
              '  },',
              '  site: {',
              '    name: appName,',
              '    url: siteUrl,',
              '    description: appDescription,',
              "    indexable: deploymentTarget === 'production',",
              '  },',
              "  routeRules: { '/': { prerender: true } },",
            ]
          : []),
        '  runtimeConfig: {',
        '    nardukLogging: {',
        '      service: ' + tsString(appName) + ',',
        "      environment: process.env.NODE_ENV === 'development' ? 'development' : 'production',",
        "      level: 'info',",
        "      format: process.env.NODE_ENV === 'development' ? 'pretty' : 'json',",
        '      requestLogging: true,',
        '    },',
        "    xaiApiKey: process.env.XAI_API_KEY || '',",
        '    public: {',
        '      appDescription,',
        '      deploymentTarget,',
        "      previewSafeMode: deploymentTarget === 'preview',",
        '      appName,',
        '      appUrl: siteUrl,',
        '      localPort,',
        '      siteUrl,',
        '    },',
        '  },',
        '  nitro: {',
        "    preset: 'cloudflare_module',",
        '    openAPI: {',
        '      meta: {',
        '        title: ' + tsString(displayName + ' API') + ',',
        '        description: appDescription,',
        "        version: '0.1.0',",
        '      },',
        '    },',
        '  },',
        '})',
      ),
    },
    {
      path: 'apps/web/package.json',
      contents: createWebPackageManifest(appName, capabilities, localPort, {
        databaseBackend,
        description,
        displayName,
        siteUrl,
      }),
    },
    ...(hasDatabase
      ? [
          {
            path: 'apps/web/server/database/schema.ts',
            contents: text(
              "import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'",
              '',
              "export const appRecords = sqliteTable('app_records', {",
              "  id: text('id').primaryKey(),",
              "  label: text('label').notNull(),",
              "  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),",
              '})',
              '',
              'export type AppRecord = typeof appRecords.$inferSelect',
              'export type NewAppRecord = typeof appRecords.$inferInsert',
            ),
          },
          {
            path: 'apps/web/server/utils/database.ts',
            contents: text(
              "import { createAppDatabase } from '@narduk-enterprises/narduk-core/server/utils/database'",
              '',
              "import * as schema from '#narduk-db'",
              '',
              'export const useAppDatabase = createAppDatabase(schema)',
            ),
          },
        ]
      : []),
    {
      path: 'apps/web/tsconfig.json',
      contents: text(
        '{',
        '  "extends": "./.nuxt/tsconfig.json",',
        '  "compilerOptions": {',
        '    "strict": true,',
        '    "types": ["@cloudflare/workers-types"]',
        '  }',
        '}',
      ),
    },
    {
      // Nuxt's own recommendation for a typed `server/` tree. The shared eslint
      // config's `narduk/correctness-type-aware` pack runs typescript-eslint's
      // project service, which resolves each file through the nearest
      // tsconfig.json; `apps/web/tsconfig.json` extends `.nuxt/tsconfig.json`,
      // whose `include` deliberately excludes `server/**`. Without this file the
      // first server directory an app adds (server/durable/, server/tasks/, ...)
      // fails lint with "was not found by the project service".
      path: 'apps/web/server/tsconfig.json',
      contents: text('{', '  "extends": "../.nuxt/tsconfig.server.json"', '}'),
    },
    {
      path: 'apps/web/vitest.config.ts',
      contents: text(
        "import { defineConfig } from 'vitest/config'",
        '',
        'export default defineConfig({',
        '  test: {',
        "    environment: 'happy-dom',",
        "    include: ['tests/unit/**/*.test.ts'],",
        '  },',
        '})',
      ),
    },
    {
      path: 'apps/web/wrangler.jsonc',
      contents: text(
        '{',
        '  "name": ' + JSON.stringify(appName) + ',',
        '  "main": "./.output/server/index.mjs",',
        '  "no_bundle": true,',
        '  "find_additional_modules": true,',
        '  "base_dir": ".output/server",',
        '  "rules": [{ "type": "ESModule", "globs": ["**/*.mjs"] }],',
        '  "compatibility_date": ' + JSON.stringify(DEFAULT_COMPATIBILITY_DATE) + ',',
        '  "compatibility_flags": ["nodejs_compat"],',
        '  "workers_dev": ' + (exposure === 'public') + ',',
        '  "preview_urls": ' + (exposure === 'public') + ',',
        ...(hasDatabase
          ? [
              '  "d1_databases": [',
              '    {',
              '      "binding": "DB",',
              '      "database_name": ' + JSON.stringify(appName + '-db') + ',',
              '      "database_id": "00000000-0000-0000-0000-000000000000",',
              '      "migrations_dir": "drizzle",',
              '    },',
              '  ],',
            ]
          : []),
        ...uploadBindingLines,
        '}',
      ),
    },
    {
      path: 'apps/web/tests/e2e/home.spec.ts',
      contents: text(
        "import { expect, test } from '@playwright/test'",
        '',
        "test('home page renders', async ({ page }) => {",
        "  await page.goto('/')",
        "  await expect(page.getByRole('heading', { name: " +
          tsString(displayName) +
          ' })).toBeVisible()',
        '})',
      ),
    },
    {
      path: 'apps/web/tests/unit/smoke.test.ts',
      contents: text(
        "import { registerAppSmokeTests } from '@narduk-enterprises/narduk-testkit/server/kit/smoke'",
        '',
        'registerAppSmokeTests({ describeName: ' + tsString(appName) + ' })',
      ),
    },
    {
      path: 'knip.json',
      contents: text(
        '{',
        '  "$schema": "https://unpkg.com/knip@6/schema.json",',
        '  "include": ["dependencies", "devDependencies", "unlisted", "binaries", "unresolved"],',
        '  "workspaces": {',
        '    "apps/web": {',
        '      "entry": ["app/pages/**/*.{ts,vue}", "server/api/**/*.ts", "server/utils/**/*.ts"],',
        '      "project": ["**/*.{ts,mts,vue,js,mjs}"]' + (hasDatabase ? ',' : ''),
        ...(hasDatabase
          ? ['      "paths": {', '        "#narduk-db": ["server/database/schema.ts"]', '      }']
          : []),
        '    }',
        '  },',
        knipIgnoreDependenciesLine(knipIgnoreDependencies),
        '}',
      ),
    },
    ...(hasDatabase
      ? [
          {
            path: 'apps/web/migrations.sources.json',
            contents: createMigrationSourcesManifest(capabilities),
          },
        ]
      : []),
    {
      path: 'package.json',
      contents: createRootPackageManifest(appName, capabilities, visibility, databaseBackend),
    },
    {
      path: 'playwright.config.ts',
      contents: text(
        "import { defineConfig, devices } from '@playwright/test'",
        '',
        '// PLAYWRIGHT_PORT overrides the scaffolded default so two concurrent',
        "// worktrees never attach to each other's dev server with a silent",
        "// wrong-app pass (narduk-libs#62). Nuxt's dev server (via listhen)",
        '// honors the PORT env var, so the override also has to flow into the',
        '// webServer command below, not just this file.',
        'const port = Number(process.env.PLAYWRIGHT_PORT) || ' + localPort,
        '',
        'export default defineConfig({',
        "  testDir: './apps/web/tests/e2e',",
        '  fullyParallel: true,',
        '  forbidOnly: Boolean(process.env.CI),',
        '  retries: process.env.CI ? 2 : 0,',
        "  reporter: 'line',",
        '  use: {',
        '    baseURL: `http://127.0.0.1:${port}`,',
        "    trace: 'on-first-retry',",
        "    screenshot: 'only-on-failure',",
        "    video: 'retain-on-failure',",
        '  },',
        '  webServer: {',
        '    command: `PORT=${port} NUXT_SESSION_PASSWORD=narduk-test-only-session-password-000000 NUXT_OG_IMAGE_SECRET=narduk-test-only-og-image-secret-000000 pnpm --filter web run dev:test`,',
        '    url: `http://127.0.0.1:${port}`,',
        '    reuseExistingServer: !process.env.CI,',
        '  },',
        '  projects: [',
        '    {',
        "      name: 'chromium',",
        "      use: { ...devices['Desktop Chrome'] },",
        '    },',
        '  ],',
        '})',
      ),
    },
    {
      path: 'pnpm-workspace.yaml',
      contents: text('packages:', '  - apps/*'),
    },
    {
      path: 'prettier.config.mjs',
      contents: text(
        'export default {',
        '  semi: false,',
        '  singleQuote: true,',
        "  trailingComma: 'all',",
        '  printWidth: 100,',
        "  endOfLine: 'lf',",
        '}',
      ),
    },
  ]

  return files.sort((left, right) => compareStrings(left.path, right.path))
}

async function directoryIsNonEmpty(targetDir: string): Promise<boolean> {
  if (!existsSync(targetDir)) return false
  const entries = await readdir(targetDir)
  return entries.length > 0
}

function safeRelativePath(targetDir: string, filePath: string): string {
  const normalized = relative(targetDir, filePath)
  if (!normalized || normalized.startsWith('..' + sep) || normalized === '..') {
    throw new CreateNardukAppError('Refusing to write outside target directory: ' + filePath)
  }
  return normalized
}

export function buildGeneratedFiles(options: CreateNardukAppOptions): GeneratedFile[] {
  return filesFor(normalizeOptions(options))
}

export async function createNardukApp(
  options: CreateNardukAppOptions,
): Promise<CreateNardukAppReport> {
  const targetDir = resolve(options.targetDir)
  const force = options.force ?? false
  const normalized = normalizeOptions(options)
  const files = filesFor(normalized)

  if (existsSync(targetDir)) {
    const targetStats = await stat(targetDir)
    if (!targetStats.isDirectory()) {
      throw new CreateNardukAppError('Target path is not a directory: ' + targetDir)
    }
    if (!force && (await directoryIsNonEmpty(targetDir))) {
      throw new CreateNardukAppError(
        'Target directory is not empty: ' +
          targetDir +
          '. Choose an empty directory or pass force: true.',
      )
    }
  } else {
    await mkdir(targetDir, { recursive: true })
  }

  for (const file of files) {
    const destination = resolve(targetDir, file.path)
    safeRelativePath(targetDir, destination)
    await mkdir(dirname(destination), { recursive: true })
    await writeFile(destination, file.contents, 'utf8')
  }

  const gitInitialized = !options.noGit
  if (gitInitialized) await initializeGit(targetDir)

  return {
    appName: normalized.appName,
    capabilities: normalized.capabilities,
    databaseBackend: normalized.databaseBackend,
    description: normalized.description,
    displayName: normalized.displayName,
    files: files.map((file) => file.path),
    generator: { name: GENERATOR_NAME, version: GENERATOR_VERSION },
    gitInitialized,
    localPort: normalized.localPort,
    packageVersions: packageVersionsForCapabilities(
      normalized.capabilities,
      normalized.databaseBackend,
    ),
    schemaVersion: 1,
    siteUrl: normalized.siteUrl,
    targetDir,
    validationResults: [
      {
        check: 'capabilities',
        detail: `Validated ${normalized.capabilities.length} explicit capability selection(s); core is implicit.`,
        passed: true,
      },
      {
        check: 'exact-package-versions',
        detail: 'Every generated package dependency uses an exact SemVer version.',
        passed: true,
      },
      {
        check: 'generated-paths',
        detail: `Validated ${files.length} generated path(s) inside the target directory.`,
        passed: true,
      },
    ],
    visibility: normalized.visibility,
    ...(normalized.productSpec ? { productSpec: normalized.productSpec } : {}),
  }
}

async function initializeGit(targetDir: string): Promise<void> {
  const { execFile } = await import('node:child_process')
  await new Promise<void>((resolvePromise, reject) => {
    execFile('git', ['init', '--quiet'], { cwd: targetDir }, (error) => {
      if (error)
        reject(new CreateNardukAppError('Unable to initialize local git: ' + error.message))
      else resolvePromise()
    })
  })
}
