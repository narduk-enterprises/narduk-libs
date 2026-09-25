import type { Capability, GeneratedDatabaseBackend, ProductSpec } from './types.js'

/**
 * The generator's own single source for each toolchain, mirroring the contract
 * `narduk-app foundation:check:toolchain` (item 11) enforces in a generated app:
 * one declared value, every emission site reading it. Before this, `24.21.0`
 * appeared in four places and `10.33.4` in three, so a bump was a grep.
 *
 * In the SCAFFOLD, `NODE_VERSION` is written to `.node-version` (the app's Node
 * source) and mirrored into `engines.node` / `volta.node`, which Volta and npm
 * can only read from a manifest. `PACKAGE_MANAGER` is written to
 * `packageManager` (the app's pnpm source); corepack, pnpm and
 * `pnpm/action-setup` all read it natively, so nothing mirrors it.
 */
export const NODE_VERSION = '24.21.0'

export const PNPM_VERSION = '10.33.4'

export const PACKAGE_MANAGER = `pnpm@${PNPM_VERSION}`

export const PACKAGE_VERSIONS = {
  '@cloudflare/workers-types': '5.20260922.1',
  '@iconify-json/lucide': '1.2.108',
  '@narduk-enterprises/narduk-mapkit': '2.10.1',
  '@narduk-enterprises/narduk-mapkit-nuxt': '2.0.6',
  '@narduk-enterprises/narduk-app-tools': '0.23.0',
  '@narduk-enterprises/eslint-config': '2.4.1',
  '@narduk-enterprises/narduk-ai': '0.3.25',
  '@narduk-enterprises/narduk-analytics': '1.25.2',
  '@narduk-enterprises/narduk-auth': '1.30.2',
  '@narduk-enterprises/narduk-charts': '2.7.2',
  '@narduk-enterprises/narduk-core': '2.15.0',
  '@narduk-enterprises/narduk-logging': '0.4.1',
  // Pinned for its `pnpm.overrides` entry only: narduk-platform is never a
  // direct dependency of a generated app. narduk-core, narduk-ai and
  // narduk-auth each ship it as `workspace:*`, so the app installs it three
  // ways down and needs one version named for all of them. `versions:sync`
  // keeps this pin on the workspace version like any other.
  '@narduk-enterprises/narduk-platform': '2.2.0',
  '@narduk-enterprises/narduk-seo': '2.7.1',
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
  '@narduk-enterprises/narduk-shell': '0.7.2',
  '@narduk-enterprises/narduk-testkit': '1.8.1',
  '@narduk-enterprises/narduk-uploads': '1.21.4',
  // Explicit module (see generate.ts's moduleList -- narduk-core's own
  // installModule('@nuxt/ui') nests an installModule('@nuxt/icon') call too
  // deep in the setup chain to finish registering the icon client-bundle
  // virtual file before build; making it explicit here fixes that, matching
  // the reference app's own modules array and devDependency exactly.
  '@nuxt/icon': '2.5.1',
  '@nuxt/test-utils': '4.0.3',
  '@nuxt/ui': '4.11.1',
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
  // narduk-seo@2.6+ treats this as an optional peer (narduk-libs#170).
  // Generated SEO apps still call useSeo() with runtime OG on by default,
  // so the scaffold must install the peer -- otherwise packed-consumer-smoke
  // typecheck/build warns and the #316 /_og/ proofs receive /og.png.
  'nuxt-og-image': '6.8.0',
  '@nuxt/eslint': '1.15.2',
  prettier: '3.8.3',
  tailwindcss: '4.3.2',
  typescript: '6.0.3',
  vitest: '4.1.6',
  'vue-tsc': '3.2.5',
  wrangler: '4.136.3',
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
  seo: ['@narduk-enterprises/narduk-seo', 'nuxt-og-image'],
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
    packageManager: PACKAGE_MANAGER,
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
      // Test-only NUXT_* values: the private reusable workflow does not
      // inherit caller job env, and narduk-seo throws on a non-dev build
      // when NUXT_OG_IMAGE_SECRET is empty. Public CI also sets these on
      // the quality/browser jobs; they stay here so both variants work.
      // Literal, not imported from ci-test-env.ts: repo scripts load this
      // file with Node's own type stripping (consumer-smoke-fixture.mjs), so
      // it must have no runtime imports. ci-workflow.test.ts pins the two
      // copies together.
      'build:ci':
        'NUXT_OG_IMAGE_SECRET=narduk-test-only-og-image-secret-000000 ' +
        'NUXT_SESSION_PASSWORD=narduk-test-only-session-password-000000 ' +
        'NARDUK_CLOUDFLARE_BUILD=1 NITRO_PRESET=cloudflare_module pnpm run build',
      // Workers Builds sets SKIP_DEPENDENCY_INSTALL=1, so this script must
      // install before `narduk-app` / `nuxt` exist. The frozen install reads
      // `@narduk-enterprises/*` from `https://npm.nard.uk` with no token.
      // `scripts/gh-packages-run.mjs` remains opt-in break-glass.
      'cf:build': 'pnpm install --frozen-lockfile && pnpm --filter web run cf:build',
      'cf:deploy': 'pnpm --filter web run cf:deploy',
      'cf:deploy:preview': 'pnpm --filter web run cf:deploy:preview',
      ...(databaseBackend === 'none'
        ? {}
        : {
            'db:migrate:local': 'pnpm --filter web run db:migrate:local',
            'db:migrate:remote': 'pnpm --filter web run db:migrate:remote',
            'dev:seed': 'pnpm --filter web run dev:seed',
            'db:status:production': 'pnpm --filter web run db:status:production',
            'db:status:preview': 'pnpm --filter web run db:status:preview',
          }),
      deploy: 'pnpm --filter web run deploy',
      'deploy:dry-run': 'pnpm --filter web run deploy:dry-run',
      'deploy:dev': 'pnpm --filter web run deploy:dev',
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
      // eslint AND prettier. `lint` is the command a contributor or agent
      // reaches for, and CI fails a prettier-only diff through the separate
      // root `format:check` (the first entry in the reusable workflow's
      // `extra-scripts`), so an eslint-only `lint` is a false green that
      // costs a whole CI cycle for whitespace -- narduk-libs#628. The root
      // check is the one composed here, not apps/web's: only it reaches
      // `.changeset/`, root Markdown and `.github/`.
      lint: 'pnpm --filter web run lint && pnpm run format:check',
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
      // `build:ci`, not `build`: CI builds with `build:ci` on both paths (the
      // private caller's `build-script:` input, the public browser job's own
      // step), and `build` alone throws on any `seo` app because narduk-seo
      // refuses a non-dev build with an empty NUXT_OG_IMAGE_SECRET. The local
      // gate therefore went red where CI was green, and the only way to run
      // it was to know the two test-only placeholders out of band
      // (narduk-libs#617). `build` stays the real-secret path for `cf:build`
      // and operator recovery.
      'quality:static':
        'pnpm run format:check && pnpm run lint && pnpm run knip && pnpm run manifests:validate && pnpm run foundation:shared-ui-pinned && pnpm run typecheck && pnpm run build:ci && pnpm run test:unit',
      'hotfix:check':
        'pnpm run format:check && pnpm run lint && pnpm run knip && pnpm run manifests:validate && pnpm run foundation:shared-ui-pinned && pnpm run typecheck && pnpm run test:unit',
      'deploy:hotfix': 'pnpm --filter web exec narduk-app deploy-hotfix',
      'hotfix:build':
        'NARDUK_CLOUDFLARE_BUILD=1 NITRO_PRESET=cloudflare_module pnpm --filter web run cf:build',
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
      // Root-level for the same reason as narduk-app-tools above: the root
      // `playwright.config.ts` imports the shared local-dev-port resolver
      // (narduk-libs#417) at config-load time, and pnpm will not resolve the
      // web workspace's own copy from here.
      '@narduk-enterprises/narduk-testkit': PACKAGE_VERSIONS['@narduk-enterprises/narduk-testkit'],
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
        //
        // This literal is the same shape that reddened gonogo's first safe
        // Dependabot lane PR (gonogo#106: nuxt bumped to 4.5.2, this literal
        // did not move, `@nuxt/kit` stayed behind, `buildDiagnostics` import
        // broke). gonogo#108's fix -- `"@nuxt/kit": "$nuxt"` -- does NOT
        // transfer here as a plain substitution: pnpm only resolves `$<name>`
        // against a dependency declared in the SAME package.json as
        // `pnpm.overrides` (this one, the root manifest), and `nuxt` is a
        // dependency of apps/web/package.json, not this one (confirmed
        // empirically -- a bare `$nuxt` here fails `pnpm install` with
        // "Cannot resolve version $nuxt in overrides"). Every other
        // `@narduk-enterprises/*` override below has the identical problem:
        // none of their referenced packages are direct dependencies of this
        // root manifest either. Making any of them track-by-reference needs
        // that package anchored as a real root-manifest dependency too --
        // narduk-libs#282's already-tracked follow-up, not done here.
        '@nuxt/kit': PACKAGE_VERSIONS.nuxt,
        'eslint-plugin-vitest>@typescript-eslint/utils':
          PACKAGE_VERSIONS['@typescript-eslint/utils'],
        esbuild: PACKAGE_VERSIONS.esbuild,
        glob: PACKAGE_VERSIONS.glob,
        // Speed, not security. Miniflare pins its undici exactly (7.29.0 in
        // 5.20260921.0-alpha), and below 7.29.1 every D1 call a test makes
        // through narduk-testkit costs ~6.5ms instead of ~2ms, so seed-heavy
        // suites time out on the CI pool (narduk-libs#740). A floor rather
        // than a pin, so a lockfile refresh can still move it forward.
        'miniflare>undici': '^7.29.1',
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
      // narduk-lint (from @narduk-enterprises/eslint-config) replaces
      // `eslint . --max-warnings 0`: errors fail, warnings are held to the
      // checked-in apps/web/lint-budget.json, which starts empty.
      lint: 'nuxt prepare && narduk-lint',
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
            'db:status:production': 'narduk-app db migrate-deployment --target production --check',
            'db:status:preview': 'narduk-app db migrate-deployment --target preview --check',
            'db:migrate:local':
              'narduk-app db migrate --config migrations.sources.json --database ' +
              appName +
              '-db --local',
            'db:migrate:remote':
              'narduk-app db migrate --config migrations.sources.json --database ' +
              appName +
              '-db --remote',
            // Local only and credential-free (narduk-libs#378): migrate the
            // local D1, then load seed/ through Wrangler local mode.
            'dev:seed': 'pnpm run db:migrate:local && narduk-app dev:seed',
          }),
      deploy: 'narduk-app deploy deploy',
      'deploy:dry-run': 'narduk-app deploy deploy --dry-run',
      // Development mode (company-hq#781): refuses unless this workstation holds
      // an activation record from `narduk-app development enter`.
      'deploy:dev': 'narduk-app development deploy',
      'deploy:local': 'narduk-app deploy-local',
      'deploy:version': 'narduk-app deploy versions-upload',
      // Nuxt DevTools explicitly skips TEST processes. The browser fixture
      // exercises the app, without the interactive development toolbar and
      // its Vite 8-incompatible config-retriever hook.
      'dev:test': 'narduk-app og:generate --if-missing && TEST=1 nuxt dev --host 127.0.0.1',
      doctor: 'narduk-app doctor',
      // pnpm runs these with the cwd at apps/web, and both items read the
      // checkout from the repository root: its manifests, Config/
      // cloudflare-app.json, the wrangler config. That root is `../..`. `..` is
      // apps/, where item 12 found no deployment block and reported N/A with
      // exit 0 (narduk-libs#679).
      'foundation:deployment': 'narduk-app foundation:check:deployment --checkout ../..',
      'foundation:shared-ui-pinned':
        'narduk-app foundation:check:shared-ui-pinned --checkout ../..',
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
