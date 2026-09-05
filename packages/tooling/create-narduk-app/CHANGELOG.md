# @narduk-enterprises/create-narduk-app

## 0.2.3

### Patch Changes

- fbc9504: Bump the generated app's pinned
  `@narduk-enterprises/narduk-mapkit-nuxt` version so new apps scaffold onto the
  release that actually fixes the package's publish-time build (the prior pin
  bump shipped alongside a version that failed to publish).

## 0.2.2

### Patch Changes

- 8b48dba: Companion release for the narduk-core patch that moves
  `@narduk-enterprises/eslint-config` from a runtime dependency to an optional
  peerDependency (narduk-libs#154). No generator behavior change; this bumps the
  generator alongside its pinned `@narduk-enterprises/narduk-core` version per
  `scripts/check-generator-release-plan.mjs`.
- 74ca377: Bump the generated app's pinned
  `@narduk-enterprises/narduk-mapkit-nuxt` version so new apps scaffold onto the
  release that fixes the package's publish-time build.
- cc5bbbb: Release alongside the `narduk-app` minor bump (the new HTTP error +
  requestBody contract). `@narduk-enterprises/narduk-auth` depends on
  `@narduk-enterprises/narduk-app` via `workspace:*`, so Changesets'
  `updateInternalDependencies: "patch"` policy cascades a patch release to
  narduk-auth — which is itself a generator-owned pinned package
  (`create-narduk-app`'s `PACKAGE_VERSIONS`). This keeps the generator's pin in
  sync with that cascaded release. No behavior change in the generator itself.
- 0f2262a: Release alongside the `narduk-core` minor bump
  (`readApproximateLocation`) so the generator's `PACKAGE_VERSIONS` pin for that
  package ships at the version it is synced to. `create-narduk-app` writes that
  pin verbatim into every scaffolded app's `package.json`, so a release that
  moves the pinned package without republishing the generator leaves new apps
  pinned to a version the generator no longer names. No behavior change in the
  generator itself.
- 1721a1c: Pick up the `@narduk-enterprises/narduk-auth` minor release (opt-in
  `AUTH_LOCAL_PROVIDERS` advertisement for the local auth backend) in the
  generator's pinned package versions. No generator behavior changes.

## 0.2.1

### Patch Changes

- ee7452c: Bump the generated app's pinned `@narduk-enterprises/narduk-auth`
  version so new apps scaffold onto the release that consolidates the package's
  same-origin redirect guards.
- e5a0b33: Release alongside the `narduk-mapkit` / `narduk-mapkit-nuxt` patch
  bumps so the generator's `PACKAGE_VERSIONS` pins for those two packages ship
  at the versions they are synced to. `create-narduk-app` writes those pins
  verbatim into every scaffolded app's `package.json`, so a release that moves
  the pinned packages without republishing the generator leaves new apps pinned
  to a version the generator no longer names. No behaviour change in the
  generator itself.
- 927f7e3: create-narduk-app: pick up the `@narduk-enterprises/narduk-app-tools`
  minor release (`foundation:check`, D-WEBFOUND-2 Q5(a)/Q9(a)) so a freshly
  scaffolded app pins the version that ships the new command. No generator
  behavior changes; this is the release-plan companion changeset required
  whenever a generator-owned package pin moves (company-hq#628).
- d6e098e: Make the scaffolded `playwright.config.ts` port overridable via
  `PLAYWRIGHT_PORT`, flowing into `baseURL`, the `webServer` url, and the
  `webServer` command's `PORT` env. Previously the port was a fixed literal, so
  when two or more agent lanes (or a lane plus the developer) worked the same
  generated repo concurrently in separate worktrees, the second Playwright run
  would silently attach to the first lane's dev server and test the wrong build
  — with a green result (narduk-libs#62).

## 0.2.0

### Minor Changes

- 0fd5ee9: create-narduk-app: fix the `mapkit` capability to scaffold the live
  `@narduk-enterprises/narduk-mapkit` / `@narduk-enterprises/narduk-mapkit-nuxt`
  packages at `2.0.0` instead of the dead `@narduk-geo/narduk-mapkit*` scope
  pinned at `1.0.0` (narduk-libs#123). The `@narduk-geo` scope has not published
  since 1.1.1 and cannot publish again (narduk-mapkit#17); narduk-mapkit
  republished under `@narduk-enterprises` at `2.0.0` on 2026-08-28. A freshly
  scaffolded mapkit app previously installed a frozen, unpatchable dependency
  from a scope that no longer resolves for new consumers.

  The generated `.npmrc` now routes only `@narduk-enterprises/*` to GitHub
  Packages — the `@narduk-geo:registry=...` line is dropped, since every scoped
  package a generated app depends on now lives under `@narduk-enterprises`. The
  generated README note and the generated Renovate `matchPackageNames` group are
  updated to match.

### Patch Changes

- 7883246: create-narduk-app: stop scaffolding a health-check stub that shadows
  narduk-core's real one.

  Every generated app includes `@narduk-enterprises/narduk-core` as an implicit
  module (`moduleList()`), which registers a real DB-probing `/api/health` route
  via `addServerScanDir`. The generator also wrote an app-local
  `apps/web/server/api/health.get.ts` returning a trivial `{ ok: true }` stub —
  Nitro resolves an app-local `server/api/*` route before a module's scanned
  contribution with the same path, so every scaffolded app silently lost the
  real auth-table/D1/Postgres health check behind a stub that always says OK
  (company-hq#453 R4 audit finding). The generator no longer emits that file;
  narduk-core's own health route is now what a generated app actually serves.
  Patch: removes generated output only, no exported API changed.

## 0.1.15

### Patch Changes

- db8b0de: Generate the committed `.npmrc` auth line in the plain
  `${GH_PACKAGES_READ}` interpolation form.

  npm does not implement `${VAR-default}` substitution: it leaves the whole
  reference unsubstituted and sends the literal string as the token, so the
  generated `${GH_PACKAGES_READ-UNCONFIGURED}` line returned
  `401 ... cannot be authenticated with the token provided` even when the
  variable was set correctly. pnpm does implement the default form, which is how
  the shape passed review twice -- the estate tests on pnpm. A committed file
  has to work under whichever client runs it, so the plain form is the only
  correct one. The generator test pinned the broken string, asserting the defect
  rather than catching it; it now pins the plain form.

  Closes #93.

## 0.1.14

### Patch Changes

- 6575caf: Refresh the generated app's `@narduk-enterprises/narduk-testkit` pin
  to the release that adds the deterministic-capture, request-accounting and
  fixture-server subpaths. Generator behaviour is unchanged; this is the pin
  refresh `release-plan:check` requires when a generator-owned package version
  moves.

## 0.1.13

### Patch Changes

- 71340c8: Generate one packages-read credential name instead of three. The
  generated CI no longer sets a redundant `NODE_AUTH_TOKEN` alias, and no longer
  gives `actions/setup-node` the `registry-url`/`scope` inputs that made it
  write a competing userconfig `.npmrc` against that alias with
  `always-auth=true`. The committed `.npmrc` already routes both scopes and
  reads `GH_PACKAGES_READ`, so CI now maps the org secret into that single name.
  The generated README states both halves of the pair.

## 0.1.12

### Patch Changes

- 1d017c7: Persist sealed user-session cookies for 30 days by default so mobile
  browsers do not discard authentication when the browser is backgrounded or
  reclaimed. Callers can still provide a shorter or longer `maxAge` override.

## 0.1.11

### Patch Changes

- fa7670b: Render provider-aware login copy so email-only applications do not
  advertise Sign in with Apple.

## 0.1.10

### Patch Changes

- 8adb1ec: Add an opt-in local email/password setup and recovery pathway
  informed by the reusable PACC TRAC and Harvest Tracker patterns: digest-only,
  email-bound, single-use links; explicit redemption; safe local redirects;
  generic request responses; and persistent lockout. This is additive to local
  auth, leaves the Supabase pathway unchanged, and explicitly does not replace
  or bypass Cloudflare Access as an app's outer gate.

## 0.1.9

### Patch Changes

- 048670e: Track the @narduk-enterprises/eslint-config patch (the Tailwind theme
  override now requires the design-system capability pack) in generator-owned
  package pins.

## 0.1.8

### Patch Changes

- 95ec690: `@narduk-enterprises/eslint-config` v2: the estate lint config moves
  into narduk-libs (per HB-10 / D-DEMOTE-1 and narduk-libs#50), rebuilt for
  ESLint 10 on a replace-by-default basis — maintained third-party plugins
  wherever they cover the intent, 45 bespoke rules surviving out of 103 (every
  one with tests and no `testMode` bypasses), the proven-inverted hydration
  rules and dead Nitro security gates rebuilt against the executed deep-review
  proofs, legacy presets and the frozen nuxt-ui spec tier removed, and every
  code-corrupting autofixer gone. Consumer API (`createAppLintConfig`,
  `composeSharedConfigs`, the 14 capability packs) is signature-compatible;
  adopting v2 requires ESLint `^10` (peer). License corrected to UNLICENSED
  (D-PKG-5).

  **Three consumer-visible tightenings** land with the adversarial-hardening
  pass (full account in `DESIGN.md`):

  1. **Pack globs are nesting-safe.** `server/**`, `workers/**` and the auth
     pack's globs now match at any depth. A repository linted from an outer
     `cwd` — any monorepo, any app one level down, and every layer package's
     `runtime/server/**` — previously received **no** server or Cloudflare rules
     at all. Expect first-time findings in newly-covered trees. The two core
     rules the packs carry are gated out of `tests/**` and friends so the
     widening does not sweep in test code.
  2. **A route named like a test is a route.** `server/api/x.post.test.ts` is
     deployed by Nitro as `POST /api/x.post.test`, and the `.test.` infix no
     longer exempts it from the security tier. Inside a route tree only a real
     test or fixture _directory_ exempts a file. Move colocated route suites
     under `tests/` or `__tests__/`.
  3. **`no-restricted-imports` is order-independent.** All three contributing
     packs now assign one shared option, so a trailing `cloudflare` entry can no
     longer erase the relative-import and layer-source patterns — which it did
     for every consumer using `nardukTemplateStrictCapabilityPacks`. Those
     patterns start applying again. A portable Nuxt layer (no `#server/*` alias
     for its own sources) should assign the new
     `PORTABLE_LAYER_RESTRICTED_IMPORTS_RULE` export to its server glob rather
     than switching the rule off.

  Also fixed in the same pass: five ways to walk past a security rule by
  renaming a binding (an aliased `defineEventHandler`, a runtime-derived HTTP
  method, `.raw` lifted off drizzle's `sql`, a destructured `db.query` receiver,
  and `limit: undefined`), and `no-legacy-overlay-model`'s blindness to
  camelCase `modelValue` bindings. Every one ships with the fixture that proved
  it as a regression test.

  Sibling packages: the shared config is now consumed via the workspace
  (`workspace:*`) and their `eslint` devDependency moves to `^10.8.0`. Adopting
  v2 also swept their stale `eslint-disable` comments onto the replacement rule
  ids and cleared the findings the fixed path gates newly surface. Three
  behaviour-neutral source edits came with that sweep: `narduk-core` adds
  `import.meta.client` early returns to three handlers that were already
  client-only (clipboard copy, share-link copy, avatar canvas resize);
  `narduk-auth`'s `runtime-public` endpoint drops a `process.env` merge layer
  that `readWorkerRuntimeEnv` already supplied and that the merge order
  discarded; and `narduk-app-tools` swaps one `split().join()` for
  `replaceAll()`. The five layer packages (`narduk-core`, `-auth`, `-seo`,
  `-ai`, `-uploads`) assign the portable-layer import rule in their own configs,
  and `narduk-core` and `-uploads` carry scoped, commented exceptions for the
  pre-existing conditions their newly-linted `runtime/server/**` trees surfaced.

## 0.1.7

### Patch Changes

- d22cd3d: Import Nuxt runtime helpers explicitly in packaged analytics plugins
  so consumer builds hydrate without relying on ambient package-source
  auto-import transforms.

## 0.1.6

### Patch Changes

- e030789: Configure the local Lucide server and core-header client bundles
  before Nuxt UI installs its icon module, and generate the core module before
  Nuxt UI so that ordering remains deterministic in packed consumers.

## 0.1.5

### Patch Changes

- 256c696: seo: make the Narduk network directory endpoint injectable with no
  default

  The network directory endpoint is now supplied by the consuming app through
  `nardukSeo.networkDirectoryUrl` (or `NUXT_PUBLIC_NARDUK_NETWORK_DIRECTORY_URL`
  at runtime) and has **no built-in default**. When it is unset the feature
  disables itself: `/api/narduk-network/sites` performs no outbound fetch,
  `useNardukNetworkDirectory()` skips its request, `/narduk-network` renders an
  empty directory, and `LayerNetworkFooter` omits the directory link. Failing
  quiet is deliberate — the directory is a marketing cross-link surface, not a
  gate.

  Previously the endpoint was derived from a package-owned catalog hostname, so
  every app installing this package polled a host it never chose. A published
  library must not pin its consumers to one origin.

  BREAKING CHANGES:

  - `NARDUK_DEFAULT_CATALOG_BASE_URL` is no longer exported.
  - `resolveNardukNetworkDirectoryUrl(value)` now takes the full directory URL
    (not a catalog base URL) and returns `null | string` instead of `string`.
  - `resolveNardukCatalogBaseUrl(value)` returns `null | string` instead of
    falling back to a hardcoded hostname.
  - `/api/narduk-network/sites` responses gained `configured: boolean`, and
    `catalogUrl` / `directoryUrl` may now be `null`.
  - Apps that want `/narduk-network` populated must set the new option;
    upgrading without setting it turns the directory off rather than repointing
    it.

- e4c8262: Replace implicit reliance on `narduk-core`'s Nuxt auto-imports
  (`useAppFetch`, `formatBuildTimeLocal`, `useLogger`, `requireAdmin`) with
  explicit imports from `@narduk-enterprises/narduk-core/*` subpaths.

  These composables/utils were previously called as bare globals, which only
  resolves when a consuming app registers `narduk-core`'s Nuxt module with its
  default options (`app: true`). A consumer that narrows the module surface (for
  example `{ app: false, server: true }`, used by `spacex-ipo` to avoid a
  component-registration collision with `narduk-seo`'s own `LayerAppFooter`)
  fails `nuxt typecheck` with `Cannot find name 'useAppFetch'` the moment it
  also depends on `narduk-seo` or `narduk-auth`, because those packages'
  composables/components still assumed the global was present.

  No behavior change: each site now imports the exact same function it was
  already calling implicitly.

  Bump `create-narduk-app` in step so its generated-app pins for `narduk-seo`,
  `narduk-auth`, and `narduk-analytics` refresh to these patched versions.

## 0.1.4

### Patch Changes

- 0783806: Track the @narduk-enterprises/narduk-seo minor (host-aware runtime
  indexing) in generator-owned package pins.
- 0783806: Restore a warning-free packed consumer install after upstream Nuxt
  4.5 drift.

  `nuxt-og-image` moves from 6.7.2 to 6.7.4. 6.7.2 pinned `oxc-parser@^0.138.0`,
  which cannot satisfy the `oxc-parser@>=0.140.0` optional peer that `unctx@3`
  declares once `@nuxt/kit@4.5.0` is resolved, so a Nuxt-less external consumer
  install emitted an unmet-peer warning.

  The generated app now pins `@nuxt/kit` to its exact `nuxt` version, and pins
  `nuxt-og-image` to the 6.7.2 release built for that `@nuxt/kit`. The generator
  pins `nuxt` exactly while the Narduk modules depend on `@nuxt/kit@^4.0.0`, so
  before this the app resolved a `@nuxt/kit` newer than its own `nuxt` as soon
  as upstream published a Nuxt minor, and inherited that kit's transitive
  dependency block instead of the one its pinned Nuxt was built with.

## 0.1.3

### Patch Changes

- a783f18: Ignore stale package-manager entrypoints and fall back to the
  executable installed in `PNPM_HOME`, keeping repeated migration runs
  independent of `PATH`.

  Update generated-app package pins for the corrected app-tools release.

## 0.1.2

### Patch Changes

- 435cc56: Run Wrangler through the package manager entrypoint that launched
  `narduk-app`, avoiding PATH-dependent migration failures on repeated CI
  invocations.

  Update generated-app package pins for the corrected app-tools release.

## 0.1.1

### Patch Changes

- 7848187: Publish the generator with the exact neutralized package versions
  produced by this release.
