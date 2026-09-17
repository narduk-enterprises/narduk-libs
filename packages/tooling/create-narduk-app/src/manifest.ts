import type { Capability, GeneratedDatabaseBackend, ProductSpec } from './types.js'

export const NODE_VERSION = '24.21.0'

export const PACKAGE_VERSIONS = {
  '@cloudflare/workers-types': '5.20260714.1',
  '@iconify-json/lucide': '1.2.108',
  '@narduk-enterprises/narduk-mapkit': '2.0.2',
  '@narduk-enterprises/narduk-mapkit-nuxt': '2.0.5',
  '@narduk-enterprises/narduk-app-tools': '0.4.1',
  '@narduk-enterprises/eslint-config': '2.0.3',
  '@narduk-enterprises/narduk-ai': '0.2.2',
  '@narduk-enterprises/narduk-analytics': '1.19.36',
  '@narduk-enterprises/narduk-auth': '1.27.1',
  '@narduk-enterprises/narduk-charts': '2.5.2',
  '@narduk-enterprises/narduk-core': '2.0.0',
  '@narduk-enterprises/narduk-logging': '0.1.0',
  // Pinned for its `pnpm.overrides` entry only: narduk-platform is never a
  // direct dependency of a generated app. narduk-core, narduk-ai and
  // narduk-auth each ship it as `workspace:*`, so the app installs it three
  // ways down and needs one version named for all of them. `versions:sync`
  // keeps this pin on the workspace version like any other.
  '@narduk-enterprises/narduk-platform': '2.1.0',
  '@narduk-enterprises/narduk-seo': '2.2.0',
  // The components-library suite (components-library-plan.md item 4,
  // narduk-libs#251). Pinned to the on-disk workspace version, which is still
  // `0.0.0`: the package has never been published (item 1 shipped the
  // skeleton without a release, and wave 2's component items each left their
  // changeset unconsumed rather than publish -- see
  // docs/plans/components-library-plan.md's done-when 5). `versions:check`
  // requires this literal to equal narduk-shell's live `package.json` version,
  // not a preview of its next release, so it moves to a real version only
  // when `pnpm run release:version` actually runs for narduk-shell and
  // `versions:sync` re-pins this entry. Until that first publish lands,
  // scripts/publish-verified-packages.mjs asserts every locally pinned
  // version above actually resolves on the registry before create-narduk-app
  // itself publishes, so this (or any future) unpublished pin fails the
  // release closed instead of shipping unnoticed (narduk-libs#284).
  '@narduk-enterprises/narduk-shell': '0.3.0',
  '@narduk-enterprises/narduk-testkit': '1.3.0',
  '@narduk-enterprises/narduk-uploads': '1.20.0',
  // Explicit module (see generate.ts's moduleList -- narduk-core's own
  // installModule('@nuxt/ui') nests an installModule('@nuxt/icon') call too
  // deep in the setup chain to finish registering the icon client-bundle
  // virtual file before build; making it explicit here fixes that, matching
  // the reference app's own modules array and devDependency exactly.
  '@nuxt/icon': '2.5.1',
  '@nuxt/test-utils': '4.0.3',
  '@nuxt/ui': '4.8.1',
  '@playwright/test': '1.61.1',
  // Nuxt 4.5 resolves Vite 8. Tailwind 4.2 only declares support through
  // Vite 7, which makes a newly generated app install with a peer warning.
  '@tailwindcss/vite': '4.3.2',
  '@types/node': '22.19.19',
  '@typescript-eslint/utils': '8.64.0',
  'drizzle-kit': '0.31.10',
  'drizzle-orm': '0.45.2',
  esbuild: '0.28.1',
  // Local Wrangler binding emulation under `nuxt dev` (gated behind
  // isCloudflareBuild in the generated nuxt.config.ts). The reference app
  // pins a caret range that resolves to this exact version; the generator's
  // own exact-pin discipline (every generated dependency is exact SemVer)
  // pins it directly instead.
  'nitro-cloudflare-dev': '0.2.2',
  // @narduk-enterprises/eslint-config v2 (this workspace's own peer
  // requirement, see packages/tooling/eslint-config/package.json) needs
  // eslint@^10.0.0; this pin generates every new app's own devDependency, so
  // it has to track the same major the config package now requires or every
  // freshly scaffolded app fails its first `pnpm install` on an unmet peer.
  // `versions:sync` does not cover this: it only re-pins the
  // `@narduk-enterprises/*` package versions above, not third-party pins like
  // this one, so it has to be bumped by hand alongside eslint-config's own
  // major bumps.
  eslint: '10.8.0',
  glob: '13.0.6',
  'happy-dom': '20.9.0',
  knip: '6.14.1',
  // narduk-seo's current module set uses Unhead 3's tree-shake transform.
  // Nuxt 4.5 supplies that runtime; Nuxt 4.4 logs a warning and skips it.
  nuxt: '4.5.2',
  '@nuxt/eslint': '1.15.2',
  prettier: '3.8.3',
  tailwindcss: '4.3.2',
  typescript: '5.9.3',
  vitest: '4.1.6',
  'vue-tsc': '3.2.5',
  wrangler: '4.110.0',
  zod: '4.4.3',
} as const

const capabilityPackages: Record<Capability, readonly string[]> = {
  ai: ['@narduk-enterprises/narduk-ai'],
  analytics: ['@narduk-enterprises/narduk-analytics'],
  auth: ['@narduk-enterprises/narduk-auth'],
  // Unlike every other capability package, narduk-charts is not a Nuxt
  // module (no `nuxt` peer, no `module.ts` -- see the package's `exports`
  // map): it is a plain Vue component library the app imports from directly.
  // moduleList() in generate.ts excludes 'charts' from the Nuxt `modules:
  // [...]` array for exactly this reason.
  charts: ['@narduk-enterprises/narduk-charts'],
  mapkit: ['@narduk-enterprises/narduk-mapkit', '@narduk-enterprises/narduk-mapkit-nuxt'],
  seo: ['@narduk-enterprises/narduk-seo'],
  uploads: ['@narduk-enterprises/narduk-uploads'],
}

export function packageNameForCapability(capability: Capability): string {
  return capabilityPackages[capability][0] as string
}

export function packageNamesForCapability(capability: Capability): readonly string[] {
  return capabilityPackages[capability]
}

export function packageVersionsForCapabilities(
  capabilities: readonly Capability[],
  databaseBackend: GeneratedDatabaseBackend = 'd1',
): Record<string, string> {
  const names = [
    ...Object.keys(dependencyEntries(capabilities, databaseBackend)),
    ...Object.keys(devDependencyEntries(databaseBackend)),
    '@narduk-enterprises/eslint-config',
    '@nuxt/eslint',
    '@typescript-eslint/utils',
    'esbuild',
    'glob',
    'knip',
  ]

  return Object.fromEntries(
    [...new Set(names)]
      .sort()
      .map((name) => [name, PACKAGE_VERSIONS[name as keyof typeof PACKAGE_VERSIONS]]),
  )
}

function dependencyEntries(
  capabilities: readonly Capability[],
  databaseBackend: GeneratedDatabaseBackend,
): Record<string, string> {
  const names = [
    '@iconify-json/lucide',
    '@narduk-enterprises/narduk-core',
    '@narduk-enterprises/narduk-logging',
    // The components-library suite ships by default, not behind a
    // capability flag (components-library-plan.md item 4): every new app
    // starts on the shared Ne* suite before its first local component
    // exists, the same way it always starts on narduk-core.
    '@narduk-enterprises/narduk-shell',
    ...capabilities.flatMap(packageNamesForCapability),
    '@nuxt/ui',
    // An app with no database imports no schema, so drizzle stays out of both
    // manifests rather than sitting unused (knip would flag it).
    ...(databaseBackend === 'none' ? [] : ['drizzle-orm']),
    'nuxt',
    // @nuxt/ui declares tailwindcss as a peer, not a dependency, and
    // eslint-plugin-better-tailwindcss (design-system pack) resolves
    // `tailwindcss/package.json` from the linted package's own directory --
    // pnpm's strict per-package isolation means that resolution fails unless
    // the app declares tailwindcss itself, whatever narduk-core or @nuxt/ui
    // pull in transitively. narduk-core's own package.json makes the same
    // choice (a real `dependencies` entry, not just a peer passthrough).
    'tailwindcss',
  ]

  return Object.fromEntries(
    [...new Set(names)]
      .sort()
      .map((name) => [name, PACKAGE_VERSIONS[name as keyof typeof PACKAGE_VERSIONS]]),
  )
}

function devDependencyEntries(databaseBackend: GeneratedDatabaseBackend): Record<string, string> {
  const names = [
    '@cloudflare/workers-types',
    '@narduk-enterprises/narduk-app-tools',
    '@narduk-enterprises/narduk-testkit',
    '@nuxt/icon',
    '@playwright/test',
    // @nuxt/ui's module dynamically imports('@tailwindcss/vite') at Nuxt
    // setup time to register the Vite plugin itself; the app has to make the
    // package resolvable, the same requirement as the tailwindcss dependency
    // above (see dependencyEntries). narduk-core pins it as a devDependency
    // too, since it is a build-time-only tool, never shipped at runtime.
    '@tailwindcss/vite',
    '@types/node',
    ...(databaseBackend === 'none' ? [] : ['drizzle-kit']),
    'eslint',
    'happy-dom',
    // Always installed, not gated behind a capability: the module it backs
    // is itself gated at runtime (isCloudflareBuild) in nuxt.config.ts, not
    // by whether it is present in node_modules.
    'nitro-cloudflare-dev',
    'prettier',
    'typescript',
    'vitest',
    'vue-tsc',
    'wrangler',
  ]

  return Object.fromEntries(
    names.sort().map((name) => [name, PACKAGE_VERSIONS[name as keyof typeof PACKAGE_VERSIONS]]),
  )
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

export function createRootPackageManifest(
  appName: string,
  capabilities: readonly Capability[],
  visibility: 'private' | 'public',
  databaseBackend: GeneratedDatabaseBackend = 'd1',
): string {
  return json({
    name: appName,
    version: '0.1.0',
    private: true,
    packageManager: 'pnpm@10.33.4',
    engines: { node: NODE_VERSION },
    volta: { node: NODE_VERSION },
    narduk: {
      capabilities: [...capabilities],
      visibility,
    },
    scripts: {
      build: 'pnpm --filter web run build',
      // NARDUK_CLOUDFLARE_BUILD=1 drops the local-only nitro-cloudflare-dev
      // module (see nuxt.config.ts's isCloudflareBuild gate) and
      // NITRO_PRESET=cloudflare_module makes the build target the actual
      // deployable Worker shape. CI's ci.yml `build-script: build:ci` and
      // the public browser job's `pnpm run build:ci` both call this --
      // matches the reference app's root script exactly.
      'build:ci': 'NARDUK_CLOUDFLARE_BUILD=1 NITRO_PRESET=cloudflare_module pnpm run build',
      'cf:build': 'pnpm --filter web run cf:build',
      'cf:deploy': 'pnpm --filter web run cf:deploy',
      'cf:deploy:preview': 'pnpm --filter web run cf:deploy:preview',
      ...(databaseBackend === 'none'
        ? {}
        : {
            'db:migrate:local': 'pnpm --filter web run db:migrate:local',
            'db:migrate:remote': 'pnpm --filter web run db:migrate:remote',
          }),
      deploy: 'pnpm --filter web run deploy',
      'deploy:dry-run': 'pnpm --filter web run deploy:dry-run',
      'deploy:version': 'pnpm --filter web run deploy:version',
      dev: 'pnpm --filter web run dev',
      doctor: 'pnpm --filter web run doctor',
      // Full web-foundation conformance run (company-hq
      // docs/WEB-FOUNDATION-CHECK.md), for local/manual use -- CI's own gate
      // is the `foundation-check: true` input on the reusable workflow
      // (ci-workflow.ts), which invokes narduk-app-tools directly and does
      // not call this script. Matches the reference app's root script.
      'foundation:check':
        'mkdir -p foundation-check && narduk-app foundation:check --checkout . --json foundation-check/foundation-check.json',
      'foundation:shared-ui-pinned': 'pnpm --filter web run foundation:shared-ui-pinned',
      format: 'prettier --write "**/*.{ts,mts,vue,js,mjs,json,yaml,yml,css,md}"',
      'format:check': 'prettier --check "**/*.{ts,mts,vue,js,mjs,json,yaml,yml,css,md}"',
      knip: 'knip',
      lint: 'pnpm --filter web run lint',
      // Reads only apps/web/wrangler.jsonc and, once onboarding creates it,
      // ../../Config/cloudflare-app.json -- no install-time resolution or
      // registry credential, so it belongs in the static half of quality
      // like foundation:shared-ui-pinned (see foundation:check item 1.3).
      'manifests:validate': 'pnpm --filter web run manifests:validate',
      'performance-budget': 'pnpm --filter web run performance-budget',
      'og:generate': 'pnpm --filter web run og:generate',
      'og:check': 'pnpm --filter web run og:check',
      'og:check:live': 'pnpm --filter web run og:check:live',
      quality: 'pnpm run quality:static && pnpm run test:e2e',
      // `foundation:shared-ui-pinned` and `manifests:validate` sit in the
      // static half because they read manifests only: no install-time
      // resolution and, by design, no registry credential (see
      // narduk-app-tools `item-8-shared-ui-pinned.ts`). That is what lets
      // them run here at all -- the generated workflow scopes the GitHub
      // Packages token to the install step, so nothing after it has an
      // ambient token. narduk-libs' own `packed-consumer-smoke` job expands
      // this chain via `scripts/consumer-smoke-phases.mjs`, so the check also
      // runs against a really-installed generated app on every narduk-libs PR.
      'quality:static':
        'pnpm run format:check && pnpm run lint && pnpm run knip && pnpm run manifests:validate && pnpm run foundation:shared-ui-pinned && pnpm run typecheck && pnpm run build && pnpm run test:unit',
      test: 'pnpm --filter web run test:unit && pnpm exec playwright test',
      'test:unit': 'pnpm --filter web run test:unit',
      'test:e2e': 'playwright test',
      typecheck: 'pnpm --filter web run typecheck',
    },
    devDependencies: {
      '@narduk-enterprises/eslint-config': PACKAGE_VERSIONS['@narduk-enterprises/eslint-config'],
      // Root-level, not just apps/web's: `foundation:check` above runs
      // `narduk-app` directly from the repo root, and pnpm only symlinks a
      // package's own dependencies' bins into ITS node_modules/.bin -- the
      // web workspace's copy (devDependencyEntries) does not resolve here.
      // Matches the reference app's own root devDependency.
      '@narduk-enterprises/narduk-app-tools':
        PACKAGE_VERSIONS['@narduk-enterprises/narduk-app-tools'],
      '@playwright/test': PACKAGE_VERSIONS['@playwright/test'],
      '@types/node': PACKAGE_VERSIONS['@types/node'],
      eslint: PACKAGE_VERSIONS.eslint,
      knip: PACKAGE_VERSIONS.knip,
      prettier: PACKAGE_VERSIONS.prettier,
      typescript: PACKAGE_VERSIONS.typescript,
    },
    pnpm: {
      overrides: {
        // WHY ESTATE PACKAGES ARE OVERRIDDEN (narduk-libs#282 review, task 5)
        //
        // pnpm replaces a `workspace:` specifier with the EXACT version of that
        // workspace package at publish time, so a published estate module
        // carries a hard pin on whatever its sibling's version was that day.
        // pnpm replaces a `workspace:` specifier with the EXACT version of
        // that workspace package at publish time, so every published estate
        // module carries a hard pin on whatever its sibling's version was that
        // day. Two different exact pins on one package in one tree is two
        // installed copies: for a Nuxt module, two `addModule` registrations
        // and two `useRuntimeConfig` namespaces; for a contracts package, two
        // copies of the zod schemas the modules are supposed to share. That is
        // a correctness break, not a size regression.
        //
        // Two shapes produce that second pin, and both are represented here.
        //
        //  1. ONE publisher plus the app's own direct pin. narduk-core ships
        //     `narduk-logging: workspace:*` and the app pins narduk-logging
        //     itself; narduk-mapkit-nuxt ships `narduk-mapkit: workspace:*`
        //     and the mapkit capability pins narduk-mapkit itself. They
        //     diverge the first time one is released without the other.
        //  2. TWO OR MORE publishers and no direct pin at all. narduk-platform
        //     is a runtime `workspace:*` dependency of narduk-core, narduk-ai
        //     AND narduk-auth, and a generated app names it nowhere -- so a
        //     guard that looked only at the app's own manifests could not see
        //     it. Let narduk-core publish while platform is 2.0.0 and
        //     narduk-auth publish while it is 2.1.0 and the app installs both.
        //
        // narduk-core is in both shapes at once: four publishers and a direct
        // pin. A package with one publisher and NO direct pin needs no
        // override -- one exact spec, one copy -- which is why `narduk-app`,
        // shipped `workspace:*` by narduk-auth alone, is absent. `narduk-auth`
        // is absent for a different reason: nothing in the estate depends on
        // it, so its override was inert and dropping it in a5ed8e9 was right.
        //
        // An override is an assertion, not a free fix: it forces ONE version on
        // publishers that were each built against whatever their sibling was
        // on their own release day. `versions:sync` keeps these pins on the
        // workspace versions -- the set that is actually built and tested
        // together -- so the assertion holds at release time, but a genuinely
        // breaking contracts release (narduk-platform is already at 2.0.0) has
        // to land across its publishers together rather than one at a time.
        //
        // The cost is real and accepted: Dependabot does not update
        // `pnpm.overrides`, so a grouped `@narduk-enterprises/*` bump resolves
        // back to the override's version until the override is bumped by hand.
        // A stale-but-single copy is recoverable; two live copies are not.
        // narduk-libs#282 carries the follow-up (pnpm's `$<name>` override
        // form, which would let the override track a root declaration that
        // Dependabot does update).
        //
        // `tests/workspace-override-safety.test.ts` derives this whole set
        // from the live workspace manifests -- publishers counted over the
        // installed closure, direct pins intersected, devDependency edges
        // excluded because a published package's devDependencies are never
        // installed by its consumers -- so a new `workspace:` edge cannot
        // reopen the hole silently.
        //
        // narduk-shell (added by item 4, narduk-libs#251) deliberately has NO
        // override entry here, checked against this same derivation. It does
        // ship one `@narduk-enterprises/*` runtime edge of its own --
        // `@narduk-enterprises/narduk-platform`, a `workspace:*` dependency --
        // but that only makes it a fifth publisher of a package already
        // overridden below, which changes nothing. What decides shell's own
        // entry is the other direction: nothing else in the workspace ships
        // *shell* as a `workspace:` runtime dependency today --
        // `design-system-build` depends on it, but only as a devDependency,
        // which the derivation excludes because a published package's
        // devDependencies are never installed by its consumers. Zero
        // publishers means zero possible second copy, so an override here
        // would be inert. If a future package starts shipping narduk-shell as
        // a runtime `workspace:*` dependency, this reasoning changes and the
        // derivation in `tests/workspace-override-safety.test.ts` will start
        // requiring the entry.
        '@narduk-enterprises/narduk-core': PACKAGE_VERSIONS['@narduk-enterprises/narduk-core'],
        '@narduk-enterprises/narduk-logging':
          PACKAGE_VERSIONS['@narduk-enterprises/narduk-logging'],
        ...(capabilities.includes('mapkit')
          ? {
              '@narduk-enterprises/narduk-mapkit':
                PACKAGE_VERSIONS['@narduk-enterprises/narduk-mapkit'],
            }
          : {}),
        '@narduk-enterprises/narduk-platform':
          PACKAGE_VERSIONS['@narduk-enterprises/narduk-platform'],
        '@nuxt/eslint': PACKAGE_VERSIONS['@nuxt/eslint'],
        // The generator pins `nuxt` exactly, so `@nuxt/kit` has to be pinned to
        // the same version. Narduk modules depend on `@nuxt/kit@^4.0.0`, so
        // without this every upstream Nuxt minor silently splits the app's kit
        // from its nuxt and drags in that kit's transitive dependency block.
        '@nuxt/kit': PACKAGE_VERSIONS.nuxt,
        'eslint-plugin-vitest>@typescript-eslint/utils':
          PACKAGE_VERSIONS['@typescript-eslint/utils'],
        esbuild: PACKAGE_VERSIONS.esbuild,
        glob: PACKAGE_VERSIONS.glob,
      },
      ...(capabilities.includes('auth')
        ? {
            peerDependencyRules: {
              // narduk-core depends on nuxt-auth-utils, whose OPTIONAL passkey
              // helpers still declare `@simplewebauthn/*@^11` — a range upstream
              // has not moved since 2024. narduk-auth implements WebAuthn itself
              // against its own exact-pinned v13 (narduk-libs#125 D3) and never
              // calls those helpers, so the two versions never meet at runtime.
              // Without this, every auth-capable app's first `pnpm install`
              // reports an unmet peer for a feature it does not use.
              allowAny: ['@simplewebauthn/browser', '@simplewebauthn/server'],
            },
          }
        : {}),
      allowedDeprecatedVersions: {
        '@esbuild-kit/core-utils': '*',
        '@esbuild-kit/esm-loader': '*',
      },
      onlyBuiltDependencies: [
        '@parcel/watcher',
        'core-js',
        'esbuild',
        'sharp',
        'unrs-resolver',
        'vue-demi',
        'workerd',
      ],
    },
  })
}

export function createWebPackageManifest(
  appName: string,
  capabilities: readonly Capability[],
  localPort: number,
  metadata: {
    /** Defaults to `'d1'`; `'none'` drops the migrate scripts and drizzle pins. */
    databaseBackend?: GeneratedDatabaseBackend
    description?: string
    displayName?: string
    siteUrl?: string
  } = {},
): string {
  const databaseBackend = metadata.databaseBackend ?? 'd1'
  return json({
    name: 'web',
    version: '0.1.0',
    private: true,
    type: 'module',
    ...(metadata.description ? { description: metadata.description } : {}),
    ...(metadata.siteUrl ? { homepage: metadata.siteUrl } : {}),
    scripts: {
      build: 'narduk-app og:generate --if-missing && narduk-app og:check && nuxt build',
      // Starts Nuxt directly: a new app has no registered development
      // credentials, and the old `narduk-app dev --project … --config …`
      // wrapper meant an implicit `doppler run` against the retired app-secret
      // store (narduk-libs#321). An app that later needs credentials locally
      // runs this same command under `narduk-app dev --credentials nvault`.
      dev: 'nuxt dev --host 127.0.0.1',
      'format:check': 'prettier --check "**/*.{ts,mts,vue,js,mjs,json,yaml,yml,css,md}"',
      lint: 'nuxt prepare && eslint . --max-warnings 0',
      // Cross-checks wrangler.jsonc's bindings against ../../Config/cloudflare-app.json
      // (populated by onboarding, after this generator runs). Absent that
      // file the script exits 0 with an explanatory message instead of
      // throwing -- see scripts/validate-manifests.mjs's own header comment
      // for why: foundation:check item 1.3 only requires this script to
      // exist and succeed, not that live infra metadata already agrees with
      // it on a checkout this generator itself just produced.
      'manifests:validate': 'node scripts/validate-manifests.mjs',
      'nuxt:prepare': 'nuxt prepare',
      'test:e2e': 'playwright test',
      'test:unit': 'vitest run --config vitest.config.ts',
      'cf:build':
        'narduk-app og:generate --if-missing && narduk-app og:check && nuxt build --preset=cloudflare_module',
      'cf:deploy':
        databaseBackend === 'none'
          ? 'narduk-app deploy deploy'
          : 'narduk-app db migrate --config migrations.sources.json --database ' +
            appName +
            '-db --remote --workers-build-only && narduk-app deploy deploy',
      'cf:deploy:preview': 'narduk-app deploy versions-upload',
      ...(databaseBackend === 'none'
        ? {}
        : {
            'db:migrate:local':
              'narduk-app db migrate --config migrations.sources.json --database ' +
              appName +
              '-db --local',
            'db:migrate:remote':
              'narduk-app db migrate --config migrations.sources.json --database ' +
              appName +
              '-db --remote',
          }),
      deploy: 'narduk-app deploy deploy',
      'deploy:dry-run': 'narduk-app deploy deploy --dry-run',
      'deploy:local': 'narduk-app deploy-local',
      'deploy:version': 'narduk-app deploy versions-upload',
      // Nuxt DevTools explicitly skips TEST processes. The browser fixture
      // exercises the app, without the interactive development toolbar and
      // its Vite 8-incompatible config-retriever hook.
      'dev:test': 'narduk-app og:generate --if-missing && TEST=1 nuxt dev --host 127.0.0.1',
      doctor: 'narduk-app doctor',
      // `--checkout ..` because the item reads the WHOLE checkout (root and
      // apps/web manifests, nuxt.config, pages/components), and pnpm runs this
      // script with the cwd at apps/web.
      'foundation:shared-ui-pinned': 'narduk-app foundation:check:shared-ui-pinned --checkout ..',
      'performance-budget': 'narduk-app performance-budget --font-total-budget-kb 140',
      'og:generate': 'narduk-app og:generate',
      'og:check': 'narduk-app og:check',
      'og:check:live': 'narduk-app og:check --live',
      'registry-auth': 'narduk-app registry-auth',
      typecheck: 'nuxt typecheck',
    },
    narduk: {
      name: appName,
      ...(metadata.displayName
        ? { displayName: metadata.displayName, shortName: metadata.displayName }
        : {}),
      ...(metadata.siteUrl ? { url: metadata.siteUrl } : {}),
      capabilities: [...capabilities],
      localDevNuxtPort: localPort,
    },
    dependencies: dependencyEntries(capabilities, databaseBackend),
    devDependencies: devDependencyEntries(databaseBackend),
  })
}

export function createMigrationSourcesManifest(capabilities: readonly Capability[]): string {
  const packageSources = [
    {
      id: '@narduk-enterprises/narduk-core',
      dir: 'node_modules/@narduk-enterprises/narduk-core/runtime/drizzle',
    },
    ...(capabilities.includes('auth')
      ? [
          {
            id: '@narduk-enterprises/narduk-auth',
            dir: 'node_modules/@narduk-enterprises/narduk-auth/drizzle',
          },
        ]
      : []),
    {
      id: 'app',
      dir: 'drizzle',
    },
  ]

  return json({
    schemaVersion: 1,
    sources: packageSources,
  })
}

export function createProductSpec(spec: ProductSpec | undefined): ProductSpec | undefined {
  if (!spec) return undefined
  const keys: Array<keyof ProductSpec> = [
    'audience',
    'constraints',
    'primaryAction',
    'problem',
    'successMetrics',
    'valueProposition',
  ]
  const entries = keys
    .map((key) => [key, spec[key]?.trim()] as const)
    .filter((entry): entry is readonly [keyof ProductSpec, string] => Boolean(entry[1]))

  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}
