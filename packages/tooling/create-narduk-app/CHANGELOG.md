# @narduk-enterprises/create-narduk-app

## 0.10.2

### Patch Changes

- 448e86f: `createNardukDataClient` no longer re-downloads an unchanged release
  when its TTL lapses. If the manifest still names the same release and artifact
  checksum, the client keeps the cached value (and its object identity) and
  fetches only the manifest.
- 7142305: `useSsrNow(key, { tickMs })` also re-reads the browser clock when the
  page becomes visible again, so a viewer returning to a background tab sees
  current relative ages at once instead of after the next (throttled) tick. The
  listener is registered only for a ticking clock and removed on unmount. This
  closes the last gap between `useSsrNow` and the Buoys map clock it
  generalises. `create-narduk-app` is a companion patch so the generator pin
  moves with the core patch.

## 0.10.1

### Patch Changes

- 4599aa7: `createNardukDataClient` can now read a release's secondary
  artifacts, the ones the manifest lists in `artifacts[]` beside the primary
  `artifact`. Set the new `NardukDataProduct.entryPath` option to a
  release-relative path, for example
  `consumer/lakes/texas/canyon-lake/history-1y.json`.

  - The path may have several segments, each of which must be a plain name.
  - The entry is checked against its own listed SHA-256, with the usual timeout,
    retry, single-flight, memo, stale-if-error and freshness handling.
  - A release that does not list the entry fails with the new `NardukDataError`
    reason `'missing'`, so consumers can answer "not published" rather than
    reporting an outage. It never falls back to the primary artifact.

  Reads without `entryPath` are unchanged (#552).

- 4ba5d02: AppLightbox gains optional thumbnail rails (0–2 labelled rails, each
  with its own keyboard axis) and a `side` slot for per-picture details.
  `AppImage` wraps remote pictures with loading and failed states.
  `AppSnapStrip` is a horizontal scroll-snap strip with an en-dash position
  readout (narduk-libs#529). `create-narduk-app` is a companion patch so the
  generator pin moves with the core minor.
- c1c8b42: Add the narduk-shell data-table family — `NeDataTable` (UTable preset
  with column groups, units, tabular numerals, the missing dash, day/group rows,
  a pinned first column, the phone column-set switch, the break row, and
  loading), `NeSortHeader`, `NeCsvDownload`, plus `toCsv` / `parseSort` from the
  package root — and extend `NePager` with `pageSizes`, `mode` (`pages` | `more`
  | `auto`), `moreStep`, `maxLimit` and `update:limit`. narduk-timeseries gains
  `bucketReadings` (1h / 3h / 1d min/avg/max; missing is `null`, not `0`).
  create-narduk-app is patched because it pins narduk-shell (narduk-libs#528).
- dd1a7d9: `createConsoleTracker` accepts URL-scoped ignore rules
  (`{ text: RegExp; url?: RegExp }`) and records 4xx/5xx response URLs so an
  object rule's optional `url` matches the request that actually failed. Bare
  `RegExp[]` call sites stay unchanged (narduk-libs#134). `create-narduk-app` is
  a companion patch so the generator pin moves with the testkit release.

## 0.10.0

### Minor Changes

- 92835a1: Generated apps lint through `narduk-lint`: `apps/web`'s lint script
  is `nuxt prepare && narduk-lint` (no more `--max-warnings 0`), and the
  generator emits an empty `apps/web/lint-budget.json` (`{ "rules": {} }`).

## 0.9.9

### Patch Changes

- bb37590: Pin generated apps to the narduk-core release with `useSsrNow` and
  migration `0006_user_id_indexes.sql`, and the narduk-testkit release with the
  `./d1` query harness. A newly generated app applies `0006` with its first
  `db:migrate:local` / `cf:deploy`.
- 36d9e18: `./testing` fake: a second `mapkit.init()` while the first token
  exchange is pending, or after it succeeded, is now an idempotent no-op instead
  of throwing `FakeMapKitNotImplemented` (K-7, narduk-libs#522). No new token is
  requested, the first call's options stand, and the call is logged as `init`
  with detail `ignored`. A second `init()` after a failed exchange still runs a
  new exchange, so `retry()` stays testable. New conformance tests pin the rect
  camera (K-5: `visibleMapRect`, `setVisibleMapRectAnimated`, `MapRect` /
  `MapPoint` / `MapSize`, `Map.MapTypes`) against the Web-Mercator maths buoys'
  shim used, in vitest and through `fakeMapKitInitScript()`, so buoys can delete
  both shims.
- 36d9e18: The Nuxt module's `/api/mapkit-token` route now applies **no rate
  limit by default** (narduk-libs#485). Since #436 it limited every app to 30
  requests per 60 s per routed origin; that ceiling is now opt-in.
  `ModuleOptions.rateLimit` is optional and has no default: set
  `nardukMapKit: { rateLimit: { limit, windowSeconds } }` to keep a ceiling. A
  limiter an app mounts on `event.context.nardukMapKit.rateLimit` still wins,
  with or without the option. With per-client keying of the default no longer
  needed, narduk-libs#512 is moot.

  Logan's decision (askme, 2026-09-18 14:23 CT): "whatever the least restrcitive
  reasonable option is.....i do NOT want rate limits to come up again....its
  super annoying and not a problem".

  `create-narduk-app` picks up the generator-owned narduk-mapkit pin.

## 0.9.8

### Patch Changes

- 8da7e33: Generated apps pin the narduk-core release that keys IPv6 rate-limit
  callers by `/64`, adds `nardukCore.csrf.exemptPaths`, and documents
  account-unique `namespace_id`s.
- 05b3ef9: Pick up narduk-core's per-request header strip on shared-cacheable
  responses and narduk-app-tools' edge-cache proof (narduk-libs#412, #418, #435)
  in newly generated apps' pins.
- c16bdfd: `foundation:check` now reads the registry for sub-check 2.3 from the
  project's own `@narduk-enterprises` scope route (narduk-libs#498). The reader
  takes the last `@narduk-enterprises:registry=` line in the checkout's
  `.npmrc`, the same rule as the shared CI workflows. A repo that routes the
  scope to the `https://npm.nard.uk` mirror, or to any other registry that is
  not GitHub Packages, is read anonymously. The reader sends no `Authorization`
  header there, so it needs no `NODE_AUTH_TOKEN`/`GH_TOKEN`/`GITHUB_TOKEN`.
  Repos with no route line, or a route to `npm.pkg.github.com`, keep the
  existing GitHub Packages Bearer read and its scope-probe 404 corroboration.
  Other scopes such as `@narduk-geo` stay on GitHub Packages.

  `create-narduk-app` takes a patch so generated apps pin the fixed
  `narduk-app-tools`.

- a82dc2d: Pick up the generator-owned pin bumps from narduk-logging 0.3.0 (the
  `QueryCounter` statement / round-trip counter, narduk-libs#325) and the
  dependents it re-releases.
- 49d2606: Pick up the generator-owned narduk-mapkit 2.2.0 pin (the Worker-safe
  token-route limiter export, narduk-libs#485).

## 0.9.7

### Patch Changes

- ad7a156: Give generated CI a committed test-only `NUXT_OG_IMAGE_SECRET` so
  `nuxt build` does not fail closed.

  narduk-seo now throws on a non-dev build when runtime OG is enabled and the
  secret is empty. Public `quality` / `browser` jobs set the Playwright
  placeholders as plain `env:` values (not repository secrets). The private
  reusable workflow cannot inherit caller env, so the same placeholders prefix
  `build:ci`. The Workers Builds runbook requires `NUXT_OG_IMAGE_SECRET` and
  `NUXT_SESSION_PASSWORD` as Build variables — Worker secrets are runtime-only.

- ad7a156: Ignore generated Wrangler `.dev.vars` secrets, and make `cf:build`
  authenticate before it installs.

  The scaffolded `.gitignore` now lists `.dev.vars` / `**/.dev.vars` /
  `.dev.vars.*` with a `!.dev.vars.example` carve-out, matching the existing
  `.env` pattern. Root `cf:build` runs a committed `scripts/gh-packages-run.mjs`
  (process-scoped temp userconfig from `GH_PACKAGES_READ`, then
  `pnpm install --frozen-lockfile`) so a Workers Builds dashboard that sets
  `SKIP_DEPENDENCY_INSTALL=1` actually has `node_modules` and registry auth
  before `nuxt build`. `narduk-app gh-packages-run` is the same helper for
  post-install callers.

## 0.9.6

### Patch Changes

- fe58c5f: SSR HTML is never shared-cache storable on an app that serves the
  nonce CSP (`nardukCore.security.headers` in `enforce` or `report-only` mode),
  because nuxt-security writes one per-request nonce into both the HTML and the
  CSP header and an edge cache would replay it to every visitor
  (narduk-libs#435). `setCacheProfile` refuses a cacheable profile on a page
  render with the new `nonce-csp-html` suppression reason, and a new
  `nonce-csp-cache` Nitro plugin pins `Cache-Control: private, no-store` on the
  final `text/html` response and strips `CDN-Cache-Control`,
  `Cloudflare-CDN-Cache-Control`, `Surrogate-Control`, `Cache-Tag`, `Expires`
  and `Age` however they got there. JSON API routes and Nuxt `_payload.json`
  responses keep their profile and stay edge-cacheable. In development, a page
  that asked for a cacheable profile logs one warning per path.

  `@narduk-enterprises/create-narduk-app` only re-releases so its pinned
  `@narduk-enterprises/narduk-core` version follows this patch
  (`scripts/check-generator-release-plan.mjs`'s generator-pin rule) — no
  generator behavior changes.

- cf8e05e: `<AppMapKit>` no longer loads `mapkit.core.js` twice
  (narduk-libs#469). The SSR preload's `useHead()` now runs during the server
  render only. Through 2.1.2 it also ran on the client, where unhead's DOM
  renderer had to recognise the server's `<script>` by hashing every attribute
  on it. Under a nonce CSP (narduk-core `security.headers`) the browser hides
  the tag's nonce as `nonce=""`, the hash never matched, and unhead appended a
  second copy, which MapKit reports as `Mapkit namespace already exists`. On the
  client, Apple's `@apple/mapkit-loader` is now the tag's only owner: it adopts
  the server's tag on an SSR page load and injects the single tag on a
  client-side navigation.

  `@narduk-enterprises/create-narduk-app` only re-releases so its pinned
  `@narduk-enterprises/narduk-mapkit` version follows this patch
  (`scripts/check-generator-release-plan.mjs`'s generator-pin rule). The
  generator's behavior does not change.

## 0.9.5

### Patch Changes

- 7ae9278: Thrown 4xx/5xx responses — including a 429 from
  `defineRateLimitedHandler` — now carry `Cache-Control: private, no-store` and
  drop `CDN-Cache-Control`, `Cloudflare-CDN-Cache-Control`, `Surrogate-Control`,
  `Cache-Tag`, `Expires` and `Age`, even when the route had already set a
  cacheable profile (e.g. `setCacheProfile(event, 'live')`) before throwing.
  Nitro's own error page otherwise ships `Cache-Control: no-cache`, which
  Cloudflare Workers Cache _stores_ and revalidates once an app turns on
  `"cache": { "enabled": true }`; `no-store` / `private` are the documented
  opt-out. This is a safe precondition for narduk-libs#435 (making
  `setCacheProfile`'s edge header actually hit) — do not enable Workers Cache in
  a consuming app until this release.

  The header-strip list that already backed the `preferences-cache` plugin
  (narduk-libs#386) moved to a new framework-free
  `runtime/shared/utils/shared-cache.ts` so the error path reuses it rather than
  duplicating it; `preferences.ts` re-exports the same names it always has, so
  no consumer import changes.

  `@narduk-enterprises/create-narduk-app` only re-releases so its pinned
  `@narduk-enterprises/narduk-core` version follows this patch
  (`scripts/check-generator-release-plan.mjs`'s generator-pin rule) — no
  generator behavior changes.

## 0.9.4

### Patch Changes

- 766ce96: Fix the estate CSP baseline refusing GA4's Google-signals beacon
  (narduk-libs#472). A GA4 property with Google signals enabled sends a second
  `page_view` beacon straight to `https://www.google.com/g/collect` (not a
  `*.google-analytics.com` host), with an `<img>` fallback at the same origin
  when `fetch`/`sendBeacon` is unavailable. Both the strict nonce-CSP baseline
  (`runtime/shared/security-headers.ts` `BASELINE_ALLOWLIST`) and the legacy
  enforcing middleware (`runtime/server/middleware/securityHeaders.ts`
  `BASELINE_CONNECT_SRC`) now allow `https://www.google.com` on `connect-src`;
  the legacy middleware's `img-src` already carries an `https:` wildcard that
  covers the same host, so it needed no change. A property that runs with Google
  signals off never sends this beacon and does not need the host.

  create-narduk-app re-releases so its generated package pins follow the
  narduk-core patch and its dependents.

- 86bdb58: Make `deployment.previewBindings` real, so item 12.4 can pass with
  non-production branch builds on (narduk-libs#473, deployment-standard design
  §3.3 option A).

  **The build now isolates a preview.** A `previewBindings` entry may name its
  preview resource with wrangler's own fields: `id` for KV, `database_id` and
  `database_name` for D1, `bucket_name` for R2. On a Workers Build whose
  `WORKERS_CI_BRANCH` is not `productionBranch`,
  `narduk-app deploy versions-upload` writes `.wrangler.deploy.preview.json`
  with every D1, KV and R2 binding rebound, and uploads with it. The rebinding
  is all or nothing. When any binding lacks its preview resource, or names a
  production one, the build keeps `.wrangler.deploy.production.json` exactly as
  before and prints a `WARNING`. `deploy`, the production branch, runs outside
  Workers Builds, an explicit `--env` target and apps without a valid
  `narduk-v1` block are unchanged.

  **12.4 checks the config the build would upload.** It runs the same planner
  against the app's own wrangler config.

  - It reports `pass` when every binding is rebound to a resource that is not a
    production one.
  - It reports `fail` when a preview entry names no binding of its kind, or when
    a preview id, name or bucket is a production one in any scope.
  - It stays `unknown` for bare names, a D1 entry missing its id or name, a TOML
    app config, or bindings in a second Worker's config.

  The artefact gains `previewConfig`, and the summary prints a `preview` line.

  A binding listed twice in one `previewBindings` kind now makes the block
  invalid. Before this change, the second entry was silently shadowed by the
  first.

  `create-narduk-app` adds `.wrangler.deploy.preview.json` to the generated
  `.gitignore` and `.prettierignore`.

## 0.9.3

### Patch Changes

- 62c69e0: Bump the pinned `@narduk-enterprises/narduk-mapkit` version to 2.1.2,
  so a newly generated app starts on the release that builds a late-mounted
  `<AppMapKit>` rather than on 2.1.1. No generator behavior changes — this only
  keeps the generator's own release in step with the release-plan guard's
  generator-pin rule (`scripts/check-generator-release-plan.mjs`), which
  requires a companion release whenever a changeset moves a package the
  generator pins by version literal.

## 0.9.2

### Patch Changes

- 554ae27: Bump the pinned `@narduk-enterprises/narduk-mapkit` version to 2.1.1,
  so a newly generated app starts on the release that fixes the ten adoption
  defects (narduk-libs#422) rather than on 2.1.0. No generator behavior changes
  — this only keeps the generator's own release in step with the release-plan
  guard's generator-pin rule (`scripts/check-generator-release-plan.mjs`), which
  requires a companion release whenever a changeset moves a package the
  generator pins by version literal.

## 0.9.1

### Patch Changes

- fa41027: Bump the generated-app pin for `@narduk-enterprises/narduk-core` (and
  the workspace dependents Changesets will move with it) so a fresh scaffold
  gets the empty `colorMode.classSuffix` and the report-only CSP that omits
  `upgrade-insecure-requests`. The generator templates do not set `classSuffix`
  themselves.
- cbee698: Fix the generated deployment runbook's promote snippet, which told
  every new app to promote the wrong commit (narduk-libs#451 defect 2).

  The snippet passed `--sha "$GITHUB_SHA"`, but the promote job runs on
  `workflow_run`, where `GITHUB_SHA` is the default branch's head at trigger
  time rather than the commit whose run completed -- so a commit that never
  passed `ci / Required` could reach production. The runbook now shows a
  `workflow_run` workflow excerpt binding `VERIFIED_SHA` to
  `${{ github.event.workflow_run.head_sha }}`, uses it for both the promote and
  the live proof, and states why `$GITHUB_SHA` is wrong there. It also records
  that the `--sha` lookup is bounded by `--max-versions` rather than capped at
  ten, and that a lookup finding nothing exits 3 and must be a red job.

- a1efa4e: Patch release alongside the `@narduk-enterprises/narduk-uploads`
  patch (the upload byte cap is now enforced while the body is read) so
  `@narduk-enterprises/create-narduk-app` can refresh its pinned
  `narduk-uploads` version in `src/manifest.ts`.
  `scripts/check-generator-release-plan.mjs` requires a generator release
  whenever a package it pins changes version. No generator behavior changes.

## 0.9.0

### Minor Changes

- 6b17cdf: Add `narduk-app e2e-serve <port>`, the shared prebuilt-Worker
  Playwright launcher the estate `nuxt-cloudflare` callable assumes every
  narduk-app has (narduk-libs#447).

  It serves an already-built `.output/server/index.mjs` through the app's own
  `wrangler` (`unstable_startWorker`, watch off), binds 127.0.0.1 only, refuses
  to compile a fallback, and writes `[e2e-serve]` startup notes to stderr so a
  stalled start is visible in Playwright's webServer log. Real worker errors
  pass through; the only filtered stderr is workerd's client-abort
  `kj::getCaughtExceptionAsKj() … ::write(…): Broken pipe` /
  `Connection reset by peer` block, lifted with its tests from Buoys `5b040144`
  (buoys#124 / PR #128).

  `create-narduk-app` now scaffolds `playwright.config.ts` so
  `E2E_PREBUILT_ARTIFACT=1` runs `narduk-app e2e-serve <port>` and the default
  stays `nuxt dev`, and documents that path in the generated e2e guide.

## 0.8.0

### Minor Changes

- 2c9f995: Teach a newly generated app the Narduk deployment standard
  (company-hq#745, deployment-standard design §2.1/§3.2; Logan approved every
  recommended option on 2026-09-17).

  `docs/workers-builds.md` previously taught the pre-standard model: a
  production deploy command that **deploys**, and non-production branch builds
  enabled for trusted branches. Both are now wrong, and the second is a live
  safety hole.

  - Both Cloudflare deploy commands are now `pnpm run cf:deploy:preview`, which
    runs `narduk-app deploy versions-upload`: it uploads a version that serves
    no traffic. A production command that deploys puts a `main` push straight
    into production, which is the one thing the standard exists to prevent. The
    doc says why the two are the same command and that the name is historical.
  - Non-production branch builds now start **disabled**. A version captures its
    binding _configuration_ but not the state behind it, and
    `preview_database_id` / `preview_id` / `preview_bucket_name` apply to
    `wrangler dev` only, so a branch build of an app that binds production D1,
    KV or R2 reads and writes production data from every pull request. The doc
    states the hazard and the exit from it: create a preview resource per
    binding, list them under `deployment.previewBindings`, then turn branch
    builds on.
  - The runbook now carries the exact `deployment` block to paste into
    `Config/cloudflare-app.json` at onboarding, plus the promote, live-proof and
    rollback commands.
  - A new `foundation:deployment` script runs
    `narduk-app foundation:check:deployment --checkout ..`.

  The generator still does not create `Config/cloudflare-app.json` itself. That
  file records live Cloudflare facts a checkout cannot know, onboarding owns it,
  and this generator does not hold a continuing relationship with an app's
  configuration. It emits the block to paste and a check that reads it.

  ## Review round 1

  The `deployment` block the runbook tells a new app to paste was ~24 hand-typed
  string literals, and the only assertions on it were substrings. Adding one
  required key to the schema would have shipped a generator whose paste-this
  block fails the very check it tells you to run — discovered by the first app
  to try it, not by CI. The block is now serialized from a single object, and
  the generator test extracts the fenced block, parses it, and asserts it equals
  `narduk-app-tools`' committed `fixtures/default-deployment-block.json` — which
  that package's own suite pins to `defaultDeploymentBlock()` and to
  `readDeploymentBlock` accepting it. The pin is a fixture rather than an import
  because the published generator must require nothing at runtime, and because
  CI's per-package gates run `pnpm --filter <name>` without building a workspace
  sibling's `dist`. Add a required key to the schema and `narduk-app-tools` goes
  red; update its fixture and this generator goes red until it emits the new
  block.

### Patch Changes

- 49e249b: Repin the generator's `@narduk-enterprises/narduk-app-tools`
  dependency to the release carrying the deployment-standard promote, rollback
  and live-proof commands. No generator behaviour changes.
- 8e6c388: Generate a `playwright.config.ts` that resolves its local dev port
  through `@narduk-enterprises/narduk-testkit/playwright/dev-port` instead of
  `Number(process.env.PLAYWRIGHT_PORT) || <scaffolded port>`, and add
  `@narduk-enterprises/narduk-testkit` to the generated app's root
  devDependencies so the root config can resolve it.

  A linked worktree of a generated app now gets its own derived port and refuses
  to reuse a server it did not start, which is what stops two lanes on one
  machine from silently testing each other's branch (narduk-libs#417). The
  primary checkout and CI keep the scaffolded port, so no pipeline behaviour
  changes.

- 96d1d4b: Refresh the generator's `@narduk-enterprises/narduk-seo` pin for the
  security.txt / AI-crawler policy release.
- 0c4ddd9: Bump the pinned `@narduk-enterprises/narduk-testkit` version to track
  its new `server/handlers` handler test harness (narduk-libs#380). No generator
  behavior changes — this only keeps the generator's own release in step with
  the release-plan guard's generator-pin rule
  (`scripts/check-generator-release-plan.mjs`), which requires a companion
  release whenever a changeset moves a package the generator pins by version
  literal.
- 77945b9: Move the generator's pinned `@narduk-enterprises/narduk-core` version
  — and the dependent pins that follow it — to the release carrying
  `defineValidatedHandler`. The generator emits these versions as string
  literals, so Changesets cannot see the coupling and the release-plan gate
  requires the generator to move with them. No generator behaviour changes.
- cfa085f: Re-pin the generated app's layer versions so a newly generated app
  starts on the narduk-core release that carries the narduk-data product client.

  No generator behaviour changes: the templates, prompts and generated files are
  identical. This is the pin refresh `scripts/check-generator-release-plan.mjs`
  requires whenever a generator-owned package is released, so a generated app
  does not start life on a narduk-core older than the one the estate just
  shipped.

- 310121b: Add `@narduk-enterprises/narduk-mapkit/testing`: a deterministic,
  offline fake of MapKit JS v6 for component and end-to-end tests.

  The fake is modelled on a measured spike against real MapKit JS 6.0.128 rather
  than on the documentation alone. It covers `load()` with library gating,
  `init()` with the `configuration-change` and `error` events (Apple's seven
  `ConfigurationErrorStatus` values verbatim), scriptable authorization outcomes
  including the measured origin-mismatch shape (the same token retried three
  times, `authorizationCallback` invoked exactly once, then `Unauthorized`), an
  injected access-key clock, `mapkit.Map`, the three annotation classes, and the
  value types. Anything it does not model throws
  `FakeMapKitNotImplemented: <member>` instead of silently answering
  `undefined`.

  A separate inspection surface records an operation log with per-annotation
  add/remove counts, so a component test can assert a reconciliation budget --
  "updating 1 of 600 pins touched 1 annotation, not 600" -- rather than only a
  final-state outcome. `fakeMapKitInitScript()` serialises the whole fake for
  Playwright's `page.addInitScript`; it is one self-contained function, so there
  is no bundler step and no second implementation.

  `./testing` is a dev-time export: it carries no runtime dependency, and an
  import-graph test asserts no production entry point can reach it. The fake's
  public types are declared structurally, so the published `.d.ts` resolves
  without Apple's types installed, while a type-level conformance suite compares
  it member by member against `@types/apple-mapkit` v6 and fails typecheck on
  drift.

  `@narduk-enterprises/create-narduk-app` gets a patch release so it can refresh
  its pinned `narduk-mapkit` version in `src/manifest.ts`
  (`scripts/check-generator-release-plan.mjs` requires a generator release
  whenever a package it pins changes version). No generator behavior changes.

- 31a43a7: Correct published packaging declarations so they match what these
  packages already require at install time. This is not a runtime change.

  Nine Nuxt modules already depend on `@nuxt/kit` `^4.0.0`, which does not run
  on Nuxt 3, but advertised `peerDependencies.nuxt` as `>=3.16.0`. The peer is
  now `>=4.0.0`, matching narduk-shell and narduk-mapkit-nuxt. `narduk-core` and
  `narduk-realtime` also raise `@nuxt/schema` to `>=4.0.0` so it matches `nuxt`.
  `narduk-core` and `narduk-analytics` add exact `./app/types/*` entries for the
  `.ts` files that the `*.d.ts` export pattern could not resolve. The analytics
  key exports runtime `const`s, so it carries `types` then `import` then
  `default`. Core `./app/types/api` stays types-only because that file is
  interfaces. `narduk-app` declares `zod` `^4.4.3` as an optional peer (kept in
  `devDependencies`) so consumers that typecheck `./server/request-body` can
  resolve `z.ZodType` without warning HTTP-only consumers. `narduk-shell`
  tightens `vue-router` to `^5.3.1` so the published package matches `@nuxt/ui`
  `4.8.1` and the workspace override.

  ## Operator action

  The Nuxt 4 peer (`nuxt` and, where declared, `@nuxt/schema`) is a
  consumer-visible floor raise, so the nine modules that advertised Nuxt 3 ship
  as `minor`. Every narduk-app in the estate is already on Nuxt 4; Buoys is on
  4.5.2. A remaining Nuxt 3 app cannot take this release — and already could not
  run these modules, because they depend on `@nuxt/kit` `^4.0.0`.
  `create-narduk-app` is a companion patch so generator pins move with the
  minors. `narduk-app` (optional zod peer) and `narduk-shell` (vue-router
  already at UI 4.8.1) stay `patch`.

- e8e6892: Patch release alongside the `@narduk-enterprises/narduk-logging`
  minor release (request ID `cf-ray` fallback, `Server-Timing` emitter,
  slow-route logging) so `@narduk-enterprises/create-narduk-app` can refresh its
  pinned `narduk-logging` version in `src/manifest.ts`
  (`scripts/check-generator-release-plan.mjs` requires a generator release
  whenever a package it pins changes version). No generator behavior changes.
  `narduk-app-tools`, `narduk-realtime`, `narduk-shell`, and `narduk-testkit`
  release together with the generator per the workspace's own linked-release
  contract; none of them changed.

  `@narduk-enterprises/narduk-mapkit-nuxt` is deliberately **not** in that list.
  It is frozen at 2.0.x (`packages/modules/narduk-mapkit/docs/api-2.1.md` §a)
  and its source on `main` is now the 2.1 contract, so any release from `main`
  would publish a 2.1 adapter under a 2.0.x version number. The freeze is
  enforced by the Changesets `ignore` entry in `.changeset/config.json`; this
  changeset only stops naming it.

## 0.7.0

### Minor Changes

- 1af628c: Scaffold the single-source toolchain shape, and single-source the
  generator's own copy of it.

  A generated app now declares its Node version once, in `.node-version`, and
  its pnpm version once, in the root manifest's `packageManager`. Both workflows
  read those rather than restating them: `ci.yml` passes
  `node-version-file: .node-version` to the shared workflow (workflows#97),
  `copilot-setup-steps.yml` passes the same to `actions/setup-node`, and
  `pnpm/action-setup` drops its `version:` input so it resolves `packageManager`
  itself — the shape the shared `nuxt-cloudflare.yml`'s own pnpm step already
  uses. `engines.node` and `volta.node` stay as mirrors, because Volta and npm
  can read a version from a manifest and nowhere else. Node literals in a
  generated app fall from six sites to three; pnpm from three to one plus a doc
  row.

  **No `.nvmrc`.** Every consumer in this estate that reads it also reads
  `.node-version` (setup-node, fnm, mise); the only tool that reads `.nvmrc` and
  not `.node-version` is `nvm`, which is not the installed manager here — and
  Volta, which is, reads neither, only `package.json`. A second dotfile with no
  exclusive consumer is a drift site. `narduk-app foundation:check:toolchain`
  still accepts an app-kept `.nvmrc` as an optional mirror and fails only if it
  disagrees.

  Inside the generator, `24.21.0` appeared in four places and `10.33.4` in
  three, so a bump was a grep. `manifest.ts` now exports `NODE_VERSION`,
  `PNPM_VERSION` and `PACKAGE_MANAGER`, and every emission site — the manifest,
  the two workflows and the Workers Builds connection table — reads them.

  **The shared-workflow pin moves to `6f56678` (workflows#97).** This is not
  optional: a reusable workflow rejects an input it does not declare, so a
  caller passing `node-version-file` to the previous pin would fail at startup.
  That commit also adds an always-run required `caller-lint` job which
  actionlints the **calling** repository's own workflows and audits them for
  workflow-level concurrency, a top-level and a per-job `permissions:` block,
  per-job `timeout-minutes`, and 40-character SHA pins. Every job this generator
  emits now carries a job-level `permissions:` block for that reason (a
  job-level block replaces the workflow level rather than merging with it), and
  `tests/toolchain-single-source.test.ts` re-runs the gate's own rules over the
  generated output so the templates cannot drift back. The pin deliberately
  stops at `6f56678` rather than main's tip; #99 and #100 are separate
  decisions.

  `.node-version` is deliberately **not** a managed target of the `upgrade`
  codemod. A Node version is the same class of fact as a dependency pin, which
  `ownership.ts` already excludes on the grounds that D-TOOLCHAIN-1 gives
  Dependabot estate package currency — managing it would make the generator
  re-impose its own Node on every app it touched, the continuing sync
  relationship this repository's AGENTS.md forbids. `copilot-setup-steps.yml`
  stays managed whole-file, and is now safer for it: the file no longer carries
  a version literal at all, so re-applying it cannot move an app's toolchain
  behind its back.

- 7181db7: Add a `create-narduk-app upgrade [dir]` codemod that re-applies the
  units the generator still owns in an already-scaffolded app, as a reviewable
  diff (narduk-enterprises/company-hq#745). It is dry-run by default — printing
  a unified diff and exiting 1 when a managed unit has drifted, so CI can use it
  as a check — and `--write` applies exactly what the dry run printed. `--only`
  limits a run to one path and `--json` prints the machine-readable report.

  Ownership is explicit and deliberately narrower than "the generated file", so
  app-owned content is never clobbered: the shared-workflow **pin** inside an
  app-owned `.github/workflows/ci.yml`, the **whole** `copilot-setup-steps.yml`
  and `dependabot.yml`, the marker-delimited `narduk:router` **region** of
  `AGENTS.md` and `narduk:e2e-policy` region of `docs/e2e-testing.md`, and the
  named contract **script bodies** in the root `package.json` (`build:ci`,
  `foundation:check`, `manifests:validate`, and the `db:migrate:*` pair on an
  app with a database). Everything else the generator emits is seeded: written
  once and never read again. Any managed file can be disowned with a
  `narduk:unmanaged` header comment. The generator's `AGENTS.md` template now
  emits the router markers so new apps are opted in from scaffold.

  Also bumps two stale GitHub Action pins in the generated workflows —
  `actions/checkout` to v7.0.1 and `pnpm/action-setup` to v6.1.0, both verified
  tag-to-SHA upstream. Running the new codemod against the reference app is what
  surfaced them: the app was current and the template was a release behind.

- f0a74b3: Bring the generated scaffold to parity with the Buoys reference app
  shape (narduk-enterprises/company-hq#745): explicit `@nuxt/icon` module
  registration (fixes an `UNLOADABLE_DEPENDENCY` build failure), a pinned
  `nitro-cloudflare-dev` devDependency, a `copilot-setup-steps.yml` workflow, a
  corrected `.github/dependabot.yml` shape (single `directory`, `github-actions`
  ecosystem group), root `build:ci` / `foundation:check` / `manifests:validate`
  scripts plus the `@narduk-enterprises/narduk-app-tools` devDependency that
  back them, a generated `apps/web/scripts/validate-manifests.mjs` pre-deploy
  check, new `CONTRACT.md` and `docs/workers-builds.md` templates, a Playwright
  `setup`/`chromium` project split, and a generic `docs/e2e-testing.md` plus
  `apps/web/tests/e2e/visual-audit.spec.ts` skeleton built on narduk-testkit's
  `playwright/ui-quality` toolkit (`consoleTracker`, full-page and named-locator
  capture). Every generated file remains Prettier-canonical under the package's
  own format:check.
- 9051c12: Document the shared error page and exception capture in generated
  apps, and prove a generated app never shadows them.

  narduk-core supplies the error page through Nuxt's `app:resolve` hook only
  when the app has not provided one, so a generated `apps/web/app/error.vue` —
  even a placeholder — would silently take the estate page out of every new app.
  A generator test now asserts that no generated file is an `error.vue` and that
  no generated source registers a `vue:error`, `app:error` or Nitro `error`
  listener.

  New `docs/error-page.md` in the generated repository covers what the page
  shows, its E2E selectors, where exceptions are reported, how to subscribe
  another destination, and how to override or wrap the page; README links to it.

### Patch Changes

- cbaf741: Scaffold the estate E2E flake policy into new apps, so a flaky test
  cannot report green from the first commit.

  The generated `playwright.config.ts` now sets `retries` to 1 in CI (was 2) and
  enables `failOnFlakyTests` for push/default-branch runs: a test that fails and
  then passes on its retry FAILS the merge rather than being reported as
  flaky-but-green. Pull requests keep the single retry as a cheap defence
  against browser-pool noise — the merge to the default branch is where the
  suite has to be believed. `trace: 'on-first-retry'` is unchanged and is now
  the trace on the one retry that exists.

  The tier is resolved from `GITHUB_EVENT_NAME`, a GitHub Actions default
  environment variable exported into every step, so a reusable workflow does not
  have to forward it. The branch is fail-closed: anything not recognisably a
  pull-request event, including an unset variable, takes the strict path, so a
  missing variable can only make the gate harsher, never green. The generated
  config prints the policy it resolved (`[e2e] flake policy: ...`) once per run,
  from the runner process only, so which policy a run used is readable in the
  log instead of inferred.

  The scaffolded `docs/e2e-testing.md` gains a matching **Flake policy** section
  and a **Quarantine convention**:
  `test.fixme(<condition>, '<repo>#<issue> -- <YYYY-MM-DD> -- <owner>')`, why it
  is `fixme` rather than `skip`, and how a test leaves quarantine. A scaffold
  that ships `failOnFlakyTests` without telling anyone how to quarantine a flake
  teaches exactly the retry-hides-it habit the policy exists to end.

  `@narduk-enterprises/narduk-testkit` exports fixtures, contracts and
  UI-quality helpers but no Playwright config preset — there is no
  `defineConfig` in its source and no `./playwright/config` export — so the
  generator's scaffold is the only place in this repository that can own this
  policy today. Existing apps carry it in their own `playwright.config.ts`.

- b59907e: The scaffolded no-seo `nuxt.config.ts` head drops its `twitter:card`
  and `twitter:image` meta entries and keeps the full Open Graph set, including
  `og:image:width` / `og:image:height`. A fresh app therefore starts clean
  against the shared browser-console contract instead of emitting tags Unhead 3
  reports as deprecated (narduk-libs#349).
- 119042d: Move the optional `@opentelemetry/*` peer and dev ranges from the
  0.208 / 2.x-early line to `^0.222.0` / `^2.11.0`.

  The experimental `0.2xx` packages pin their stable siblings exactly, so
  `^0.208.0` forced `@opentelemetry/core@2.2.0` on every consumer that opts into
  the OTLP sink. That version carries GHSA-8988-4f7v-96qf (unbounded memory
  allocation in W3C Baggage propagation, medium), first fixed in
  `@opentelemetry/core@2.8.0`. `@opentelemetry/sdk-logs@0.219.0` is the first
  experimental release pinning `2.8.0`; `0.222.0` is the current matched line
  and resolves `@opentelemetry/core@2.11.0`.

  The generator is released alongside it because its manifest hard-codes the
  exact pins of the packages this release moves.

  The peers stay optional, so a consumer that never calls `createOtlpSink` is
  unaffected. The sink's API surface — `LoggerProvider({ processors })`,
  `OTLPLogExporter`, `SeverityNumber`, `ReadableLogRecord` — is unchanged across
  the move.

- 39c28ff: Raise the `sharp` runtime dependency from `^0.34.5` to `^0.35.4` in
  `narduk-app-tools` and `narduk-testkit`, and release the generator so its
  hard-coded pins for both packages move with them.

  `sharp` is a published runtime `dependencies` entry in both packages, so the
  fix only reaches consumers through a release. `0.35.4` closes two
  high-severity inherited advisories: GHSA-f88m-g3jw-g9cj (libvips
  CVE-2026-33327, CVE-2026-33328, CVE-2026-35590, CVE-2026-35591, fixed in
  0.35.0) and GHSA-rgj7-g3m4-5g8c (libheif GHSA-g89c-p67h-r497 and
  GHSA-2jg2-4ch7-h545, fixed in 0.35.4).

  `sharp@0.35` raises its Node floor to `>=20.9.0` and drops the `install`
  script, so a platform without a prebuilt `@img/sharp-*` binary must now fall
  back to WebAssembly or build libvips by hand. Neither package declares
  `engines`, and the estate runs Node 24, so no supported consumer loses a
  platform. The call sites — `metadata()`, `stats()`, `resize()`, `toFormat()`,
  `ensureAlpha().raw()`, `failOn` and `limitInputPixels` — are unchanged in
  0.35.x; the removed `failOnError` and `paletteBitDepth` APIs were never used.

## 0.6.3

### Patch Changes

- fc816c4: `foundation:check` sub-check 2.3 (narduk-core N-1 window) now raises
  the default registry-read timeout from 4000 ms to 20000 ms, overridable via
  `NARDUK_FOUNDATION_REGISTRY_TIMEOUT_MS`, and retries up to twice with backoff
  on timeout/network-error/5xx responses only -- never on 401/403/404. This
  fixes false-`unknown` (blocking) results on the on-prem runner's slow GitHub
  path (narduk-libs#341). Fail-closed semantics are unchanged: a genuinely
  unreachable registry still reports `unknown` after exhausting the retry
  budget.

  `@narduk-enterprises/create-narduk-app` gets a patch release alongside this to
  refresh its `narduk-app-tools` pin in `src/manifest.ts`
  (`scripts/check-generator-release-plan.mjs` requires a generator release
  whenever a package it pins changes version); no generator behavior changes.

- 1cda2f5: Update the generator's pinned `@narduk-enterprises/narduk-testkit`
  version to the release that blocks, rather than empty-fulfils, optional
  telemetry in the console tracker's stub profile.

## 0.6.2

### Patch Changes

- 1fe3dde: Update the generator's pinned `@narduk-enterprises/narduk-testkit`
  version to the release that adds the console tracker's deterministic telemetry
  profile. Generated apps keep today's behavior: the profile is opt-in and the
  default stays `'live'`.

## 0.6.1

### Patch Changes

- 76aba10: Retire branding-based status-app classification. Keep subcheck 3.4 as
  explicitly not-applicable and continue checking actual web capabilities.
  Legacy status-runtime consumers remain supported; new apps do not need that
  package.

## 0.6.0

### Minor Changes

- 26c8d05: Scaffold apps with no database.

  `--no-database` (or `--database=none`, or `databaseBackend: 'none'` through
  the API) generates an app that declares
  `nardukCore: { databaseBackend: 'none' }`, so narduk-core's shared
  `/api/health` reports `database: "not_applicable"` and stays `ok` rather than
  degrading a publication-only app.

  - No D1 binding in `wrangler.jsonc`, no `server/database/schema.ts`, no
    `#narduk-db` alias, no `drizzle/` migrations and no
    `migrations.sources.json`.
  - No `db:migrate:local` / `db:migrate:remote` scripts, and `cf:deploy` deploys
    without a migration step.
  - `drizzle-orm` and `drizzle-kit` are left out of the generated manifests.
  - The `auth` capability is rejected with no database, because sign-in stores
    users, sessions and API keys in the app database.
  - The JSON report records the resolved `databaseBackend`.

  The default stays D1, and a D1 scaffold is byte-identical to the previous
  release.

### Patch Changes

- 8f693b1: Pin `@nuxt/ui` at `4.8.1` everywhere the layer pins it: the
  `narduk-core` dependency, the `narduk-shell` peer and dev pins, the
  `narduk-ai` and `design-system-build` dev pins, and the `create-narduk-app`
  generator manifest.

  `@nuxt/ui` 4.6.1 added `build.transpile.push('reka-ui')` (nuxt/ui#6286), which
  makes Vite bundle `reka-ui` per importer on the server as well as the client.
  Without it, an app that also declares `reka-ui` directly renders SSR markup
  from its own copy while hydrating against Nuxt UI's pinned copy, which
  produced the `Hydration node mismatch` failures in buoys. 4.8.1 also carries
  the fix for GHSA-gj2h-2fpw-fhv9 (medium, `@nuxt/ui < 4.8.1`) and widens the
  `typescript` peer to `^5.6.3 || ^6.0.0`. The only breaking change between
  4.6.0 and 4.8.1 is `UInputMenu`'s `autocomplete` prop being renamed to `mode`,
  which nothing in this workspace uses.

  Consumer migration: an app that declares `@nuxt/ui` itself must move its own
  pin to `4.8.1` in the same change that takes this release. `narduk-shell`'s
  peer is exact, so any other version is a peer conflict, and `narduk-core`
  carries `@nuxt/ui` as a dependency, so a different app-level pin resolves a
  second copy — the duplicate-copy failure this release removes.

- 8abb3c8: Update the generator's pinned `@narduk-enterprises/*` versions to the
  coordinated release that ships narduk-core 2 (Pinia 4 and `@pinia/nuxt` 1).
  Generated apps do not list `pinia` directly, so the generator's behavior does
  not change beyond the new pins.
- 8abb3c8: Run generated app CI on Node 24.21.0 and emit matching `.nvmrc`,
  `engines.node` and Volta declarations from one constant. This matches the Node
  24 minimum the shared ESLint configuration already requires. Correct that
  package's stale Node 22 documentation. The repository's own CI, release jobs
  and root runtime pin also move to Node 24.21.0; package JavaScript output
  targets retain their existing compatibility range.
- 8abb3c8: Retire the implicit Doppler execution in `narduk-app dev`
  (narduk-libs#321).

  **Breaking for existing callers of `narduk-app dev`.** The command used to run
  every child through `doppler run`, with `--project` / `--config` selecting a
  Doppler project and config — an implicit dependency on the retired app-secret
  store. It now runs one child process through an explicit credential route:

  - no `--credentials` (the default) runs the child directly, so an app whose
    local development needs no secrets has no secret-store dependency at all;
  - `--credentials nvault` requires a complete `--project` / `--environment` /
    `--config` selector and runs
    `nvault run -p <project> -e <environment> -c <config> -- <command>`, the
    registered local credential route, whose values stay process-local
    (company-hq `docs/SECRETS-MATRIX.md`, plane 4);
  - `--dry-run` prints the resolved command without running it.

  The retired invocation
  `narduk-app dev --project <app> --config dev -- <command>` now fails with a
  message naming both replacements, rather than silently starting a dev server
  without the environment it used to receive. `--credentials doppler` fails the
  same way. Doppler `ne/*` root provisioners remain a separately approved
  provider-root exception and are not an application development credential
  source.

  The exported `buildDopplerRunArgs` is replaced by `buildNvaultRunArgs`,
  `buildDevInvocation` and `formatDevInvocation`.

  Generated apps start Nuxt directly: the web `dev` script is now
  `nuxt dev --host 127.0.0.1`, and the generated README documents the nvault
  route an app adopts when it later needs credentials locally.
  `narduk-app deploy-local` is a different command and still reads Doppler
  `narduk/tokens`; it is unchanged.

- 8abb3c8: Stop overriding `nuxt-og-image` to 6.7.2 in generated SEO apps, so
  they use the release that `@narduk-enterprises/narduk-seo` pins. New apps now
  pin Nuxt 4.5.2, which supplies Unhead 3 for that module set's
  `treeShakeUseSeoMeta` transform, and Tailwind 4.3.2, whose Vite plugin
  supports Nuxt 4.5's Vite 8.

  Run the generated browser-test server with Nuxt's `TEST` flag so it excludes
  the interactive DevTools module. Normal `dev` keeps DevTools available.

## 0.5.2

### Patch Changes

- 2e9d424: Pin the narduk-core and narduk-auth releases that add
  `databaseBackend: 'none'` and registered health checks.

## 0.5.1

### Patch Changes

- 994551d: Read only the parsed HTML head during social-preview crawler checks,
  retaining the head byte limit and all metadata checks without downloading
  unrelated SSR payloads.

## 0.5.0

### Minor Changes

- 6d7d26d: Make Workers Builds preview exposure explicit and independent of
  repository visibility. Public apps receive workers.dev and version-preview
  defaults; authenticated apps keep both closed. Generated SEO and runtime
  configuration mark branch builds as previews, and onboarding documents the
  required Git connection and binding isolation.

## 0.4.1

### Patch Changes

- 45ff93c: Refresh the generator's pinned `@narduk-enterprises/narduk-shell`
  version to pick up the package-root import-protection fix (narduk-libs#295).
  No generator behavior changes beyond the pinned version bump.

## 0.4.0

### Minor Changes

- 3578eef: Scaffold a `.github/dependabot.yml` with one Dependabot group
  (`narduk-libs`, patterns `@narduk-enterprises/*`) using
  `directories: ['/', '/apps/*']` so the update covers the root lockfile and the
  `apps/web` manifest that holds the estate pins (components-library-plan.md §2
  item 6, narduk-libs#253). Generated apps now carry one bot config:
  `renovate.json` is no longer scaffolded (D-TOOLCHAIN-1 prefers Dependabot;
  item 5.2 already accepts either). `@narduk-enterprises/narduk-auth` is dropped
  from `pnpm.overrides`: nothing in the estate depends on narduk-auth, so the
  override could never collapse a second copy, and Dependabot does not update
  that field. The estate overrides that ARE load-bearing are covered in a
  separate changeset. The registries block reads the org-level Dependabot secret
  `NARDUK_PLATFORM_GH_PACKAGES_READ`. A live Dependabot run against a generated
  app is not possible from the PR VM; empirical proof is a follow-up.
- 1a7a036: Generator: lint packs and narduk-shell by default
  (components-library-plan.md §2 item 4, narduk-libs#251).

  - Adds the `design-system` and `nuxt-ui` capability packs to the four already
    hardcoded (`core`, `correctness`, `complexity`, `formatting`) in both
    `apps/web/eslint.config.mjs` (`createAppLintConfig`) and the root
    `eslint.config.mjs` (`composeSharedConfigs`), so every new app starts on the
    Nuxt UI element discipline, the Tailwind v4 token tier, and the three
    legacy-API guardrails from day one.
  - `@narduk-enterprises/narduk-shell` joins the default module list
    (`nuxt.config.ts`) and the default runtime `dependencies`, unconditionally
    and not behind a capability flag — the same way narduk-core always ships —
    with an exact pin. The pin is `0.0.0`: narduk-shell has never been published
    (item 1 shipped the skeleton without a release, and every wave-2 component
    item since has left its changeset unconsumed), and the pin has to equal the
    package's live on-disk version for `versions:check`, not a preview of its
    next release.
  - Adds a `charts` capability that pins `@narduk-enterprises/narduk-charts`,
    the one existing capability package that is not itself a Nuxt module (no
    `nuxt` peer, no `module.ts`) — it is excluded from the generated
    `modules: [...]` array for that reason, and added to the generated app's
    `knip.json` `ignoreDependencies` because nothing in the scaffold imports
    from it directly yet.
  - Extends the narduk-libs `packed-consumer-smoke` fixture
    (`scripts/release-packages.mjs`) so the generated release-smoke app renders
    `<NeStatusBadge>` alongside `LayerAppHeader`, and asserts its label is
    visible in a real browser via Playwright — proof that the packed
    narduk-shell tarball registers and renders a component, not just that
    `nuxt build` succeeds. `@narduk-enterprises/narduk-shell` is added to
    `assertExactGeneratedPackagePins`'s required-package set alongside the other
    always-shipped packages.

  No override entry is added to the generated app's `pnpm.overrides` for
  narduk-shell: it has no runtime `@narduk-enterprises/*` dependency of its own,
  and nothing else in the workspace ships it as a `workspace:` **runtime**
  dependency today (`design-system-build` depends on it only as a devDependency,
  which `tests/workspace-override-safety.test.ts` deliberately excludes) — so
  there is no second copy an override could collapse.

- 09b35f7: Generated apps collapse every workspace-published estate pin, and run
  `foundation:check:shared-ui-pinned` (narduk-libs#282 review).

  - **`pnpm.overrides` regains `@narduk-enterprises/narduk-core` and gains
    `narduk-logging`, `narduk-platform` (always) and `narduk-mapkit` (mapkit
    capability).** pnpm replaces a `workspace:` specifier with the _exact_
    version of that workspace package at publish time, so a published estate
    package carries a hard pin on whatever its sibling's version was that day.
    Two different exact pins on one package in one tree is two installed copies
    — for a Nuxt module two registrations and two `useRuntimeConfig` namespaces,
    for a contracts package two copies of the zod schemas its consumers are
    supposed to share. Two shapes produce that second pin: **one publisher plus
    the app's own direct pin** (`narduk-core` ships
    `narduk-logging: workspace:*`; `narduk-mapkit-nuxt` ships
    `narduk-mapkit: workspace:*`), and **two or more publishers with no direct
    pin at all** — `narduk-platform` is a runtime `workspace:*` dependency of
    `narduk-core`, `narduk-ai` _and_ `narduk-auth` while a generated app names
    it nowhere. `narduk-core` is both at once (four publishers and a direct
    pin). A package with one publisher and no direct pin needs no override and
    gets none, which is why `narduk-app` (shipped by `narduk-auth` alone) is
    absent; `@narduk-enterprises/narduk-auth` is absent because nothing in the
    estate depends on it, so its override was inert. The accepted cost is that
    Dependabot does not update `pnpm.overrides`, so a grouped bump resolves back
    to the override until it is bumped by hand: a stale single copy is
    recoverable, two live copies are not. An override also asserts the estate is
    mutually compatible at the pinned versions; `versions:sync` keeps those pins
    on the workspace versions, which is the set built and tested together. A new
    test derives the whole set from the live workspace manifests — publishers
    counted over the installed closure, direct pins intersected, devDependency
    edges excluded because a published package's devDependencies are never
    installed by its consumers — so a new `workspace:` edge cannot reopen the
    hole silently.
  - **New scripts `foundation:shared-ui-pinned` (root and `apps/web`), wired
    into `quality:static`.** The command reads manifests only and needs no
    registry credential, so it runs where the generated install step has already
    dropped the GitHub Packages token. narduk-libs' own `packed-consumer-smoke`
    job expands the generated `quality` chain, so the check also runs against a
    really-installed generated app on every narduk-libs PR. The generated CI for
    a **private** app calls the shared `nuxt-cloudflare.yml` workflow rather
    than `quality:static`, so `foundation:shared-ui-pinned` is named in its
    `extra-scripts` too — otherwise that half of the fleet would ship the script
    and never run it.

- fb0c50c: Add app-owned social preview generation and validation: default
  artwork, explicit route coverage, initial HTML checks, crawler image
  downloads, and distinct dynamic route images. The SEO module gains an opt-in
  global static fallback and canonical OG URLs, with explicit previews for
  public noindex pages. New scaffolds include artwork sources, metadata, route
  inventory, build gates, and crawler acceptance. Existing apps opt in through
  the migration guide; no fleet synchronization occurs.

### Patch Changes

- 699b5da: Refresh the generator's pinned `@narduk-enterprises/narduk-auth`
  version so new apps pick up the Auth* suite-bar docs and tests. No generator
  behavior changes beyond the pinned version bump.
- 54577ac: Refresh the generator's pinned `@narduk-enterprises/narduk-core`
  version to pick up the `getClientIp` export (`server/utils/client-ip`). No
  generator behavior changes beyond the pinned version bump.
- 837c1eb: Refresh the generator's pinned
  `@narduk-enterprises/narduk-mapkit-nuxt` version so new apps pick up the
  AppMapKit suite-bar docs and tests. No generator behavior changes beyond the
  pinned version bump.

## 0.3.7

### Patch Changes

- 3c0a608: Refresh the generator's pinned `@narduk-enterprises/narduk-app-tools`
  version to pick up item 5.2's `.github/dependabot.yml` acceptance
  (narduk-libs#233). No generator behavior changes beyond the pinned version
  bump.

## 0.3.6

### Patch Changes

- b69913a: Bump the package's own toolchain to the estate baseline (company-hq
  D-TOOLCHAIN-1, 2026-09-10): `typescript` `~6.0.3` (was `^5.9.3`),
  `@types/node` `^24` (was `^22.19.19`), and every `@typescript-eslint/*` plus
  `typescript-eslint` dependency to `^8.70.0` (was `^8.65.0`). `engines.node`
  moves to `>=24.0.0`.

  No public API or config-output change. `tsconfig.json` gains
  `"ignoreDeprecations": "6.0"` because `tsup@8.5.1` injects a deprecated
  `baseUrl` into its own DTS build program under TypeScript 6 regardless of this
  package's own tsconfig (TS5101); `"types": ["node"]` was already present, so
  the TS6 Node-builtins issue (TS2591) that the same migration hit on the
  superseded v1 `narduk-eslint-config` line did not recur here.

  Consumers pinning `engines.node: >=24.0.0` on install must be on Node 24;
  anyone still on Node 22 who picks up this version will hit
  `ERR_PNPM_UNSUPPORTED_ENGINE` (a warning under this repo's default
  `engine-strict: false`, but a hard failure under a consumer's own
  strict-engine setting).

  `create-narduk-app` is a generator-owned package whose `src/manifest.ts`
  hardcodes the exact `@narduk-enterprises/eslint-config` version newly
  scaffolded apps pin (`scripts/sync-generator-package-versions.mjs` keeps it in
  sync with each package's own `package.json` version at release time).
  Releasing eslint-config `2.0.2` without a matching create-narduk-app release
  would leave that pin stale, so this changeset bumps create-narduk-app too -- a
  metadata/version sync only. No source, template, or toolchain change to
  create-narduk-app itself; it still targets TypeScript 5.9/Node 22 and is
  unrelated Wave 1 work.

## 0.3.5

### Patch Changes

- d66fe65: Release the app generator with the updated analytics package pin.

## 0.3.4

### Patch Changes

- 05515cd: Add the required `mapkit_js` scope to dynamically signed MapKit JS
  tokens so Apple accepts the token at its JavaScript bootstrap endpoint.

## 0.3.3

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

## 0.3.2

### Patch Changes

- aaf5549: Change the shared PostHog session replay default to off. Apps can
  continue to opt in with `POSTHOG_SESSION_REPLAY_ENABLED=true`; the build
  default and Worker runtime overlay now agree.

## 0.3.1

### Patch Changes

- 1cdd600: Run the generator when its CLI path contains spaces or resolves
  through a symlink, including macOS `/tmp`. Keep programmatic imports inert.

## 0.3.0

### Minor Changes

- 6297a08: Route core logging through the shared Narduk Logging package while
  retaining old imports, calls, scopes and legacy verbosity. New generated apps
  configure service identity, info-level logging and request completion
  summaries explicitly.

## 0.2.9

### Patch Changes

- 6197f80: Refresh generated app manifests alongside the upcoming shared runtime
  releases so their package pins include the new core media-CSP support.
- 1b3e90f: Regenerate application dependency pins for the media CSP release of
  narduk-core and its dependent packages.

## 0.2.8

### Patch Changes

- b342b11: Generate three Chromium shards for private and public apps. Require
  public static checks, browser shards and merged reports to succeed; retain
  failure screenshots and videos alongside retry traces. Preserve the pinned
  shared workflow and separated private runner routes introduced in #181.
- 48e71ca: Add opt-in browser authorization for native clients using one-time
  S256 PKCE codes, rotating opaque credentials, and revocable D1 sessions.
  Persist optional local email verification proof for consumers that bind
  invitations to verified addresses. Existing consumers retain their current
  behavior until enabling the features after applying the additive migration.

## 0.2.7

### Patch Changes

- ef064f2: Generate pinned CI with bounded concurrency and timeouts. Private
  apps use the shared Nuxt workflow with separate Linux and isolated-browser
  routes; public apps remain GitHub-hosted. Preserve every quality gate and
  clean temporary registry auth.

## 0.2.6

### Patch Changes

- 8b11738: Fix three generated-app defects that made a fresh scaffold fail its
  own quality gate (narduk-libs#172 and siblings).

  - `apps/web/nuxt.config.ts` emitted a `site: { name, url }` block for every
    capability set, but `site` is a nuxt-site-config key that only reaches the
    app through `@nuxtjs/seo`. A core-only or auth-only scaffold failed
    `nuxt typecheck` with TS2353 on its first run. The block, and the
    `routeRules` prerender entry beside it, are now emitted only for the `seo`
    capability.
  - The committed `.npmrc` carried
    `//npm.pkg.github.com/:_authToken=${GH_PACKAGES_READ}`. pnpm 10 warns
    `Failed to replace env in config` whenever the variable is absent and pnpm
    11 does not expand environment variables in a project `.npmrc` at all, so
    the line is now dropped entirely: the committed file is scope routing only.
    The generated CI workflow instead writes the org secret to a `umask 077`
    userconfig under `$RUNNER_TEMP` and points `NPM_CONFIG_USERCONFIG` at it for
    the install step alone. The generated README documents that path and no
    longer mentions the retired Doppler fallback.
  - New `apps/web/server/tsconfig.json` extending
    `../.nuxt/tsconfig.server.json`. The shared eslint config's type-aware pack
    resolves each file through the nearest `tsconfig.json`, and
    `apps/web/tsconfig.json` extends `.nuxt/tsconfig.json`, whose `include`
    excludes `server/**` — so the first server directory an app added
    (`server/durable/`, `server/tasks/`, ...) failed lint with "was not found by
    the project service".

## 0.2.5

### Patch Changes

- 46c9165: Restrict self-serve password links to requests whose origin matches a
  configured loopback app URL. Public deployments fail before issuing a token
  when the development shortcut is enabled. Local Nuxt and Wrangler fixtures
  remain supported.

## 0.2.4

### Patch Changes

- 5e35fae: Generated auth-capable apps now carry
  `pnpm.peerDependencyRules.allowAny` for `@simplewebauthn/browser` and
  `@simplewebauthn/server`.

  narduk-core depends on `nuxt-auth-utils`, whose **optional** passkey helpers
  still declare `@simplewebauthn/*@^11` — a range upstream has not moved
  since 2024. narduk-auth implements WebAuthn itself against its own
  exact-pinned v13 and never calls those helpers, so the two versions never meet
  at runtime. Without this rule, every auth-capable app's first `pnpm install`
  reports an unmet peer for a feature it does not use.

  This also releases the generator alongside the narduk-auth minor so its pinned
  `@narduk-enterprises/narduk-auth` version moves with it
  (`scripts/check-generator-release-plan.mjs`).

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
