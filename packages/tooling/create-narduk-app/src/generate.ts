import { existsSync } from 'node:fs'
import { mkdir, readdir, stat, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve, sep } from 'node:path'
import {
  createCiRegistryAuthScript,
  createCiWorkflow,
  createCopilotSetupWorkflow,
} from './ci-workflow.js'
import { NODE_SOURCE_FILE, REGION_MARKERS } from './ownership.js'
import { socialPreviewFiles } from './social-previews.js'

import {
  createMigrationSourcesManifest,
  createProductSpec,
  createRootPackageManifest,
  createWebPackageManifest,
  NODE_VERSION,
  packageVersionsForCapabilities,
  PNPM_VERSION,
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

/**
 * The `deployment` block a generated app is told to paste into
 * `Config/cloudflare-app.json`, serialized rather than hand-typed.
 *
 * This is the same object `defaultDeploymentBlock()` in
 * `@narduk-enterprises/narduk-app-tools` returns, and the generator test pins it
 * to that function and runs the emitted text through `readDeploymentBlock`. It
 * is duplicated here rather than imported because `narduk-app-tools` is a
 * development dependency of this generator, not a runtime one -- a published
 * `create-narduk-app` must not require it. The test is what keeps the copy
 * honest: add a required key to the schema and this block stops validating, in
 * CI, instead of in the first app that pastes it.
 */
export function defaultDeploymentBlockFor(appName: string): Record<string, unknown> {
  return {
    standard: 'narduk-v1',
    builder: 'workers-builds',
    productionBranch: 'main',
    productionDeployCommand: 'narduk-app deploy versions-upload',
    nonProductionDeployCommand: 'narduk-app deploy versions-upload',
    nonProductionBranchBuilds: false,
    promotion: {
      mode: 'auto-on-green',
      gateCheck: 'ci / Required',
      credential: 'cloudflare/prd/narduk-enterprises-' + appName + '-promote',
    },
    liveProof: {
      buildVersionHeader: 'x-build-version',
      healthPath: '/api/health',
      smokePath: '/',
      attempts: 6,
      intervalSeconds: 10,
    },
    rollback: { mode: 'auto', alert: 'resend' },
    staging: { enabled: false },
    previewBindings: { d1: [], kv: [], r2: [] },
  }
}

/** The block above as the lines of a `"deployment": { ... }` runbook fragment. */
export function deploymentBlockLines(appName: string): string[] {
  const body = JSON.stringify(defaultDeploymentBlockFor(appName), null, 2)
  return ('"deployment": ' + body).split('\n')
}

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
    // NOT '@nuxt/ui': narduk-core's own setup already calls
    // installModule('@nuxt/ui') internally (see its module.ts), so a second,
    // explicit registration here is redundant -- confirmed against the
    // reference app, whose modules array omits it for the same reason
    // (generator-parity audit, narduk-libs#D2).
    //
    // '@nuxt/icon' IS explicit, though -- this is not redundant. Verified
    // live: a build with @nuxt/icon only reachable through @nuxt/ui's own
    // nested installModule('@nuxt/icon') call (i.e. omitted here, matching
    // the mistaken assumption that narduk-core -> @nuxt/ui -> @nuxt/icon
    // already covers it) fails with `[UNLOADABLE_DEPENDENCY] Could not load
    // .nuxt/nuxt-icon-client-bundle` -- the nested install does not finish
    // registering the icon client-bundle virtual file in time for the build
    // step that consumes it. Listing '@nuxt/icon' explicitly here (matching
    // the reference app's own modules array exactly) fixes it.
    '@nuxt/icon',
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
  // nitro-cloudflare-dev provides local Wrangler binding emulation
  // (KV/D1/R2/queues, etc.) under `nuxt dev`; the actual Cloudflare build
  // never loads it. Emitted as a raw (unquoted) spread referencing the
  // `isCloudflareBuild` const declared above in the same generated file --
  // matches the reference app's own modules array entry exactly.
  const items = [
    ...moduleNames.map((module) => tsString(module)),
    "...(isCloudflareBuild ? [] : ['nitro-cloudflare-dev'])",
  ]
  const inline = `  modules: [${items.join(', ')}],`
  if (inline.length <= 100) return inline
  return ['  modules: [', ...items.map((item) => `    ${item},`), '  ],'].join('\n')
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
    // The app's declared Node source, and the ONLY file that carries the Node
    // version as a literal outside package.json's engines/volta mirrors (which
    // Volta and npm can read from nowhere else). Both workflows below point at
    // this path rather than restating its value. See ownership.ts's
    // NODE_SOURCE_FILE for why there is no `.nvmrc` beside it and why the
    // upgrade codemod deliberately does not manage this file.
    { path: NODE_SOURCE_FILE, contents: `${NODE_VERSION}\n` },
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
      // Both visibilities: even a public app's Worker depends on private
      // @narduk-enterprises/* packages, so Copilot's sandbox needs registry
      // auth to install regardless of which CI runner policy this app uses.
      path: '.github/workflows/copilot-setup-steps.yml',
      contents: createCopilotSetupWorkflow(),
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
      // Matches the reference app's live shape (company-hq D-TOOLCHAIN-1,
      // coding-standards/toolchain/dependabot.yml), not the older canonical
      // template: `scope` is FUNCTIONALLY REQUIRED, not decorative --
      // without it Dependabot's npm_and_yarn update aborts outright the
      // moment the repo carries any @narduk-enterprises/* dependency, which
      // every generated app does (coding-standards#9, A/B-proven across
      // three repos 2026-09-10). `directory: "/"` (singular) also matches
      // the reference app: Dependabot's npm ecosystem parses the whole pnpm
      // workspace graph from the root manifest, so the array-of-directories
      // form this template previously emitted was redundant, not additive.
      // Cooldown is disabled (default-days/semver-major-days: 0) and
      // @narduk-enterprises/* is listed only in the (inert while disabled)
      // `exclude` array -- company-hq#737, confirmed root cause: Dependabot's
      // pnpm updater does not propagate `cooldown.exclude` into
      // `minimumReleaseAgeExclude` for the wider recursive resolve, so any
      // nonzero cooldown here makes every non-excluded dependency fail on
      // every run given how often @narduk-enterprises/* publishes.
      contents: text(
        'version: 2',
        'registries:',
        '  narduk-github-packages:',
        '    type: npm-registry',
        '    url: https://npm.pkg.github.com',
        '    token: ${{secrets.NARDUK_PLATFORM_GH_PACKAGES_READ}}',
        "    scope: '@narduk-enterprises'",
        'updates:',
        "  - package-ecosystem: 'npm'",
        "    directory: '/'",
        '    registries:',
        '      - narduk-github-packages',
        '    schedule:',
        "      interval: 'weekly'",
        "      day: 'monday'",
        "      time: '06:00'",
        "      timezone: 'America/Chicago'",
        '    labels:',
        "      - 'dependencies'",
        '    open-pull-requests-limit: 1',
        '    cooldown:',
        '      default-days: 0',
        '      semver-major-days: 0',
        '      exclude:',
        "        - '@narduk-enterprises/*'",
        '    ignore:',
        "      - dependency-name: 'typescript'",
        "        versions: ['>=6.1.0']",
        "      - dependency-name: '@types/node'",
        "        versions: ['>=25.0.0']",
        "      - dependency-name: '@playwright/test'",
        "        versions: ['>1.61.1']",
        '    groups:',
        '      dependencies:',
        '        patterns:',
        "          - '*'",
        "          - '@narduk-enterprises/*' # explicit scope required by foundation item 5.2",
        "  - package-ecosystem: 'github-actions'",
        "    directory: '/'",
        '    schedule:',
        "      interval: 'weekly'",
        "      day: 'monday'",
        "      time: '06:00'",
        "      timezone: 'America/Chicago'",
        '    labels:',
        "      - 'dependencies'",
        '    open-pull-requests-limit: 1',
        '    groups:',
        '      github-actions:',
        '        patterns:',
        "          - '*'",
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
        // The router block is the one generator-owned region of an otherwise
        // app-owned file: `create-narduk-app upgrade` refreshes what sits
        // between these markers and never reads a byte outside them. An app
        // that deletes the markers keeps the text and opts out of the
        // refresh; see the README's ownership table.
        REGION_MARKERS.agentsRouter.start,
        '',
        'The web app guidance in [apps/web/AGENTS.md](apps/web/AGENTS.md) covers Nuxt, Worker, database, and capability boundaries. [CONTRACT.md](CONTRACT.md) is the API surface this app promises to callers, kept current whenever a route changes. [docs/workers-builds.md](docs/workers-builds.md) covers deployment and recovery. [docs/e2e-testing.md](docs/e2e-testing.md) covers the Playwright layout and the visual QA toolkit.',
        'Every shareable route needs a preview. Maintain the route inventory and run the checks in [docs/social-previews.md](docs/social-previews.md) when adding pages or shipping.',
        '',
        REGION_MARKERS.agentsRouter.end,
      ),
    },
    {
      // A generic skeleton, not the reference app's own filled-in shape:
      // every real endpoint, response envelope, and error contract below is
      // this specific app's future API surface, which the generator cannot
      // know in advance. What IS generic -- the health contract, that there
      // is no database when databaseBackend is 'none', and the section
      // headings an app-owning agent should fill in -- is filled in for real.
      path: 'CONTRACT.md',
      contents: text(
        '---',
        'Status: draft',
        'Owner: apps/web',
        '---',
        '',
        '# API Contract',
        '',
        'Keep this file current whenever a route under `apps/web/server/api/` changes shape. It is the promise this app makes to callers -- update it in the same PR as the route, not after.',
        '',
        '## Health',
        '',
        "`GET /api/health` is narduk-core's shared route." +
          (hasDatabase
            ? ' A required database check reports connectivity through the configured D1 binding.'
            : ' This app declares `databaseBackend: \'none\'`, so the shared report returns `data.database: "not_applicable"` and probes no database.'),
        'Register any app-owned probe (an upstream API, a published data source, ...) with `registerHealthCheck` from `@narduk-enterprises/narduk-core/server/utils/health-checks` rather than adding an ad hoc route. An available app yields `data.status: "ok"` and HTTP 200; a failed required check yields `data.status: "error"` and HTTP 503; an optional failure is `degraded` at HTTP 200. Every health response uses `Cache-Control: no-store`.',
        '',
        '## Endpoints',
        '',
        '| Method | Path          | Purpose                          |',
        '| ------ | ------------- | -------------------------------- |',
        '| GET    | `/api/health` | Narduk-core shared health report |',
        '',
        'Add a row per route as the app grows. Note which methods mutate state, if any.',
        '',
        '## Request and response shapes',
        '',
        "Document each route's query/body schema and response shape here, or point at the source-of-truth types file once one exists (`apps/web/app/utils/*Types.ts` is the estate convention).",
        '',
        '## Errors',
        '',
        "Use H3's standard `createError({ statusCode, statusMessage, message, data? })` shape unless this app has a documented reason to layer a different envelope on top. Keep the real error detail server-side (`console.error`) and return only safe, fixed copy in `message`.",
        '',
        '## Auth',
        '',
        capabilities.includes('auth')
          ? 'This app includes the auth capability (@narduk-enterprises/narduk-auth). Document which routes require a session and which scopes/roles they require.'
          : 'Strategy: none by default. Every route is public and unauthenticated until this app adopts the auth capability.',
        '',
        '## Rate limits',
        '',
        'None by default. Document any per-route limiting this app adds.',
        '',
        '## Idempotency',
        '',
        'Document idempotency behavior for any mutating (`POST`/`PUT`/`PATCH`/`DELETE`) route once one exists.',
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
        '',
        '## Error page and exception capture',
        '',
        'The branded error page and client/server exception capture come from narduk-core. This app owns no error.vue and no error listeners: pinning narduk-core is the whole of the adoption.',
        '',
        'See [docs/error-page.md](docs/error-page.md) for what the page shows, where exceptions are reported, and how to override the page if this app ever needs its own.',
      ),
    },
    {
      path: 'docs/error-page.md',
      contents: text(
        '# Error page and exception capture',
        '',
        'narduk-core supplies both. It sets Nuxt’s `app.errorComponent` from the `app:resolve` hook whenever the app has not provided one, so the estate error page renders for every unhandled error with no file in this repository.',
        '',
        '## What the page shows',
        '',
        'Status code and plain-language copy for the outcome, a Go Home and a Try Again action, `noindex, nofollow`, and the request id. The request id is the same value the `x-request-id` response header carries and the same one every narduk-logging server record is keyed by, so a user reading it off the page hands support the key that finds the log line. The raw error message is shown only where `previewSafeMode` is on — preview and staging — never to production traffic.',
        '',
        'E2E selectors: `[data-testid="error-page"]`, `error-page-status`, `error-page-title`, `error-page-description`, `error-page-request-id`, `error-page-home`, `error-page-retry`, `error-page-detail`.',
        '',
        '## Where exceptions go',
        '',
        'narduk-core captures Vue component errors, fatal app errors, and every error Nitro announces, and publishes one report each on the `narduk:exception` hook. Reports carry the route pattern (never a raw path), the build version, the request id and the status code, with query strings and email addresses redacted out of the message.',
        '',
        'Server errors are already recorded by narduk-logging as the request summary — one record per failing request, no duplicate. With the analytics capability, narduk-analytics subscribes PostHog to the same hook and reports client exceptions through `posthog.captureException`, which is suppressed under preview safe mode, on localhost, with analytics off, and for a visitor who has opted out.',
        '',
        'To add a destination, subscribe rather than adding a second listener:',
        '',
        '```ts',
        "import { onNardukException } from '@narduk-enterprises/narduk-core/shared/exception-report'",
        "import { defineNuxtPlugin } from '#imports'",
        '',
        'export default defineNuxtPlugin({',
        "  name: 'app-exception-reporter',",
        '  setup(nuxtApp) {',
        '    onNardukException(nuxtApp as never, (report) => {',
        '      // report.route, report.requestId, report.statusCode, report.buildVersion',
        '    })',
        '  },',
        '})',
        '```',
        '',
        '## Overriding the page',
        '',
        "Add `apps/web/app/error.vue`. Nuxt resolves an app-owned error page before the module hook runs, so the app file wins with no configuration. To keep the estate page and wrap it, re-export it: `export { default } from '@narduk-enterprises/narduk-core/app/error-page'`.",
        '',
        'Prefer changing narduk-core over forking the page here. An app-local copy stops receiving estate fixes.',
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
      // Cloudflare connection settings are the same for every generated app
      // (build/deploy commands, Node/pnpm versions, the build secret name);
      // the provider connection itself, credential routes, and any live
      // verification evidence are onboarding's job -- see the TODO markers
      // below and README's Config/ charter for why this generator does not
      // fabricate them.
      path: 'docs/workers-builds.md',
      contents: text(
        '# ' + displayName + ' deployments and PR previews',
        '',
        '**Cloudflare builds. GitHub promotes. Production is a promotion, never a push.** Workers Builds runs on every branch and _uploads a Worker version that serves no traffic_; a GitHub Actions job deploys one of those versions at 100% only after the required check is green on that exact commit, then proves it live. Protected `main` is the production branch. Local Wrangler is reserved for explicitly authorized recovery.',
        '',
        '## Cloudflare connection',
        '',
        'Connect this repository to a Cloudflare Worker. These are provider settings, not settings Wrangler creates automatically -- an onboarding step, not something this generator can configure from a checkout alone.',
        '',
        '| Setting                       | Value                                                 |',
        '| ----------------------------- | ----------------------------------------------------- |',
        '| Root directory                | `/`                                                   |',
        '| Production branch             | `main`                                                |',
        '| Build command                 | `pnpm run cf:build`                                   |',
        '| Production deploy command     | `pnpm run cf:deploy:preview`                          |',
        '| Non-production deploy command | `pnpm run cf:deploy:preview`                          |',
        '| Non-production branch builds  | disabled until preview bindings exist (see below)     |',
        '| Build cache                   | enabled                                               |',
        '| `NODE_VERSION`                | `' +
          NODE_VERSION +
          '`                                             |',
        '| `PNPM_VERSION`                | `' +
          PNPM_VERSION +
          '`                                             |',
        '| `SKIP_DEPENDENCY_INSTALL`     | `1`                                                   |',
        '| Build secret                  | `GH_PACKAGES_READ` (read-only private package access) |',
        '',
        "The build command authenticates before installing the frozen workspace lockfile, then builds the Cloudflare module artifact. Skipping Cloudflare's initial install avoids a private-package failure before authentication can run. Build secrets are separate from runtime Worker secrets. `NARDUK_PLATFORM_GH_PACKAGES_READ` remains the org Actions secret name; Workers Builds receives `GH_PACKAGES_READ`.",
        '',
        'Both deploy commands are the same command on purpose. `cf:deploy:preview` runs `narduk-app deploy versions-upload`, which uploads a version and changes no traffic; the name is historical. Setting the _production_ deploy command to anything that deploys would put a `main` push straight into production and defeat the standard. The separate `cf:deploy` script stays for authorized recovery only.',
        '',
        '## The deployment standard',
        '',
        'This app declares its half of the standard in `Config/cloudflare-app.json`. That file is created during onboarding -- this generator does not write it, because the rest of it records live Cloudflare facts a checkout cannot know. Add this block to it verbatim, then run `pnpm run foundation:deployment`:',
        '',
        '```jsonc',
        ...deploymentBlockLines(appName),
        '```',
        '',
        '`narduk-app foundation:check:deployment` checks that block against the standard. It reads this repository only: it cannot see the deploy commands actually configured on the Workers Builds connection, so a green check here is not a green deployment. Until this app adopts the block the check reports `NOT ADOPTED` and exits 0.',
        '',
        '## Promotion, live proof and rollback',
        '',
        'The promote job resolves the version Workers Builds uploaded for the merged commit, deploys it at 100%, and then proves it:',
        '',
        '```sh',
        'narduk-app deploy versions-promote --sha "$GITHUB_SHA" --json',
        'narduk-app verify --live https://<hostname> --expect-sha "$GITHUB_SHA"',
        'narduk-app deploy rollback --to "<previousVersionId>"   # only if the proof fails',
        '```',
        '',
        'The commit-to-version link is made at upload time, not discovered: inside a Workers Build, `narduk-app deploy versions-upload` stamps the build commit as the version tag, and `versions-promote` reads it back. `versions-promote` refuses to run outside GitHub Actions unless `NARDUK_ALLOW_MANUAL_PROMOTE=1` is set for a recovery.',
        '',
        'Workers Builds requires user-owned authentication -- register least-privilege build-control and build-execution credentials for this app (see the estate credentials doc) rather than reusing a shared or personal token. TODO(onboarding): fill in the registered nVault config paths and Cloudflare connection/trigger IDs once this app is connected.',
        '',
        '## Preview boundaries',
        '',
        "Version previews share the Worker's runtime bindings; they are **not isolated staging**. A version captures its binding _configuration_, but the state behind D1, KV and R2 is not versioned, and `preview_database_id` / `preview_id` / `preview_bucket_name` apply to `wrangler dev` only -- they do nothing for a Workers Builds preview. So a branch build of an app that binds production D1, KV or R2 reads and writes production data from every pull request. That is why `nonProductionBranchBuilds` starts `false`: turn it on only after creating a preview resource for each of those bindings and listing them under `deployment.previewBindings`. `foundation:check:deployment` refuses the combination. Only trusted repository branches should run with the Builds execution credential. Do not add an untrusted-fork build path." +
          (visibility === 'public'
            ? ' An app with private customer data, writes, or a separate authentication boundary needs an isolated, equivalently protected preview Worker and bindings before adopting public previews.'
            : ''),
        '',
        '## Recovery and live proof',
        '',
        'From a clean, validated revision, install with `gh-packages-run pnpm install --frozen-lockfile`, then run `pnpm run build:ci`. Deploy with the registered recovery credential once onboarding creates it:',
        '',
        '```sh',
        'nvault run -p cloudflare -e prd -c ' + appName + '-deploy -- \\',
        '  env NARDUK_ALLOW_LOCAL_WRANGLER_DEPLOY=1 pnpm run deploy',
        '```',
        '',
        'The lower-level deploy command preserves existing runtime vars and secrets. Cloudflare owns Worker-version rollback.',
        '',
        '## Provider evidence',
        '',
        'TODO(onboarding): record the GitHub connection id, production trigger id, and non-production trigger id once this app is connected, so a later audit can verify them against the live Cloudflare dashboard without re-deriving them.',
      ),
    },
    {
      // Describes THIS generator's actual current e2e layout, not the
      // reference app's own doc verbatim -- its copy still references
      // .template-reference (a retired concept this generator never
      // emits -- see the forbidden-artifacts test) and a scripts/run-web-e2e.mjs
      // wrapper this generator's simpler `playwright test` invocation does
      // not need (generator-parity audit, narduk-libs#D2).
      path: 'docs/e2e-testing.md',
      contents: text(
        '# E2E Testing',
        '',
        '## Layout',
        '',
        '- `playwright.config.ts` defines a `setup` project (runs once, see `global.setup.ts`) and a `chromium` project that depends on it.',
        '- `apps/web/tests/e2e/fixtures.ts` re-exports the shared readiness and hydration helpers from `@narduk-enterprises/narduk-testkit/e2e/fixtures` -- import from this local file, not the package directly, so a future fixture addition only touches one file.',
        "- `apps/web/tests/e2e/global.setup.ts` is the `setup` project: it waits for the base URL, asserts `/api/health` reports a healthy status (an unmigrated database's auth-tables check is tolerated as `degraded`, never a hard failure), and warms the app before any other spec runs.",
        '- `apps/web/tests/e2e/home.spec.ts` is the starter smoke spec.',
        '- `apps/web/tests/e2e/visual-audit.spec.ts` captures the starter route across representative viewports using the shared UI-quality toolkit (see below) and asserts a clean browser console.',
        '',
        REGION_MARKERS.e2eFlakePolicy.start,
        '',
        '## Flake policy',
        '',
        'A flaky test cannot report green.',
        '',
        '- `retries`: 1 in CI, 0 locally. One retry, not two -- a second retry buys almost nothing once a flaky result cannot pass, and it triples the cost of a genuinely broken test before the gate says so.',
        "- `trace: 'on-first-retry'`, so the one retry is the one that carries a trace into the uploaded evidence.",
        '- `failOnFlakyTests`: enabled for push/default-branch runs, disabled on pull requests. A test that fails and then passes on its retry FAILS a default-branch run. Pull requests keep the retry as a cheap defence against browser-pool noise; the merge is where the suite has to be believed.',
        '',
        'The tier is resolved from `GITHUB_EVENT_NAME` and the branch is fail-closed: anything not recognisably a pull-request event, including an unset variable, takes the strict path. Every run prints the policy it resolved (`[e2e] flake policy: ...`) -- read that line rather than inferring which policy a run used.',
        '',
        '### Quarantine convention',
        '',
        'When a test is genuinely flaky and cannot be fixed in the same change, take it out of the gate explicitly instead of letting a retry hide it:',
        '',
        '```ts',
        "test.fixme(<condition>, '<repo>#<issue> -- <YYYY-MM-DD> -- <owner>')",
        '```',
        '',
        '- `<condition>` is `true` for an unconditionally quarantined test, or the exact environment predicate when the flake is confined to one mode.',
        '- The description carries the issue link, the date it was quarantined, and the owner, in that order. A quarantine with no issue is not a quarantine, it is a deleted test with extra steps.',
        '- `test.fixme` and not `test.skip`: `fixme` states that the test is expected to fail and is waiting on a fix, which is what a quarantine is. `test.skip` is for a case that legitimately does not apply in this environment.',
        '',
        "To leave quarantine: fix the defect, delete the `test.fixme` line, and let the change's own CI prove it. `failOnFlakyTests` on the merge to the default branch is what proves stability, because a pass that needed the retry still fails there. Close the issue with that run as the evidence.",
        '',
        REGION_MARKERS.e2eFlakePolicy.end,
        '',
        '## How to extend coverage',
        '',
        '1. Import fixtures from the local `tests/e2e/fixtures.ts`, not the package directly.',
        '2. Keep `global.setup.ts` as the readiness gate unless the app intentionally replaces it.',
        '3. Add local specs for product-specific flows as routes and features ship.',
        "4. Add a route to `visual-audit.spec.ts`'s `representativeRoutes()` for every key page the app ships.",
        '5. Promote reusable readiness or capture helpers back into narduk-testkit instead of copying them across apps.',
        '',
        '## Visual site QA',
        '',
        'This app shares the visual QA capture toolkit through `@narduk-enterprises/narduk-testkit/playwright/ui-quality`:',
        '',
        '- `prepareUiQualityRoot(...)` resets `output/playwright/visual-audit`',
        '- `captureFullPageAudit(...)` captures full-page screenshots',
        '- `captureNamedLocator(...)` captures focused UI elements',
        '- `createConsoleTracker(...)` records console warnings and page errors; `visual-audit.spec.ts` asserts it stays clean with `expectClean()`',
        '- `writeUiQualityManifest(...)` records the route/element manifest',
        '',
        'The artifact convention is `output/playwright/visual-audit`. Screenshots and manifests are generated artifacts and must not be committed.',
        '',
        '## Running tests',
        '',
        '- Full suite against `nuxt dev`: `pnpm run test:e2e`',
        '- Prebuilt Worker (what the shared `nuxt-cloudflare` callable runs): `E2E_PREBUILT_ARTIFACT=1 pnpm run test:e2e` after `pnpm run build:ci`.',
        '  That path starts `narduk-app e2e-serve <port>` against `.output/server/index.mjs`. There is no compile fallback -- a missing artifact fails immediately.',
        "  The launcher binds 127.0.0.1 only and writes `[e2e-serve]` startup notes to stderr so a stalled start is visible in Playwright's webServer log.",
        '- Visual audit only: `pnpm exec playwright test tests/e2e/visual-audit.spec.ts --project=chromium`',
        '',
        '## workerd client-abort `Broken pipe` noise',
        '',
        'A multi-route `page.goto` aborts in-flight Worker responses. workerd logs that as this multiline block (Playwright prefixes each copied stderr line with `[WebServer]`):',
        '',
        '```text',
        '✘ [ERROR] kj::getCaughtExceptionAsKj() = kj/async-io-unix.c++…: disconnected: ::write(…): Broken pipe',
        '  stack: …workerd@…',
        '```',
        '',
        'That is client-abort noise, not an app failure. `narduk-app e2e-serve` filters exactly that block on `process.stderr.write`. The `[e2e-serve] cwd=… / ready on …` startup notes still pass through. A following `ECONNREFUSED` is the real crash ([cloudflare/workers-sdk#15202](https://github.com/cloudflare/workers-sdk/issues/15202)).',
        '',
        '## Agent expectations',
        '',
        'When adding or changing features:',
        '',
        '- add unit tests for core logic where appropriate',
        '- add E2E coverage for critical user-visible flows',
        '- keep tests robust enough to run against both local and deployed environments when practical',
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
        "import { fileURLToPath } from 'node:url'",
        '',
        'const localPort = ' + localPort,
        'const siteUrl = ' + tsString(siteUrl),
        'const appName = ' + tsString(displayName),
        'const appDescription = ' + tsString(description),
        'const buildBranch = process.env.WORKERS_CI_BRANCH',
        "const isBranchPreview = Boolean(buildBranch && buildBranch !== 'main')",
        'const deploymentTarget =',
        "  process.env.NARDUK_DEPLOY_TARGET || (isBranchPreview ? 'preview' : 'production')",
        'process.env.NARDUK_DEPLOY_TARGET ??= deploymentTarget',
        // Gates the local-only nitro-cloudflare-dev module (see moduleList)
        // and the nitro.cloudflareDev binding-emulation block below.
        // build:ci is the only script that sets this; local `nuxt dev` and
        // `nuxt build` (without it) both keep the dev emulation on -- matches
        // the reference app's own const exactly.
        "const isCloudflareBuild = process.env.NARDUK_CLOUDFLARE_BUILD === '1'",
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
        // Local Wrangler binding emulation for `nuxt dev` (nitro-cloudflare-dev,
        // gated in moduleList above). `preset` stays a literal either way --
        // foundation:check item 1.1 reads it straight from source, so it
        // must not become conditional on isCloudflareBuild the way the
        // reference app's own (preset-less) config forces it to resolve
        // preset from NITRO_PRESET/`.output/nitro.json` instead.
        '    ...(isCloudflareBuild',
        '      ? {}',
        '      : {',
        '          cloudflareDev: {',
        "            configPath: fileURLToPath(new URL('./wrangler.jsonc', import.meta.url)),",
        '          },',
        '        }),',
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
        // Documents the shape for editors/CI without pulling in a real
        // schema fetch. `account_id` is deliberately absent -- live
        // Cloudflare account metadata, populated by onboarding after this
        // generator runs (see README's Config/ charter), never fabricated.
        '  "$schema": "https://unpkg.com/wrangler@latest/config-schema.json",',
        '  "name": ' + JSON.stringify(appName) + ',',
        '  "main": "./.output/server/index.mjs",',
        '  "no_bundle": true,',
        '  "find_additional_modules": true,',
        '  "base_dir": ".output/server",',
        '  "rules": [{ "type": "ESModule", "globs": ["**/*.mjs"] }],',
        '  "compatibility_date": ' + JSON.stringify(DEFAULT_COMPATIBILITY_DATE) + ',',
        '  "compatibility_flags": ["nodejs_compat"],',
        '  "observability": { "enabled": true },',
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
      path: 'apps/web/scripts/validate-manifests.mjs',
      // foundation:check item 1.3 requires only that a `manifests:validate`
      // script exist and succeed; it says nothing about the live cross-check
      // already agreeing on a checkout this generator itself just produced.
      // ../../Config/cloudflare-app.json is populated by onboarding, AFTER
      // this generator runs (see README's Config/ charter) -- a checkout
      // fresh from `create-narduk-app` has no such file yet, so unlike the
      // reference app's own script (which assumes the file exists) this one
      // no-ops with an explanatory message when it is absent, and only runs
      // the real binding cross-check once onboarding creates it.
      contents: text(
        "import { readFile } from 'node:fs/promises'",
        '',
        "const cloudflareAppPath = '../../Config/cloudflare-app.json'",
        '',
        'let manifestText',
        'try {',
        "  manifestText = await readFile(cloudflareAppPath, 'utf8')",
        '} catch (error) {',
        "  if (error.code === 'ENOENT') {",
        '    console.log(',
        '      `manifests: ${cloudflareAppPath} does not exist yet (populated by onboarding) -- skipping the live binding cross-check`,',
        '    )',
        '    process.exit(0)',
        '  }',
        '  throw error',
        '}',
        '',
        'const [wrangler, manifest] = await Promise.all([',
        "  readFile('wrangler.jsonc', 'utf8').then((text) => JSON.parse(stripJsonComments(text))),",
        '  Promise.resolve(JSON.parse(manifestText)),',
        '])',
        '',
        'const actual = {',
        '  cron: wrangler.triggers?.crons ?? [],',
        '  d1: (wrangler.d1_databases ?? []).map((entry) => entry.binding).sort(),',
        '  kv: (wrangler.kv_namespaces ?? []).map((entry) => entry.binding).sort(),',
        '  queues: [',
        '    ...(wrangler.queues?.producers ?? []).map((entry) => `${entry.binding}:producer`),',
        '    ...(wrangler.queues?.consumers ?? []).map((entry) => `${entry.queue}:consumer`),',
        '  ].sort(),',
        '  r2: (wrangler.r2_buckets ?? []).map((entry) => entry.binding).sort(),',
        '}',
        'const expected = {',
        '  cron: [...(manifest.bindings?.cron ?? [])].sort(),',
        '  d1: (manifest.bindings?.d1 ?? []).map((entry) => entry.binding).sort(),',
        '  kv: (manifest.bindings?.kv ?? []).map((entry) => entry.binding).sort(),',
        '  queues: (manifest.bindings?.queues ?? [])',
        '    .map((entry) => `${entry.binding ?? entry.queue}:${entry.role}`)',
        '    .sort(),',
        '  r2: (manifest.bindings?.r2 ?? []).map((entry) => entry.binding).sort(),',
        '}',
        'if (JSON.stringify(actual) !== JSON.stringify(expected)) {',
        '  throw new Error(',
        '    `wrangler bindings disagree with ${cloudflareAppPath}\\nactual=${JSON.stringify(actual)}\\nexpected=${JSON.stringify(expected)}`,',
        '  )',
        '}',
        'console.log(`manifests: wrangler.jsonc and ${cloudflareAppPath} agree`)',
        '',
        // wrangler.jsonc (JSONC) needs its `//`/`/* */` comments AND its
        // trailing commas stripped before JSON.parse -- this file's own
        // "preview_urls": ...,\n} has one. The naive `//.*$` line-comment
        // pattern would also eat the "https://" in this file's own
        // `$schema` URL, so the negative lookbehind skips a `//` immediately
        // preceded by `:` (a real line comment is preceded by
        // whitespace/start-of-line, never a bare colon).
        'function stripJsonComments(text) {',
        "  return text.replace(/\\/\\*[\\s\\S]*?\\*\\/|(?<!:)\\/\\/.*$/gm, '').replace(/,(\\s*[}\\]])/gu, '$1')",
        '}',
      ),
    },
    {
      path: 'apps/web/tests/e2e/home.spec.ts',
      contents: text(
        "import { expect, test } from './fixtures'",
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
      // A thin re-export, not a copy: narduk-testkit is the single source of
      // truth for these fixtures (waitForBaseUrlReady, waitForHydration,
      // warmUpApp), and importing from './fixtures' rather than the package
      // directly everywhere means a future fixture addition only has to
      // touch this one file. Matches the reference app's own fixtures.ts.
      path: 'apps/web/tests/e2e/fixtures.ts',
      contents: text(
        'export {',
        '  expect,',
        '  test,',
        '  waitForBaseUrlReady,',
        '  waitForHydration,',
        '  warmUpApp,',
        "} from '@narduk-enterprises/narduk-testkit/e2e/fixtures'",
      ),
    },
    {
      // Playwright "setup project" (see playwright.config.ts's setup/chromium
      // projects and the chromium project's dependencies: ['setup']): runs
      // once, before any other e2e spec, with real browser/baseURL fixtures
      // rather than a plain globalSetup function (which has no fixture
      // access). webServer.url already checks for an HTTP 200-403 response,
      // but that alone does not prove Nuxt/Vite has finished compiling a
      // real page on this cold start, or that a required health check
      // actually passed rather than degrading -- this closes both gaps
      // before any dependent spec can race them. Matches the reference
      // app's own global.setup.ts, minus its product-specific health-check
      // name assertion (this app registers none by default).
      path: 'apps/web/tests/e2e/global.setup.ts',
      contents: text(
        "import { waitForBaseUrlReady, warmUpApp } from '@narduk-enterprises/narduk-testkit/e2e/fixtures'",
        '',
        "import { expect, test } from './fixtures'",
        '',
        "test('app is ready for e2e navigation', async ({ browser, baseURL, request }) => {",
        '  test.setTimeout(150_000)',
        "  expect(baseURL, 'Playwright baseURL must be configured').toBeTruthy()",
        '  await waitForBaseUrlReady(baseURL!)',
        "  const health = await request.get('/api/health')",
        '  expect(health.status()).toBe(200)',
        '  const body = await health.json()',
        ...(hasDatabase && capabilities.includes('auth')
          ? [
              // narduk-core's own auth-tables probe is deliberately
              // `required: false` (see packages/modules/narduk-core's health
              // report): a scaffold this generator just produced has never
              // run `db:migrate:local`/`db:migrate:remote`, so the D1
              // binding is reachable but the auth tables genuinely are not
              // there yet. That degrades `status`/`database` without
              // failing the request (still 200) -- asserting a hard `'ok'`
              // here would make every freshly generated auth+database app
              // fail its own readiness gate before its first migration.
              // Once migrations have run, both fields report `'ok'` and
              // this still passes.
              '  expect(body).toMatchObject({',
              '    success: true,',
              '    data: { status: expect.stringMatching(/^(ok|degraded)$/u) },',
              '  })',
            ]
          : [
              '  expect(body).toMatchObject({',
              '    success: true,',
              "    data: { status: 'ok', database: " +
                (hasDatabase ? "'ok'" : "'not_applicable'") +
                ' },',
              '  })',
            ]),
        '  await warmUpApp(browser, baseURL!)',
        '})',
      ),
    },
    {
      // Generic skeleton, not the reference app's own filled-in shape: its
      // visual-audit.spec.ts hardcodes ~10 real product routes and
      // app-specific selectors this generator cannot know in advance (same
      // reasoning as CONTRACT.md above). What IS generic -- the shared
      // narduk-testkit UI-quality toolkit wiring, the four representative
      // viewports, and the console-clean assertion -- is filled in for real,
      // scoped to the one route every scaffold actually has: '/'.
      path: 'apps/web/tests/e2e/visual-audit.spec.ts',
      contents: text(
        "import path from 'node:path'",
        '',
        'import {',
        '  captureFullPageAudit,',
        '  captureNamedLocator,',
        '  createConsoleTracker,',
        '  prepareUiQualityRoot,',
        '  writeUiQualityManifest,',
        "} from '@narduk-enterprises/narduk-testkit/playwright/ui-quality'",
        '',
        "import { expect, test, waitForBaseUrlReady, waitForHydration, warmUpApp } from './fixtures'",
        '',
        "const SCREENSHOT_ROOT = path.resolve(process.cwd(), 'output/playwright/visual-audit')",
        'const SCREENSHOT_SCOPE = ' + tsString(appName + '-visual-audit') + '',
        'const VIEWPORTS = [',
        "  { height: 844, name: 'mobile', width: 390 },",
        "  { height: 1024, name: 'tablet', width: 768 },",
        "  { height: 900, name: 'desktop', width: 1280 },",
        ']',
        '',
        // Every scaffold has exactly one route: '/'. Add a row per route as
        // the app grows past its starter page (mirrors CONTRACT.md's
        // Endpoints table instruction).
        'function representativeRoutes() {',
        "  return [{ name: 'home', path: '/' }]",
        '}',
        '',
        "test.describe('visual audit', () => {",
        "  test.describe.configure({ mode: 'serial' })",
        '  test.setTimeout(180_000)',
        '  let screenshotRoot = SCREENSHOT_ROOT',
        '',
        '  test.beforeAll(async ({ browser, baseURL }) => {',
        '    if (!baseURL) {',
        "      throw new Error('visual audit requires Playwright baseURL to be configured.')",
        '    }',
        '',
        '    await waitForBaseUrlReady(baseURL)',
        '    await warmUpApp(browser, baseURL)',
        '    screenshotRoot = prepareUiQualityRoot(SCREENSHOT_ROOT, { scope: SCREENSHOT_SCOPE })',
        '  }, 60_000)',
        '',
        "  test('captures representative routes across target viewports', async ({ page }) => {",
        // narduk-core's build-info client plugin unconditionally logs this
        // banner via console.warn on every page load (see
        // packages/modules/narduk-core's build-info.client.ts) -- it is
        // deliberate, universal app behavior, not a defect, so every
        // generated app needs this ignored the same way the reference app
        // does, not just apps that happen not to trip it. Prettier collapses
        // a single-element array literal like this onto one line, so the
        // template must match that canonical form exactly.
        '    const consoleTracker = createConsoleTracker(page, [/^\\[build\\]/])',
        '    const captures: Array<Awaited<ReturnType<typeof captureFullPageAudit>>> = []',
        '    const routes = representativeRoutes()',
        '',
        '    for (const viewport of VIEWPORTS) {',
        '      await page.setViewportSize({ height: viewport.height, width: viewport.width })',
        '      for (const route of routes) {',
        "        const response = await page.goto(route.path, { waitUntil: 'domcontentloaded' })",
        '        expect(response?.ok(), `Expected ${route.path} to return an OK response`).toBeTruthy()',
        '        await waitForHydration(page)',
        "        await expect(page.locator('main')).toBeVisible()",
        '        captures.push(',
        '          await captureFullPageAudit(',
        '            page,',
        '            screenshotRoot,',
        '            route.path,',
        '            `${route.name}-${viewport.name}`,',
        '            async (directory, elements) => {',
        '              await captureNamedLocator(',
        '                page,',
        "                page.locator('main').first(),",
        "                'main content',",
        '                directory,',
        '                elements,',
        '              )',
        '            },',
        '          ),',
        '        )',
        '      }',
        '    }',
        '',
        '    writeUiQualityManifest(screenshotRoot, {',
        '      app: ' + tsString(appName) + ',',
        '      generatedAt: new Date().toISOString(),',
        '      minimumFullPageCount: VIEWPORTS.length * routes.length,',
        '      minimumScreenshotCount: VIEWPORTS.length * routes.length * 2,',
        '      captures,',
        '    })',
        '',
        '    await consoleTracker.expectClean()',
        '  })',
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
        'import {',
        '  assertLocalDevPortAvailable,',
        '  resolveLocalDevPort,',
        '  shouldReuseExistingServer,',
        "} from '@narduk-enterprises/narduk-testkit/playwright/dev-port'",
        '',
        '// LOCAL DEV PORT. One scaffolded port per app was one port per MACHINE:',
        '// every worktree of this app shared it, so `reuseExistingServer` below',
        "// attached to whichever worktree's `nuxt dev` got there first and the",
        '// suite silently tested the wrong branch (narduk-libs#417, and the',
        '// PLAYWRIGHT_PORT override that narduk-libs#62 added is the thing nobody',
        '// remembers to set). A LINKED WORKTREE now derives its own port from the',
        '// checkout path; the primary checkout and CI keep the declared port, so',
        '// muscle memory and any localhost allowlist still work. PLAYWRIGHT_PORT',
        "// still wins. Nuxt's dev server (via listhen) honors the PORT env var, so",
        '// the resolved port also has to flow into the webServer command below.',
        '//',
        '// `process.cwd()`, not `import.meta.url`: Playwright transpiles a',
        '// TypeScript config to CJS unless something says otherwise, and',
        '// `import.meta` is a syntax error there. The resolver walks up to the',
        '// nearest `.git`, so any directory inside the checkout gives the same',
        '// port -- and `pnpm run test:e2e` runs from this root anyway.',
        'const devPort = resolveLocalDevPort({',
        '  rootDir: process.cwd(),',
        '  declaredPort: ' + localPort + ',',
        '})',
        'const port = devPort.port',
        '',
        '// A derived port is not reused: a residual collision -- a hash clash, or',
        '// any unrelated process on that port -- must fail loudly instead of',
        '// becoming another silent wrong-branch pass. PLAYWRIGHT_REUSE_SERVER=1',
        '// opts back in for a lane driving its own long-lived `nuxt dev`.',
        'const reuseExistingServer = shouldReuseExistingServer({ resolution: devPort })',
        'if (!reuseExistingServer) {',
        '  assertLocalDevPortAvailable({ resolution: devPort })',
        '}',
        '',
        '// FLAKE POLICY. One retry, carrying a trace, and on the default branch a',
        '// test that only passes on that retry FAILS the run instead of being',
        '// reported as flaky-but-green. A second retry buys almost nothing once a',
        '// flaky result cannot pass, and it triples the cost of a genuinely broken',
        '// test before the gate says so.',
        '//',
        '// GITHUB_EVENT_NAME is a GitHub Actions *default* environment variable,',
        '// exported into every step of every job, so a reusable workflow does not',
        '// have to forward it. The branch is fail-CLOSED regardless: anything not',
        '// recognisably a pull-request event -- an unset variable, a rename, a',
        '// workflow_dispatch -- takes the STRICT path, so a missing variable can',
        '// only make this gate harsher, never green.',
        'const isCI = Boolean(process.env.CI)',
        "const strictFlakePolicy = isCI && !(process.env.GITHUB_EVENT_NAME ?? '').startsWith('pull_request')",
        '// Shared nuxt-cloudflare sets E2E_PREBUILT_ARTIFACT=1 and expects',
        '// every narduk-app to have a prebuilt-Worker launcher. Default stays',
        '// `nuxt dev` so a laptop `pnpm run test:e2e` does not need a build.',
        "const prebuiltArtifact = process.env.E2E_PREBUILT_ARTIFACT === '1'",
        '',
        '// Printed once, from the runner process only (TEST_WORKER_INDEX is set in',
        '// every Playwright worker). Which policy a run took is otherwise invisible',
        '// in the log, and an unverifiable claim about it is what this replaces.',
        'if (process.env.TEST_WORKER_INDEX === undefined) {',
        '  console.log(',
        '    `[e2e] flake policy: retries=${isCI ? 1 : 0} trace=on-first-retry ` +',
        '      `failOnFlakyTests=${strictFlakePolicy} ` +',
        "      `(CI=${isCI ? '1' : '0'}, GITHUB_EVENT_NAME=${process.env.GITHUB_EVENT_NAME || '(unset)'})`,",
        '  )',
        '  // Which port this checkout claimed, and why. A run that silently',
        '  // attached to the wrong server is exactly what this line makes visible.',
        '  console.log(`[e2e] ${devPort.description} (reuseExistingServer=${reuseExistingServer})`)',
        '}',
        '',
        'export default defineConfig({',
        "  testDir: './apps/web/tests/e2e',",
        '  fullyParallel: true,',
        '  forbidOnly: isCI,',
        '  retries: isCI ? 1 : 0,',
        '  failOnFlakyTests: strictFlakePolicy,',
        "  reporter: 'line',",
        '  use: {',
        '    baseURL: `http://127.0.0.1:${port}`,',
        "    trace: 'on-first-retry',",
        "    screenshot: 'only-on-failure',",
        "    video: 'retain-on-failure',",
        '  },',
        '  webServer: {',
        '    command: prebuiltArtifact',
        '      ? `narduk-app e2e-serve ${port}`',
        '      : `PORT=${port} NUXT_SESSION_PASSWORD=narduk-test-only-session-password-000000 NUXT_OG_IMAGE_SECRET=narduk-test-only-og-image-secret-000000 pnpm --filter web run dev:test`,',
        '    env: {',
        '      ...process.env,',
        '      PORT: String(port),',
        "      NUXT_SESSION_PASSWORD: 'narduk-test-only-session-password-000000',",
        "      NUXT_OG_IMAGE_SECRET: 'narduk-test-only-og-image-secret-000000',",
        '    },',
        // Health, not '/': Playwright's own readiness probe only checks for
        // an HTTP 200-403 response, so a plain '/' base URL is satisfied by
        // a page that has accepted the connection but not finished an SSR
        // render. The 'setup' project below verifies the health body and
        // warms a real page render before any other test starts -- see
        // global.setup.ts for the full "why" (matches the reference app).
        '    url: `http://127.0.0.1:${port}/api/health`,',
        '    reuseExistingServer,',
        '  },',
        '  projects: [',
        '    {',
        "      // Runs once, before any 'chromium' project test file, via that",
        "      // project's dependencies below. See global.setup.ts.",
        "      name: 'setup',",
        '      testMatch: /global\\.setup\\.ts/,',
        "      use: { ...devices['Desktop Chrome'] },",
        '    },',
        '    {',
        // Kept as 'chromium', not renamed to the reference app's 'web': the
        // generated CI workflow (ci-workflow.ts) already shards and filters
        // on this exact project name (`--project=chromium`), both in the
        // private path's e2e-args and the public path's browser job --
        // renaming it would silently break those invocations.
        "      name: 'chromium',",
        '      testIgnore: /global\\.setup\\.ts/,',
        "      dependencies: ['setup'],",
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
