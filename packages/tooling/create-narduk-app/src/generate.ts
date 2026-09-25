import { existsSync } from 'node:fs'
import { mkdir, readdir, stat, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve, sep } from 'node:path'
import { createActionlintConfig, customRunnerLabels } from './actionlint-config.js'
import {
  createCiWorkflow,
  createDependabotMergeWorkflow,
  createValidationWorkflow,
  createCopilotSetupWorkflow,
  createGhPackagesRunScript,
  LINUX_CI_RUNNER_LABELS,
} from './ci-workflow.js'
import { NODE_SOURCE_FILE, REGION_MARKERS } from './ownership.js'
import { socialPreviewFiles } from './social-previews.js'
import { createMigrationWorkflowFiles, LINUX_DEPLOY_RUNNER_LABELS } from './migration-workflows.js'
import { rateLimitNamespacePrefix } from './rate-limit-namespace.js'

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
    rollback: { mode: 'manual', alert: 'resend' },
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

/**
 * The security contact the generated `nardukSeo.securityTxt` publishes.
 *
 * There is no default and no fallback address, which is Logan's decision
 * (2026-09-20) and matches narduk-seo's own rule that the module never invents
 * a reporting address. An app that passes nothing gets no `security.txt`
 * rather than one naming a mailbox nobody agreed to answer.
 *
 * The accepted shapes mirror narduk-seo's `normalizeContact`, which is the
 * real validator. They are checked again here so a bad value fails at
 * `create-narduk-app` time rather than on the new app's first build, where the
 * error arrives detached from the flag that caused it. If narduk-seo widens
 * what it accepts, this rejects something valid -- the failure direction that
 * tells someone, rather than the one that publishes a malformed contact.
 */
function normalizeSecurityContact(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const contact = value.trim()
  if (!contact) {
    throw new CreateNardukAppError(
      'securityContact cannot be empty. Omit it to scaffold an app with no security.txt.',
    )
  }
  // RFC 9116 fields are one per line, so a break would let the value inject a
  // second field into the published body.
  if (/[\r\n]/u.test(contact)) {
    throw new CreateNardukAppError('securityContact must not contain line breaks.')
  }
  const isUri = /^(?:mailto|https|tel):/iu.test(contact)
  const isBareAddress = contact.includes('@') && !contact.includes('://')
  if (!isUri && !isBareAddress) {
    throw new CreateNardukAppError(
      'securityContact must be a mailto:, https: or tel: URI, or a bare email address. ' +
        'Received ' +
        JSON.stringify(contact) +
        '.',
    )
  }
  return contact
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

/** The `printWidth` the generated `prettier.config.mjs` sets, named once so
 * the emitters that have to mirror Prettier's own wrapping decisions cannot
 * drift from the config this generator ships beside them. */
const PRETTIER_PRINT_WIDTH = 100

/**
 * `const <name> = <literal>`, wrapped the way Prettier wraps it.
 *
 * Prettier keeps a string-literal right-hand side on the declaration line
 * while the whole line fits inside `printWidth`, and otherwise breaks after
 * the `=` and indents the literal by two. It never splits the literal itself,
 * so the broken form can still be wider than `printWidth` -- that is still
 * Prettier's output, and `format:check` compares against exactly it.
 *
 * Emitting the single-line form unconditionally meant any caller free text
 * long enough to cross the width shipped pre-broken: `format:check` is the
 * FIRST step of the generated `quality:static`, so a long `--description`,
 * `--display-name` or `--site-url` made a brand-new app fail its own gate on
 * generator-owned files before anything else ran (narduk-libs#617). The
 * failure was a function of caller input length, not of the template, which
 * is why short fixtures never caught it.
 */
function constDeclaration(name: string, literal: string): string {
  const singleLine = `const ${name} = ${literal}`
  return singleLine.length <= PRETTIER_PRINT_WIDTH ? singleLine : `const ${name} =\n  ${literal}`
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
  if (inline.length <= PRETTIER_PRINT_WIDTH) return inline
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
  securityContact?: string
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
  const securityContact = normalizeSecurityContact(options.securityContact)
  // `nardukSeo` only exists as a config key when @nuxtjs/seo is installed, and
  // that is the `seo` capability. Emitting the block without it fails the new
  // app's `nuxt typecheck` with TS2353 -- the same trap `site` fell into
  // (narduk-libs#172) -- so this is refused here, where the flag is still in
  // view, rather than in a generated app that has no idea where it came from.
  if (securityContact && !capabilities.includes('seo')) {
    throw new CreateNardukAppError(
      'securityContact needs the seo capability: nardukSeo is not a config key without it. ' +
        'Add seo to --capabilities, or drop --security-contact.',
    )
  }

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
    securityContact,
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
    securityContact,
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
    // narduk-seo installModule('nuxt-og-image') when the peer is present.
    // The generated app never imports the package by name, so knip would
    // otherwise flag the #170/#316 pin as unused.
    ...(capabilities.includes('seo') ? ['nuxt-og-image'] : []),
    // Reached through `runtimeConfig.nardukLogging` in nuxt.config.ts and
    // narduk-core's compatibility bridge (see the generated docs/logging.md),
    // never through a named import -- so knip cannot trace it and reported
    // the deliberate pin as an unused dependency (narduk-libs#617).
    '@narduk-enterprises/narduk-logging',
    // Backs the `narduk-lint` binary and apps/web/eslint.config.mjs, which
    // extends @narduk-enterprises/eslint-config rather than importing eslint
    // itself. Removing it breaks `pnpm run lint`.
    'eslint',
    'vue-tsc',
  ]

  // The router block names the shared packages this profile installs, so an
  // agent reading AGENTS.md sees them without opening either manifest; the
  // list moves with the generator through `upgrade` (narduk-libs#377).
  const sharedPackages = [
    createRootPackageManifest(appName, capabilities, visibility, databaseBackend),
    createWebPackageManifest(appName, capabilities, localPort, { databaseBackend }),
  ].flatMap((manifest) => {
    const parsed = JSON.parse(manifest) as Record<string, Record<string, string> | undefined>
    return [...Object.keys(parsed.dependencies ?? {}), ...Object.keys(parsed.devDependencies ?? {})]
  })
  const sharedPackageList = [...new Set(sharedPackages)]
    .filter((name) => name.startsWith('@narduk-enterprises/'))
    .sort()
    .map((name) => '`' + name + '`')
    .join(', ')

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
        // Unanchored (no embedded slash before the trailing one), so it matches at any
        // depth -- including `apps/web/.narduk/recovery/`, where `narduk-app` actually
        // writes recovery artifacts. A pattern with an embedded slash like the prior
        // `.narduk/recovery` anchors to the repo root and never matches there
        // (narduk-libs#624).
        '.narduk/',
        '.npmrc.auth',
        '.wrangler',
        '.wrangler.deploy.production.json',
        '.wrangler.deploy.preview.json',
        '.data',
        'coverage',
        // Where `@narduk-enterprises/narduk-testkit` writes visual-audit artifacts
        // (narduk-libs#630); distinct from `.output` (Nitro's build output) above.
        'output',
        // Where the root `foundation:check` script writes foundation-check.json,
        // kept at a fixed path so a failed run can be read (narduk-libs#652).
        '/foundation-check/',
        'playwright-report',
        'blob-report',
        'all-blob-reports',
        'test-results',
        '.env',
        '.env.*',
        '!.env.example',
        // Wrangler local secrets. `.dev.vars` matches any directory; the
        // `**/` form and `.dev.vars.*` cover nested copies and suffixed
        // variants the same way `.env.*` does. `!.dev.vars.example` keeps a
        // committed template commitable, matching `!.env.example`.
        '.dev.vars',
        '**/.dev.vars',
        '.dev.vars.*',
        '!.dev.vars.example',
      ),
    },
    {
      path: '.npmrc',
      // SCOPE ROUTING ONLY. D-PKG-6 reads `@narduk-enterprises/*` from the
      // anonymous `https://npm.nard.uk` mirror. The committed file carries no
      // `_authToken` line -- not even an env reference. pnpm 10 warns
      // 'Failed to replace env in config' whenever the variable is absent,
      // and pnpm 11 drops env interpolation in .npmrc entirely. Break-glass
      // GitHub Packages auth stays in `scripts/gh-packages-run.mjs`, unused
      // by the default install path. See company-hq D-PKG-6.
      contents: text('@narduk-enterprises:registry=https://npm.nard.uk'),
    },
    {
      path: '.prettierignore',
      contents: text(
        'node_modules',
        '.nuxt',
        '.output',
        '.wrangler',
        '.wrangler.deploy.production.json',
        '.wrangler.deploy.preview.json',
        'coverage',
        'playwright-report',
        'blob-report',
        'all-blob-reports',
        'pnpm-lock.yaml',
        'test-results',
      ),
    },
    ...(databaseBackend === 'd1' ? createMigrationWorkflowFiles(visibility) : []),
    {
      path: '.github/workflows/ci.yml',
      contents: createCiWorkflow(visibility),
    },
    {
      // Merges the safe (minor + patch) Dependabot lane below once CI is
      // green on its exact head; the majors and github-actions lanes stay
      // manual. Both visibilities: a public app still needs the safe lane
      // merged, just from a GitHub-hosted runner (D-VIS-1).
      path: '.github/workflows/dependabot-merge.yml',
      contents: createDependabotMergeWorkflow(visibility),
    },
    ...(visibility === 'private'
      ? [
          {
            path: '.github/workflows/validate.yml',
            contents: createValidationWorkflow(visibility)!,
          },
          {
            // caller-lint runs actionlint, which rejects a self-hosted label it
            // was not told about: dependabot-merge.yml names `proxmox` and
            // `linux-ci`, and preview-d1.yml (a template for .github/workflows)
            // names `proxmox-deploy`. A public app names none (narduk-libs#778).
            path: '.github/actionlint.yaml',
            contents: createActionlintConfig(
              customRunnerLabels([
                LINUX_CI_RUNNER_LABELS,
                ...(databaseBackend === 'd1' ? [LINUX_DEPLOY_RUNNER_LABELS] : []),
              ]),
            ),
          },
        ]
      : []),
    {
      // Both visibilities: Copilot's sandbox installs the same frozen
      // lockfile from `https://npm.nard.uk` with no package secret.
      path: '.github/workflows/copilot-setup-steps.yml',
      contents: createCopilotSetupWorkflow(),
    },
    {
      // Two npm lanes, not one (narduk-libs#U2 / gonogo#104, the reference
      // shape). A single all-in `dependencies` group used to stack: every
      // app that adopted the old canonical shape (limit 10, ~10 groups)
      // ended up with ~10 open PRs that all edited pnpm-lock.yaml, so
      // merging one conflicted the rest and Dependabot rebased the whole
      // stack on every merge. Collapsing to one combined group was not the
      // fix either -- a single breaking major (typescript 5->6, vitest 4->5,
      // riverstatus#215) holds every harmless patch bump red behind it. So
      // `safe` (minor + patch) and `majors` (major) are split by
      // `update-types` over the same packages: `safe` merges itself once CI
      // is green on its exact head (.github/workflows/dependabot-merge.yml),
      // `majors` is a deliberate person/agent PR. `open-pull-requests-limit`
      // is 2 -- one PR per lane. The `groups.*.patterns` shape is the
      // D-TOOLCHAIN-1 recipe foundation:check item 5.2 accepts (narduk-libs#233
      // / PR #235); it does not care which group name carries the scope.
      // There is no `registries:` block: Dependabot reads the committed
      // `.npmrc` (`https://npm.nard.uk`) anonymously. A `registries:` entry
      // with `scope:` would discard that `.npmrc` and re-add token auth
      // (agent-infrastructure#1405, narduk-libs#568).
      path: '.github/dependabot.yml',
      // After D-PKG-6 there is no `registries:` / `scope:` block
      // (narduk-libs#568): Dependabot follows the committed `.npmrc`. Item
      // 5.2 is satisfied by the group patterns naming `@narduk-enterprises/*`.
      // `directory: "/"` (singular) matches the reference app: Dependabot's
      // npm ecosystem parses the whole pnpm workspace graph from the root
      // manifest, so the array-of-directories form this template previously
      // emitted was redundant, not additive.
      // Cooldown is disabled (default-days/semver-major-days: 0) and
      // @narduk-enterprises/* is listed only in the (inert while disabled)
      // `exclude` array -- company-hq#737, confirmed root cause: Dependabot's
      // pnpm updater does not propagate `cooldown.exclude` into
      // `minimumReleaseAgeExclude` for the wider recursive resolve, so any
      // nonzero cooldown here makes every non-excluded dependency fail on
      // every run given how often @narduk-enterprises/* publishes.
      contents: text(
        'version: 2',
        'updates:',
        "  - package-ecosystem: 'npm'",
        "    directory: '/'",
        '    schedule:',
        "      interval: 'weekly'",
        "      day: 'monday'",
        "      time: '06:00'",
        "      timezone: 'America/Chicago'",
        '    labels:',
        "      - 'dependencies'",
        '    open-pull-requests-limit: 2',
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
        '      safe:',
        '        patterns:',
        "          - '*'",
        "          - '@narduk-enterprises/*' # explicit scope required by foundation item 5.2",
        '        update-types:',
        "          - 'minor'",
        "          - 'patch'",
        '      majors:',
        '        patterns:',
        "          - '*'",
        "          - '@narduk-enterprises/*'",
        '        update-types:',
        "          - 'major'",
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
    {
      // Opt-in break-glass only. Default `cf:build` and CI install
      // anonymously from `https://npm.nard.uk` and do not call this script.
      path: 'scripts/gh-packages-run.mjs',
      contents: createGhPackagesRunScript(),
    },
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
        // whose AGENTS.md has no markers gets the block appended; opting out
        // is a `<!-- narduk:unmanaged -->` header (narduk-libs#377).
        REGION_MARKERS.agentsRouter.start,
        '',
        'The web app guidance in [apps/web/AGENTS.md](apps/web/AGENTS.md) covers Nuxt, Worker, database, and capability boundaries. [CONTRACT.md](CONTRACT.md) is the API surface this app promises to callers, kept current whenever a route changes. [docs/workers-builds.md](docs/workers-builds.md) covers deployment and recovery. [docs/e2e-testing.md](docs/e2e-testing.md) covers the Playwright layout and the visual QA toolkit.',
        'Every shareable route needs a preview. Maintain the route inventory and run the checks in [docs/social-previews.md](docs/social-previews.md) when adding pages or shipping.',
        '',
        'Shared packages: ' +
          sharedPackageList +
          '. Fix a shared behavior in its package in narduk-libs, not with a local copy.',
        '',
        '`pnpm exec narduk-app doctor` checks the app-local prerequisites; run it first when something about the toolchain or Cloudflare configuration looks wrong. `pnpm dlx @narduk-enterprises/create-narduk-app upgrade .` shows what the generator would refresh, including this block.',
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
      // The one place this app declares an accepted dependency advisory, read
      // by `narduk-app doctor --audit` (narduk-libs#376).
      path: 'narduk-app.json',
      contents: text('{', '  "security": {', '    "acceptedAdvisories": []', '  }', '}'),
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
        '### Which gate is which',
        '',
        'CI judges a commit with three things. Run all three before calling a branch ready; none of them needs a value you have to know out of band.',
        '',
        '- `pnpm run quality:static` -- format, lint, knip, manifest cross-check, shared-UI pin, typecheck, `build:ci`, unit tests. Credential-free and offline. Public CI runs this script directly; private CI names the same checks individually.',
        '- `pnpm run foundation:check` -- web-foundation conformance, the seven-item contract. Private CI runs it through the shared workflow input `foundation-check: true`, which fails the build on a `FAIL` **or** an `UNKNOWN` result. It is deliberately **not** chained into `quality:static`: it reads the package registry over the network. Default generated apps read `https://npm.nard.uk` anonymously and do not need a GitHub Packages credential.',
        '- `pnpm run quality` -- `quality:static` plus the Playwright browser tests, which both CI paths run as separate jobs.',
        '',
        ...(hasDatabase
          ? [
              '> **Create the database before the first push.** `apps/web/wrangler.jsonc` binds `DB` to the placeholder `database_id` `00000000-0000-0000-0000-000000000000`, because the generator does not call Cloudflare. Every build, dry-run and test accepts it, but no request that touches the database can succeed, so `foundation:check` fails sub-check 1.5 -- and with it CI -- until the database exists. From the repository root, with `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` set for the account this app deploys to, run `pnpm exec narduk-app db create`. It creates `' +
                appName +
                '-db` (the name comes from `Config/cloudflare-app.json`), writes the returned id into `apps/web/wrangler.jsonc` with its comments intact, and prints the id and account. Commit that change: the id is configuration, not a secret. It refuses to run once the id is real and never deletes anything. `--dry-run` shows what it would do.',
              '',
            ]
          : []),
        'The build step is `build:ci`, the same script CI builds with: it injects test-only `NUXT_OG_IMAGE_SECRET` / `NUXT_SESSION_PASSWORD` placeholders and targets the deployable Worker shape. Plain `pnpm run build` is the real-secret path, used by `cf:build` and operator recovery; it throws on an empty OG secret by design.',
        '',
        ...(visibility === 'private'
          ? [
              '> **Before the first push.** CI here runs on self-hosted, manifest-routed runners. A repository that has not been added to the selected-repository runner groups has no runner to pick those jobs up, so they sit in `queued` with no log. The hosted `Runner group onboarding` job still starts on GitHub-hosted Ubuntu and annotates the run when sibling jobs stay queued. The route names in `.github/workflows/ci.yml` do not grant membership. Onboard this repository into both fleet runner groups, and grant it access to the shared workflows, before pushing. If a run is already stuck queued, that is the cause: cancel it and re-run after onboarding.',
              '',
            ]
          : []),
        '`pnpm run dev` starts Nuxt directly and reads no secret store. When a capability needs registered credentials locally, run that command under the registered local credential route instead: `narduk-app dev --credentials nvault --project <project> --environment <environment> --config <config> -- nuxt dev --host 127.0.0.1`. Values stay process-local for that run and are never written to a file; do not commit real values to `.env` or `.dev.vars`.',
        '',
        'The committed `.npmrc` routes `@narduk-enterprises/*` to `https://npm.nard.uk`. Reads are anonymous. The file carries no credential and no environment reference: pnpm 10 warns `Failed to replace env in config` whenever a variable is absent, and pnpm 11 does not interpolate environment variables in `.npmrc` at all.',
        '',
        'Default installs (`pnpm install`, CI, Workers Builds `cf:build`) need no GitHub Packages token. `scripts/gh-packages-run.mjs` stays in the repo as an opt-in break-glass helper: temporarily point `.npmrc` at `https://npm.pkg.github.com` and run through that script with `GH_PACKAGES_READ` if the mirror is down. Never write the token into `~/.npmrc`, a tracked repository file, or a per-app alias.',
        '',
        'Dependabot reads the same anonymous mirror. The generated `dependabot.yml` has no `registries:` block and does not need `NARDUK_PLATFORM_GH_PACKAGES_READ`.',
        '',
        'Before the first push, onboarding runs pnpm install and commits pnpm-lock.yaml. CI and Workers Builds always use a frozen lockfile.',
        '',
        'Enable Workers Builds on protected `main`. Enable non-production branch builds and GitHub PR comments for trusted branches of public apps; the generated scripts alone do not create that connection. Version previews share Worker bindings, so private data and mutation-capable apps need isolated preview bindings before enabling them. Authenticated apps keep direct Worker and preview URLs disabled until equivalent protection is configured.',
        '',
        ...(visibility === 'private'
          ? [
              'Development mode (`pnpm run deploy:dev`) is an owner-enrolled alternative for apps still being built; it is off until enrolled. See the Development mode section of [docs/workers-builds.md](docs/workers-builds.md).',
              '',
            ]
          : []),
        'Cloudflare Workers Builds uses `pnpm run cf:build` as its build command, `pnpm run cf:deploy` for the production deploy command, and `pnpm run cf:deploy:preview` for non-production branches. Local `pnpm run deploy` remains recovery-only; `pnpm run deploy:dry-run` is credential-free.',
        '',
        'The app is configured for local Nuxt development on port ' +
          localPort +
          ' and the declared site URL is ' +
          siteUrl +
          '. Cloudflare resources are represented as local configuration only; provisioning and deployment are explicit operator workflows outside this generator.',
        '',
        '## Dependency advisories',
        '',
        '`pnpm exec narduk-app doctor --audit` fails only on a high or critical advisory this app has not accepted, and prints the line to add. When a patched version exists, bump to it instead. To accept one, add it to `narduk-app.json`; `id` and `reason` are required, `expiresOn` (YYYY-MM-DD) is optional:',
        '',
        '```json',
        '{ "id": "GHSA-xxxx-xxxx-xxxx", "reason": "no patched version; dev server only" }',
        '```',
        '',
        'Low and moderate advisories never need an entry, and an unreachable registry reads `UNKNOWN`, never a failure.',
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
        // Only for the seo capability: without it there is no `nardukSeo` key
        // to point at, and the section would describe config this app cannot
        // write (narduk-libs#384).
        ...(capabilities.includes('seo')
          ? [
              '',
              '## Security contact and crawler policy',
              '',
              "Both live in `nardukSeo` in `apps/web/nuxt.config.ts`, served by narduk-seo. `aiCrawlers` decides which AI crawlers may read this app: `'allow'` (the default this app was scaffolded with) writes no robots.txt groups, `'disallow'` refuses every crawler narduk-seo tracks, and `{ allow, disallow }` names them individually.",
              '',
              securityContact
                ? 'This app publishes `/.well-known/security.txt` from `nardukSeo.securityTxt.contact`, scaffolded as `' +
                  securityContact +
                  '`. Change it there; nothing else in this repository holds a copy. narduk-seo computes the published `Expires` field at **build** time as today plus `securityTxt.expiresDays` (default 365, and 365 is also the maximum), so a deployment that is not rebuilt within a year serves a security.txt that researchers are entitled to read as stale — a redeploy refreshes it. Prefer a role address over a person, for the same reason: the contact wants to outlive whoever set it up.'
                : "This app serves **no** `security.txt`: it was scaffolded without `--security-contact`, and neither narduk-seo nor the generator invents a reporting address. To publish one, add `securityTxt: { contact: 'mailto:…' }` to `nardukSeo`. Prefer a role address over a person — a contact nobody answers is worse than none, which is why there is no default.",
            ]
          : []),
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
        '| Setting                       | Value                                             |',
        '| ----------------------------- | ------------------------------------------------- |',
        '| Root directory                | `/`                                               |',
        '| Production branch             | `main`                                            |',
        '| Build command                 | `pnpm run cf:build`                               |',
        '| Production deploy command     | `pnpm run cf:deploy:preview`                      |',
        '| Non-production deploy command | `pnpm run cf:deploy:preview`                      |',
        '| Non-production branch builds  | disabled until preview bindings exist (see below) |',
        '| Build cache                   | enabled                                           |',
        '| `NODE_VERSION`                | `' +
          NODE_VERSION +
          '`                                         |',
        '| `PNPM_VERSION`                | `' +
          PNPM_VERSION +
          '`                                         |',
        '| `SKIP_DEPENDENCY_INSTALL`     | `1`                                               |',
        '| `NUXT_OG_IMAGE_SECRET`        | Build variable (Worker secrets are runtime-only)  |',
        '| `NUXT_SESSION_PASSWORD`       | Build variable (Worker secrets are runtime-only)  |',
        '',
        "The build command installs the frozen workspace lockfile from `https://npm.nard.uk` (anonymous `@narduk-enterprises/*` reads) and then builds the Cloudflare module artifact. Skipping Cloudflare's initial install keeps that install on the frozen lockfile. No GitHub Packages build secret is required. If the mirror is unavailable, break-glass is `scripts/gh-packages-run.mjs` with `GH_PACKAGES_READ` after temporarily routing `.npmrc` at `https://npm.pkg.github.com`. Do not make that the default.",
        '',
        'Worker secrets are injected at runtime only and are not visible to `nuxt build`. Apps that enable runtime OG image generation (the `seo` capability default) must set `NUXT_OG_IMAGE_SECRET` as a Workers Builds _Build variable_ or the build throws. Set `NUXT_SESSION_PASSWORD` the same way. CI uses committed test-only placeholders; production must use the real Vault-issued values, never those placeholders.',
        '',
        'Both deploy commands are the same command on purpose. `cf:deploy:preview` runs `narduk-app deploy versions-upload`, which uploads a version and changes no traffic; the name is historical. Setting the _production_ deploy command to anything that deploys would put a `main` push straight into production and defeat the standard. The separate `cf:deploy` script stays for authorized recovery only.',
        '',
        '## Public runtime keys vs wrangler vars',
        '',
        "Worker `vars` are runtime-only too: Workers Builds does **not** export `wrangler.jsonc` `vars` into the `nuxt build` process environment. `process.env.GA_MEASUREMENT_ID || ''` (and the same pattern for `POSTHOG_PUBLIC_KEY` or `NUXT_PUBLIC_ALLOW_GEOLOCATION`) therefore bakes an empty string into the build, and Nuxt serializes it into the page's `__NUXT__` payload even when the deployed Worker has the keys. The page looks intentionally dark while `GET /api/runtime/public` is populated.",
        '',
        "Keep public keys in wrangler `vars` under their short Worker names. `@narduk-enterprises/narduk-core` writes the analytics, SEO-meta and geolocation keys from those bindings into `runtimeConfig.public` on every page request before SSR, and blanks analytics on preview hosts. Do **not** read `wrangler.jsonc` from `nuxt.config.ts` to paper over the empty bake. Optional `NUXT_PUBLIC_*` aliases are accepted but not required. An empty string after the overlay means the Worker does not have the key; turn collection off with `analyticsLoadStrategy: 'off'` or by removing the var.",
        '',
        '## The deployment standard',
        '',
        'This app declares its half of the standard in `Config/cloudflare-app.json`. The generator writes the part a checkout can know -- product identity, the Worker shape, the exposure class, and the bindings mirror. Onboarding adds the live facts it deliberately left out: `product.repository`, the Cloudflare account id, `domains`, and the `deployment` block below. Add that block to the existing file verbatim, then run `pnpm run foundation:deployment`:',
        '',
        '```jsonc',
        ...deploymentBlockLines(appName),
        '```',
        '',
        '`narduk-app foundation:check:deployment` checks that block against the standard. It reads this repository only: it cannot see the deploy commands actually configured on the Workers Builds connection, so a green check here is not a green deployment. Until this app adopts the block the check reports `NOT ADOPTED` and exits 0.',
        '',
        '## Development mode',
        '',
        ...(visibility === 'private'
          ? [
              "While an app is being built, one approved workstation can own its enrolled Cloudflare target and deploy straight from its checkout -- uncommitted edits included -- with `pnpm run deploy:dev`. Entering holds the automation that would otherwise overwrite that target (this repository's push/merge workflows and the Workers Builds triggers) and records exactly what it held; exiting restores it, after `.github/workflows/validate.yml` has validated the exact release commit. Ordinary pushes run no CI while the app is in development mode. Full validation happens only when you ask for it with `narduk-app development validate`, and on exit.",
              '',
              'Development mode is off until an owner enrolls the app. Enrollment needs live facts this generator does not have -- the account id, the approved hostname, deployment and build-control credential selectors, and every workflow classified -- so the `deployment.development` capability is added to `Config/cloudflare-app.json` during enrollment, not here. `pnpm run deploy:dev` refuses on a workstation without an activation record. Read the [development mode runbook](https://github.com/narduk-enterprises/narduk-libs/blob/main/packages/tooling/narduk-app-tools/docs/development-mode.md) before enrolling, and use the normal promotion path above whenever the app is not enrolled.',
            ]
          : [
              'Development mode needs a private explicit-validation caller, which a public repository cannot call, so this app always uses the normal promotion path above. `pnpm run deploy:dev` refuses without an activation record.',
            ]),
        '',
        ...(databaseBackend === 'd1'
          ? [
              '## Create the D1 database',
              '',
              'The generator writes the `DB` binding with the placeholder `database_id` `00000000-0000-0000-0000-000000000000`; it never calls Cloudflare. Create the database once, before the first push, from the repository root:',
              '',
              '```sh',
              'CLOUDFLARE_ACCOUNT_ID=<account id> CLOUDFLARE_API_TOKEN=<token with D1 edit> \\',
              '  pnpm exec narduk-app db create',
              '```',
              '',
              '`db create` takes the database name from `Config/cloudflare-app.json` (`' +
                appName +
                '-db`), never from an argument, runs `wrangler d1 create`, writes the returned id into `apps/web/wrangler.jsonc` without touching its comments, and prints the id and the account. It refuses when the id is already real, so it cannot create a second database for an app that has one, and it never deletes. Without it, the equivalent is `wrangler d1 create ' +
                appName +
                '-db` under the same credentials, then setting `d1_databases[0].database_id` in `apps/web/wrangler.jsonc` to the id it prints. `foundation:check` sub-check 1.5 fails while the placeholder remains.',
              '',
              '## D1 migrations are a promotion gate',
              '',
              'Declare `deployment.migrations` before adopting narduk-v1: compatibility `expand-contract`, a separate `cloudflare/prd/' +
                appName +
                '-migrate` credential, and `databases: [{ binding: "DB", sources: "apps/web/migrations.sources.json" }]`. Use the actual Wrangler binding name. Every D1 binding needs exactly one source manifest; add preview database IDs under `previewBindings.d1` before enabling branch builds.',
              '',
              'Merge `docs/deployment/promote-d1.steps.yml` into the app-owned promote job before versions-promote. Merge `ci-d1-bundle.job.yml` into CI and activate `preview-d1.yml` after preview onboarding. These are inert, one-shot onboarding templates: generating them does not install credentials or activate remote writes. Read the narduk-app-tools D1 deployment migrations runbook before enabling them.',
              '',
              'For existing D1 schemas, use the shared narduk-app-tools [reviewed baseline process](https://github.com/narduk-enterprises/narduk-libs/blob/main/packages/tooling/narduk-app-tools/docs/migration-baselines.md). Capture a frozen schema/ledger artifact, review and prove it, then register untracked schema metadata explicitly before enabling automatic promotion. Never reconstruct a historical fixture by replaying all currently installed migrations.',
              '',
              'Automatic production order: exact successful CI SHA → expand-only check (12.9 must pass) → eligible uploaded version → migrate with D1-only credential → read-only drift check → promote with separate credential → live proof. Any migration error blocks promotion. `deployment.rollback.mode` is `manual`: nothing rolls back on its own. The only automated trigger is the rollback step this app writes into its own promote job, after a completed promotion fails its live proof; a failed migration triggers nothing, and Worker rollback never restores a database.',
              '',
              'Migration SQL must keep the currently serving Worker and supported rollback versions working: expand first, backfill compatibly, switch code, then contract in a later separately reviewed change after the rollback window closes. Filenames and applied SQL are immutable. The drift gate checks history/checksums; it cannot prove application compatibility. `foundation:check:deployment` sub-check 12.9 fails a migration that drops or renames a table, view or column unless `deployment.migrations.contractMigrations` declares it reviewed, pinned by checksum.',
              '',
              'A singleton lock in each database serializes cooperating runners across repositories and binding aliases. Remote failure or uncertain completion retains the lock for investigation. Retire legacy writers before claiming serialization. Preview bundles contain SQL/data only, run with trusted default-branch tooling, and target the declared preview databases. PR jobs never receive D1 credentials. Conflicting shared-preview histories are refused.',
              '',
            ]
          : []),
        '## Promotion, live proof and rollback',
        '',
        'The promote workflow runs on `workflow_run` after the gate check goes green (or on a dispatch from `ci.yml`, below), resolves the version Workers Builds uploaded for **the commit that run verified**, deploys it at 100%, and then proves it:',
        '',
        '```yaml',
        '# .github/workflows/promote.yml (excerpt)',
        'on:',
        '  workflow_run:',
        '    workflows: [CI]',
        '    types: [completed]',
        '    branches: [main]',
        "  # A main CI run started with GITHUB_TOKEN fires no workflow_run; ci.yml's",
        '  # promote-dispatch job starts this instead (narduk-libs#787).',
        '  workflow_dispatch:',
        '    inputs:',
        '      verified-sha:',
        '        description: main commit whose ci / Required passed',
        '        required: true',
        '        type: string',
        'concurrency:',
        '  group: promote-${{ github.repository }}-main',
        '  cancel-in-progress: false',
        'jobs:',
        '  gate:',
        '    if: >-',
        "      (github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main') ||",
        "      (github.event.workflow_run.conclusion == 'success' && github.event.workflow_run.event != 'pull_request')",
        "    runs-on: <the promote job's runner route>",
        '    permissions:',
        '      contents: read',
        '      checks: read',
        '    outputs:',
        '      sha: ${{ steps.gate.outputs.sha }}',
        '    steps:',
        "      # Whatever started this run, promote main's head, and only once its",
        '      # latest ci / Required passed. A pending run can be replaced in the',
        '      # concurrency group, so the survivor must promote what the replaced',
        '      # run would have; an older commit never replaces a newer one.',
        '      - id: gate',
        '        env:',
        '          GH_TOKEN: ${{ github.token }}',
        '          REPO: ${{ github.repository }}',
        '          STARTED_FOR: ${{ inputs.verified-sha || github.event.workflow_run.head_sha }}',
        '        run: |',
        '          set -euo pipefail',
        '          head=$(gh api "repos/$REPO/commits/main" --jq .sha)',
        '          passed=$(gh api "repos/$REPO/commits/$head/check-runs?check_name=ci%20%2F%20Required" \\',
        '            --jq \'[.check_runs[] | select(.app.slug == "github-actions")] | sort_by(.completed_at // "") | last | .conclusion == "success"\')',
        '          if [ "$passed" != true ]; then',
        '            echo "::notice::main is at $head (this run started for $STARTED_FOR) and its latest ci / Required has not passed; its own CI run promotes it."',
        '            exit 0',
        '          fi',
        '          echo "sha=$head" >> "$GITHUB_OUTPUT"',
        '  promote:',
        '    needs: gate',
        "    if: needs.gate.outputs.sha != ''",
        '    env:',
        '      VERIFIED_SHA: ${{ needs.gate.outputs.sha }}',
        '    steps:',
        '      # ...check out and install $VERIFIED_SHA, then:',
        '      - id: promote',
        '        run: narduk-app deploy versions-promote --sha "$VERIFIED_SHA" --gate-verified "ci / Required@$VERIFIED_SHA" --production-branch main --json',
        '      - id: live-proof',
        '        run: narduk-app verify --live https://<hostname> --expect-sha "$VERIFIED_SHA"',
        '      # Roll back only after a completed promotion followed by failed live proof.',
        "      - if: failure() && steps.promote.outcome == 'success' && steps.live-proof.outcome == 'failure'",
        '        run: narduk-app deploy rollback --to "<previousVersionId>"',
        '```',
        '',
        "The `gate` job is what makes the promotion safe to trigger two ways. Whatever started the run, it promotes the current head of `main`, and only once the latest `ci / Required` on that exact commit has passed. A dispatch input or a `workflow_run` head is only a claim, and it is recorded but not trusted. A commit whose CI finished after a newer merge therefore never replaces that newer commit. The rule also covers GitHub keeping only one _pending_ run per concurrency group: a queued Promote replaced by a later one loses nothing, because the survivor promotes the same head. `workflow_run`s from pull requests are filtered out. When the head's check has not passed yet, the gate skips with a notice, and the head's own CI run promotes it. Promoting a head that is already live repeats an idempotent deploy. The checkout in front of `versions-promote` checks out `$VERIFIED_SHA` as well.",
        '',
        "**Dependabot merges promote by dispatch.** `dependabot-merge.yml` merges the `safe` lane with `GITHUB_TOKEN` and starts main CI by `workflow_dispatch`. GitHub fires no `workflow_run` for a run started that way, so without the `workflow_dispatch` trigger above a Dependabot bump reaches `main` but not production until the next human merge (narduk-libs#787). The generated `ci.yml` closes that gap with its `promote-dispatch` job. It runs only for a bot-dispatched run on `main`, after every CI job has passed, and dispatches this workflow with `verified-sha` set to the run's commit if that commit is still main's head. It waits on nothing, so it holds no runner. An app whose `promote.yml` does not exist (a 404) or has no `verified-sha` input gets a notice instead of a failure. Any other API error fails the job, so a promotion is never skipped quietly. To adopt this in an existing app, add the `promote-dispatch` job to `ci.yml` (the `pin`-managed `ci.yml` is not rewritten by `upgrade`; copy the job from a newly generated app) and give `promote.yml` the `workflow_dispatch` input and the `gate` job shown above.",
        '',
        'Promote `needs.gate.outputs.sha`, never `$GITHUB_SHA`. Under `on: workflow_run` `GITHUB_SHA` is the default branch head at trigger time, and nothing checked that it passed the gate check, so a commit that never passed it could reach production through it. `versions-promote` refuses to default `--sha` to `GITHUB_SHA` under that event for the same reason.',
        '',
        '`--gate-verified "ci / Required@$VERIFIED_SHA"` is the workflow\'s attestation that the gate check passed on that exact commit (narduk-libs#400). `versions-promote` never reads GitHub -- it holds no GitHub token -- so it binds the attestation instead: it refuses with exit 9, before touching anything, when the attested SHA is not the commit being promoted or the resolved version does not carry that commit\'s tag, and it logs the check and SHA it was given. Without the flag it still promotes, with a warning that no gate attestation was passed. Keep the job gated on the `workflow_run` conclusion being `success`; the attestation names what that gate observed, it does not replace it.',
        '',
        'The `--sha` lookup walks the Cloudflare Versions API up to `--max-versions` (default 500), not the ten `wrangler versions list` shows, so branch uploads landing between the merge build and this job cannot hide the version. A lookup that finds nothing exits 3: the promote job is **red**, never skipped, because production is still serving the previous release.',
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
        'Use the app-local `pnpm run deploy:hotfix` command only for an authorized production incident when normal delivery cannot restore service in time. The [local break-glass runbook](https://github.com/narduk-enterprises/narduk-libs/blob/main/packages/tooling/narduk-app-tools/docs/local-hotfix.md) owns eligibility, credential readiness, the production hold, failure recovery and reconciliation.',
        '',
        'The root `hotfix:check` script runs the app checks; `hotfix:build` builds the production Worker using only its explicitly injected app build secrets, never the test placeholders from `build:ci`. A real hotfix checks out the exact clean local commit in a temporary clone, installs offline from the frozen lockfile/cache, checks/builds without the recovery token, uploads and promotes the exact version, and proves the live SHA, health and smoke route. It never applies database migrations.',
        '',
        '```sh',
        'pnpm run deploy:hotfix --incident INC-123 --reason "Normal delivery unavailable" --operator "Incident operator" --sha "$(git rev-parse HEAD)" --confirm-worker ' +
          appName +
          ' --base-url https://<production-hostname> --dry-run',
        '```',
        '',
        'TODO(onboarding): register and prove the app recovery credential route, warm the package cache, and rehearse against a disposable Worker. For a real incident, hold all production writers, run under the registered nvault selector with `--automation-paused --yes` instead of `--dry-run`, retain the receipt and merge the patch back through normal CI before restoring automation. The flags record operator intent; they do not pause workflows or grant approval.',
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
        '## workerd client-abort `Broken pipe` / `Connection reset by peer` noise',
        '',
        'A multi-route `page.goto` aborts in-flight Worker responses. workerd logs that as this multiline block (Playwright prefixes each copied stderr line with `[WebServer]`):',
        '',
        '```text',
        '✘ [ERROR] kj::getCaughtExceptionAsKj() = kj/async-io-unix.c++…: disconnected: ::write(…): Broken pipe',
        '  stack: …workerd@…',
        '```',
        '',
        'The last words are `Broken pipe` or `Connection reset by peer` depending on whether the browser had already reset the socket; both are the same aborted write and both are filtered.',
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
            constDeclaration('displayName', tsString(displayName)),
            constDeclaration('description', tsString(description)),
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
            constDeclaration('displayName', tsString(displayName)),
            constDeclaration('description', tsString(description)),
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
      // narduk-lint's warning budget (see @narduk-enterprises/eslint-config's
      // README, "Warning budgets"). A new app starts with no warnings, so the
      // budget starts empty. `strict` (eslint-config 2.2.0+, #673) makes a
      // warning in a rule with no entry fail instead of being recorded as that
      // rule's budget; `narduk-lint --accept-new-rules` adopts one on purpose.
      path: 'apps/web/lint-budget.json',
      contents: text('{', '  "strict": true,', '  "rules": {}', '}'),
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
        constDeclaration('siteUrl', tsString(siteUrl)),
        constDeclaration('appName', tsString(displayName)),
        constDeclaration('appDescription', tsString(description)),
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
              // Which AI crawlers may read this app (narduk-libs#384). 'allow'
              // is narduk-seo's own default and emits no robots.txt groups;
              // it is written out anyway so the knob is visible in the app
              // that owns the policy, rather than a default nobody knows is
              // being taken. 'disallow' refuses every crawler in
              // narduk-seo's AI_CRAWLERS list, and { allow, disallow } names
              // them individually.
              "    aiCrawlers: 'allow',",
              // security.txt is published only when a contact exists. The
              // generator has no default address and never invents one
              // (--security-contact), which is why this block is absent
              // rather than empty in an app that passed nothing: narduk-seo
              // treats a securityTxt with no usable contact as a build error,
              // and an invented address is worse than no file.
              ...(securityContact
                ? [
                    '    securityTxt: {',
                    '      contact: ' + tsString(securityContact) + ',',
                    '    },',
                  ]
                : []),
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
        // No `xaiApiKey` here. It is @narduk-enterprises/narduk-ai's own
        // runtimeConfig key, declared by that module with `defu` and a
        // validator -- so emitting it in the app leaked an AI-specific key
        // into every scaffold (capabilities [auth, seo, analytics, uploads]
        // got one too), and for an app that DOES select `ai` the app-side
        // `|| ''` won the defu merge and silently replaced the module's
        // validated value with an empty string.
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
        // Workers Cache, on by default (narduk-libs#435). Without it Cloudflare
        // invokes the Worker on every request and `setCacheProfile`'s
        // CDN-Cache-Control / Cache-Tag are inert -- an app advertising an edge
        // TTL it does not have, which is what Buoys shipped.
        //
        // Safe to default on only because the narduk-core this generator pins
        // keeps uncacheable responses out of a shared cache: thrown 4xx/5xx/429
        // are `private, no-store` (narduk-libs#429), nonce-CSP SSR HTML is too,
        // and a response that picks no profile at all gets `private` rather than
        // Cloudflare's heuristic 2-hour store. `foundation:check` item 12.7 fails
        // this block against a narduk-core older than that, so an app that
        // downgrades core is told rather than silently storing error pages.
        //
        // Requires Wrangler >= 4.69.0; PACKAGE_VERSIONS pins 4.136.3.
        // `cross_version_cache` is deliberately absent: a deployment partitions
        // the cache by Worker version by default, and sharing across versions
        // wants an app-specific reason.
        '  // Workers Cache: without this the Worker runs on every request and',
        "  // narduk-core's CDN-Cache-Control / Cache-Tag never bind. A route",
        '  // still needs setCacheProfile to be stored; one that sets nothing is',
        '  // private by default. This file cannot prove the edge actually',
        '  // stores anything -- for that, run (narduk-libs#435):',
        '  //   narduk-app verify --live <production-url> --edge-cache-path <route>',
        '  "cache": { "enabled": true },',
        '  "workers_dev": ' + (exposure === 'public') + ',',
        '  "preview_urls": ' + (exposure === 'public') + ',',
        // No `ratelimits` binding is emitted: narduk-core's limiter runs on its
        // in-isolate window without one, and the binding is an upgrade, never
        // a prerequisite. What IS emitted is this app's own namespace prefix
        // (narduk-libs#433), because `namespace_id` is unique per Cloudflare
        // account and the next binding would otherwise be pasted from another
        // app. `narduk-app doctor` refuses scaffold and reused ids.
        '  // Rate limits: add a Cloudflare binding per RL_<limit> when a route',
        '  // needs one. namespace_id is unique per ACCOUNT, not per Worker, so',
        "  // never copy one from another app: this app's prefix is " +
          rateLimitNamespacePrefix(appName) +
          ',',
        "  // then the limit padded to three digits (narduk-core's rateLimitNamespaceId).",
        '  //   "ratelimits": [{ "name": "RL_120", "namespace_id": "' +
          rateLimitNamespacePrefix(appName) +
          '120", "simple": { "limit": 120, "period": 60 } }]',
        ...(hasDatabase
          ? [
              // The generator must not call Cloudflare, so the id is a
              // placeholder every build and dry-run accepts. foundation:check
              // sub-check 1.5 fails on it, and `narduk-app db create` is the
              // one step that replaces it (narduk-libs#662).
              '  // DB: database_id is a placeholder until the database exists. Run',
              '  //   pnpm exec narduk-app db create',
              '  // from the repository root (CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID',
              '  // set) to create it and write the real id here. foundation:check fails',
              '  // until then.',
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
      // The app's own half of the deployment standard, in the shape every
      // onboarded estate app already uses. Only facts a checkout can know
      // are written: the product identity, the Worker shape this generator
      // just emitted into wrangler.jsonc, the exposure class chosen at
      // generation time, and the bindings mirror.
      //
      // Onboarding still owns everything live -- `product.repository`, the
      // Cloudflare account id, `domains`, and the `deployment` block -- and
      // those are deliberately ABSENT rather than fabricated, which is the
      // same rule wrangler.jsonc's missing `account_id` follows.
      //
      // Why the generator writes this file at all (narduk-libs#617): CI runs
      // the shared workflow with `foundation-check: true`, which fails the
      // build on a FAIL or UNKNOWN result. Without this file item 1.2 is a
      // decided FAIL ("wrangler.jsonc exists but Config/cloudflare-app.json
      // does not") and 1.4/3.1/3.2 are UNKNOWN, so the FIRST CI run of every
      // new app was red by construction and nothing inside the app could fix
      // it. Recording the app's own half here is what makes a fresh scaffold
      // reachable-green; it also turns `manifests:validate` into a real
      // cross-check from the first commit instead of a no-op.
      path: 'Config/cloudflare-app.json',
      contents: text(
        '{',
        '  "schemaVersion": 1,',
        '  "product": {',
        '    "name": ' + JSON.stringify(displayName) + ',',
        '    "target": "workers",',
        '    "framework": "nuxt",',
        '    "visibility": ' + JSON.stringify(visibility),
        '  },',
        '  "worker": {',
        '    "name": ' + JSON.stringify(appName) + ',',
        '    "wranglerConfig": "apps/web/wrangler.jsonc",',
        '    "compatibilityDate": ' + JSON.stringify(DEFAULT_COMPATIBILITY_DATE) + ',',
        '    "compatibilityFlags": ["nodejs_compat"],',
        // The spelling nuxt.config declares. foundation:check normalizes `-`
        // and `_` (narduk-libs#350), so a build writing "cloudflare-module"
        // into .output/nitro.json agrees with this line.
        '    "nitroPreset": "cloudflare_module",',
        '    "workersDev": ' + (exposure === 'public') + ',',
        '    "previewUrls": ' + (exposure === 'public'),
        '  },',
        '  "access": {',
        '    "exposureClass": ' +
          JSON.stringify(exposure === 'public' ? 'public' : 'authenticated-public'),
        '  },',
        // Mirrors apps/web/wrangler.jsonc exactly -- the same pairing
        // apps/web/scripts/validate-manifests.mjs enforces on every build,
        // and the mirror foundation:check item 1.2 reads.
        '  "bindings": {',
        '    "d1": ' + (hasDatabase ? '[{ "binding": "DB" }]' : '[]') + ',',
        '    "kv": [],',
        '    "r2": ' +
          (capabilities.includes('uploads') ? '[{ "binding": "UPLOADS" }]' : '[]') +
          ',',
        '    "queues": [],',
        '    "cron": []',
        '  }',
        '}',
      ),
    },
    {
      path: 'apps/web/scripts/validate-manifests.mjs',
      // The generator now writes ../../Config/cloudflare-app.json with a
      // bindings mirror that matches the wrangler.jsonc beside it, so this
      // cross-check does real work from the first commit. The ENOENT branch
      // stays for an app generated before that change, and for one whose
      // file has been removed: this script is a build gate, not the place to
      // discover a missing declaration -- foundation:check item 1.2 reports
      // that, with the remediation attached.
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
        // The display name is bound to a const rather than interpolated into
        // the assertion: a long one pushed the call past printWidth, and
        // Prettier's own layout for THAT is a broken `expect(` argument list
        // -- a shape this generator would have to re-implement to stay
        // format:check-clean. A const is stable at any length, and
        // constDeclaration already mirrors the one break Prettier makes.
        constDeclaration('heading', tsString(displayName)),
        '',
        "test('home page renders', async ({ page }) => {",
        "  await page.goto('/')",
        "  await expect(page.getByRole('heading', { name: heading })).toBeVisible()",
        '})',
      ),
    },
    {
      // A thin re-export, not a copy: narduk-testkit is the single source of
      // truth for these fixtures (waitForBaseUrlReady, waitForVueHydrated,
      // warmUpApp), and importing from './fixtures' rather than the package
      // directly everywhere means a future fixture addition only has to
      // touch this one file. Matches the reference app's own fixtures.ts.
      path: 'apps/web/tests/e2e/fixtures.ts',
      contents: text(
        'export {',
        '  expect,',
        '  test,',
        '  waitForBaseUrlReady,',
        '  waitForVueHydrated,',
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
        "import { expect, test, waitForBaseUrlReady, waitForVueHydrated, warmUpApp } from './fixtures'",
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
        '        await waitForVueHydrated(page)',
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
        '  printWidth: ' + PRETTIER_PRINT_WIDTH + ',',
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
