# @narduk-enterprises/narduk-core

## 1.23.2

### Patch Changes

- e202cfd: Disable analytics identifiers, loading, and replay on noncanonical
  Workers/Pages preview hosts and explicit nonproduction deployments. The same
  immutable version keeps production analytics when promoted to its canonical
  hostname.

  Avoid a client lifecycle warning while retaining noindex robots metadata on
  noncanonical hosts.

- 37c03e2: Publish the server-only module package Nuxt config fragment once as
  `@narduk-enterprises/narduk-core/nuxt-module-package-config`, and consume it
  from `narduk-tenancy`. A `packages/modules/*` package that ships no `app/`
  tree and sets no explicit `srcDir` keeps the package root as srcDir, so
  `nuxt typecheck` otherwise pulls `eslint.config.mjs` and the untyped `.mjs`
  sources of `@narduk-enterprises/eslint-config` into the type project
  (narduk-libs#176).

  Pin `create-narduk-app`'s own `prettier` devDependency to the one workspace
  version (`3.9.4`). Its published manifest declared the exact `3.8.3`, so a
  consumer installing it from the packed artifact — outside the workspace where
  `pnpm.overrides` applies — resolved a prettier that formats a multi-member
  union differently from CI, re-creating narduk-libs#175 one hop out.

## 1.23.1

### Patch Changes

- aaf5549: Change the shared PostHog session replay default to off. Apps can
  continue to opt in with `POSTHOG_SESSION_REPLAY_ENABLED=true`; the build
  default and Worker runtime overlay now agree.

## 1.23.0

### Minor Changes

- 6297a08: Route core logging through the shared Narduk Logging package while
  retaining old imports, calls, scopes and legacy verbosity. New generated apps
  configure service identity, info-level logging and request completion
  summaries explicitly.

## 1.22.0

### Minor Changes

- def589f: Add an opt-in cspMediaSrc configuration for video and audio origins,
  including blob-backed MSE playback, while retaining same-origin media by
  default.

## 1.21.0

### Minor Changes

- 0f2262a: Add `readApproximateLocation(event)`
  (`@narduk-enterprises/narduk-core/server/utils/approximateLocation`),
  narduk-libs#76 Wave 2's "Cloudflare approximate IP location helper".

  Reads the visitor's approximate location from whichever Cloudflare signal the
  runtime exposes — Nitro's `cloudflare_module` request-`cf` object (preferred;
  always populated on a real Cloudflare deployment) or the `cf-ip*` request
  headers a zone adds only when "Add visitor location headers" is enabled — and
  returns the same `{ label, lat, lon, source: 'ip' }` shape either way, or
  `null` when neither signal carries usable coordinates.

  Extracted from riverstatus `server/api/v1/location/approximate.get.ts`
  (`readCloudflareLocation`, request-`cf` reader) and borderwaitstat-us
  `server/api/geo/ip.get.ts` (`cf-ip*` header reader); the borderwaitstat-us
  version's Vercel-header fallback is app-specific migration cruft and was not
  carried over. This is the library half only — an app's own
  `server/api/.../*.get.ts` route still owns its URL path and response envelope
  and now calls this helper instead of reading Cloudflare signals itself;
  consumer migrations are tracked as follow-ups, not included in this change.

### Patch Changes

- 8b48dba: Move `@narduk-enterprises/eslint-config` out of narduk-core's runtime
  `dependencies`. Since 1.20.2 it was pinned there at `workspace:*`, which
  publishes as the current eslint-config major, so a patch bump of narduk-core
  silently dragged consumers from eslint-config v1 onto v2 and broke `lint` for
  anyone who hadn't migrated yet (narduk-libs#154, surfaced by been-sober-for PR
  #96).

  narduk-core re-exports `eslint-app-config.mjs` and
  `eslint-nuxt-flat-fragments.mjs`, which import from
  `@narduk-enterprises/eslint-config`, as public subpath exports for consumers'
  own ESLint configs, so it is not a pure `devDependency` — it is now an
  **optional peerDependency** (`>=1.2.17 <3`), matching the range of
  eslint-config majors the re-exported fragments are known to work with. It also
  stays a `devDependency` for narduk-core's own `lint`/`build`. Consumers who
  don't use those re-exported fragments no longer get eslint-config forced onto
  them at all; consumers who do must bring their own compatible eslint-config
  version instead of receiving whatever major narduk-core last published
  against.

## 1.20.5

### Patch Changes

- d6e098e: Fix two small bugs from the W2 hardening batch (narduk-libs#124):

  - `useAppFetch()` threw `useRequestFetch is not defined` when called from a
    consuming app, because it relied on a Nuxt auto-import that never resolves
    from `node_modules`. It now imports `useRequestFetch` explicitly from
    `#imports`, matching the pattern every other composable in this package
    already uses (narduk-libs#59).
  - Removed the orphaned `showcaseAuthLoginTest` rate-limit policy. Its only
    consumer, `useAuthApi().loginAsTestUser()`, was removed from narduk-auth in
    an earlier correctness pass, and the `/api/auth/login-test` endpoint it
    guarded has never existed in this repo (narduk-libs#96).

## 1.20.4

### Patch Changes

- 1d017c7: Persist sealed user-session cookies for 30 days by default so mobile
  browsers do not discard authentication when the browser is backgrounded or
  reclaimed. Callers can still provide a shorter or longer `maxAge` override.

## 1.20.3

### Patch Changes

- Updated dependencies [048670e]
  - @narduk-enterprises/eslint-config@2.0.1

## 1.20.2

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

- Updated dependencies [95ec690]
  - @narduk-enterprises/eslint-config@2.0.0

## 1.20.1

### Patch Changes

- e030789: Configure the local Lucide server and core-header client bundles
  before Nuxt UI installs its icon module, and generate the core module before
  Nuxt UI so that ordering remains deterministic in packed consumers.

## 1.20.0

### Minor Changes

- 7848187: Remove template composition and Command-only contracts from
  `narduk-platform`, retire core PWA and control-plane behavior, and source the
  SEO network directory from the independent catalog origin.

### Patch Changes

- 7848187: Replace the template-era dynamic database aliases with the private
  `#narduk-core/schema` and `#narduk-core/postgres-runtime` Nuxt contracts. Core
  now derives secure session-cookie defaults from the request protocol so local
  HTTP development remains usable while HTTPS stays secure. Auth's packaged
  runtime now imports its own composables and server helpers explicitly, with
  boundary checks that prevent implicit template-era auto-import dependencies
  from returning.
- 7848187: Keep known VueUse 14.3 annotation noise out of production build logs
  without hiding app-source warnings, and make packaged SEO routes and Takumi
  rendering self-contained in downstream Nuxt consumers.
- Updated dependencies [7848187]
  - @narduk-enterprises/narduk-platform@2.0.0
