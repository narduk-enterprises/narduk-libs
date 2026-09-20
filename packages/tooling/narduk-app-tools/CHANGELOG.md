# @narduk-enterprises/narduk-app-tools

## 0.13.1

### Patch Changes

- 2e5959d: The runner-ledger guard now reads statements, not comments.
  `buildMigrationBatchSql` and the migration-bundle check tested the raw SQL for
  `_narduk_migration`, so a migration that merely _documented_ the bookkeeping
  tables — explaining which ones it deliberately does not drop — was refused
  with "Migration SQL may not alter the runner ledger or lock". That blocked
  every deploy of an app whose drop migration carried such a comment
  (riverstatus#182).

  Comments are stripped before the test; quoted text is preserved, so
  `DELETE FROM "_narduk_migrations"` is still refused, and a `--` inside a
  string literal no longer blinds the guard to the rest of the line.

## 0.13.0

### Minor Changes

- 52ab505: Add a reviewed D1 baseline process: immutable schema/ledger capture,
  full-schema comparison, explicit metadata-only registration for untracked
  schemas, and a shared disposable-local cutover proof. Preserve historical
  fixtures across package upgrades and stop rechecking superseded legacy schema
  probes after stable checksum adoption. Document app-owned review, data-proof
  limits and migration-before-promotion onboarding.

## 0.12.0

### Minor Changes

- 3a10f40: Gate narduk-v1 promotion and shared previews on compatible D1
  migrations. Add explicit deployment target selection, read-only
  checksum/history status, a per-database migration lock with conservative
  failure recovery, SQL-only preview bundles, foundation coverage checks, and
  one-shot workflow onboarding templates.
- 33ce0e7: Accept a parameterized social-preview route with one sample when it
  states a `reason`. Two samples are what prove a dynamic preview varies with
  its parameter, but a route family that genuinely has one instance today — one
  published state, one live tenant — cannot supply a second real path, and an
  invented one proves nothing. Routes with no reason still require two.

### Patch Changes

- 8cd6999: Refuse an existing D1 application schema with no recorded migration
  history, even when a source manifest contains no SQL. Require reviewed
  baseline evidence instead of reporting an untracked read model current or
  replaying its schema.

## 0.11.0

### Minor Changes

- 80dde89: `narduk-app verify --live` can prove a host behind Cloudflare Access:
  `--access-client-id-env` / `--access-client-secret-env` name the environment
  variables holding a service token, sent as `CF-Access-Client-Id` /
  `CF-Access-Client-Secret` on every probe and never printed (#569).

## 0.10.1

### Patch Changes

- 92835a1: Lint through `narduk-lint` with a checked-in `lint-budget.json`
  recording the package's current warning counts (narduk-mapkit also marks
  fire-and-forget limiter calls in its tests with `void`). No runtime change;
  the release gate requires a changeset for any changed package file.

## 0.10.0

### Minor Changes

- 05b3ef9: Prove and gate Workers Cache (narduk-libs#435).

  - `narduk-app verify --live` gains repeatable `--edge-cache-path <p>` and
    `--edge-uncached-path <p>`. Each route is fetched twice from the same fresh
    URL without no-cache request headers; an edge-cache path needs
    `Cf-Cache-Status: HIT` (or `STALE` / `UPDATING` / `REVALIDATED`) on the
    second GET, an uncached path must never be served from cache. A
    `private, no-store` answer (a preview-safe hostname) reports "cannot prove a
    HIT here". New exit code 7.
  - `foundation:check:deployment` gains sub-check 12.7: a wrangler config (any
    scope, JSON or TOML) that sets `"cache": { "enabled": true }` fails against
    a `@narduk-enterprises/narduk-core` older than 2.2.4 — the first core that
    keeps thrown errors, preference-shaped responses and nonce-CSP HTML out of
    the cache. It fails in rollout mode too; with the switch off it is
    not-applicable.

### Patch Changes

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

## 0.9.1

### Patch Changes

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

## 0.9.0

### Minor Changes

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

## 0.8.0

### Minor Changes

- cbee698: Fix the three narduk-app-tools defects the estate's first `narduk-v1`
  adoption found (narduk-libs#451).

  **`versions-promote --sha` no longer misses a version below the ten-version
  window.** `wrangler versions list` returns "the 10 most recent Versions of
  your Worker" and takes no paging flag, so with non-production branch builds
  on, ten branch uploads landing between a merge build and its promote job
  buried the version to promote and production stayed on the old release. The
  lookup now walks Cloudflare's own Versions endpoint with `per_page`/`page` up
  to a bound -- the new `--max-versions` flag, default 500 -- and never
  paginates unbounded. One constant `per_page` runs the whole walk, because V4
  computes the offset as `(page - 1) * per_page` and a shrinking last page would
  re-read rows already seen instead of reaching the tail; the walk ends only on
  the bound, an empty page, or an end-of-collection the response's own
  `result_info` proves, so an endpoint that clamps `per_page` cannot make a
  short first page look like the end of the history. It needs an account id and
  `CLOUDFLARE_API_TOKEN`; without both it falls back to `wrangler versions list`
  and reports `versionSearch.source: "wrangler"` so a miss in ten is never
  mistaken for a miss in five hundred. A miss still exits 3, never 0 -- a
  promote that promoted nothing must be a red job -- and the detail now names
  the SHA, the count searched, the bound, and whether the search reached the end
  of the history (the build never uploaded this commit) or stopped at the bound
  (raise `--max-versions`, or use `--version-id`).

  **`--sha` no longer defaults to `GITHUB_SHA` under `on: workflow_run`.** There
  `GITHUB_SHA` is the default branch's head at trigger time, not the commit
  whose run completed, so the default could promote a commit the gate check
  never passed. The command refuses with an exit-2 usage error naming
  `${{ github.event.workflow_run.head_sha }}`. Every other event is unchanged,
  and `--version-id` is unaffected.

  **Foundation item 12.4 no longer reports PASS for `previewBindings`
  coverage.** Nothing in this release consumes that field -- `narduk-app deploy`
  generates only `.wrangler.deploy.production.json` and a branch build uploads
  with it -- so an app listing every binding name gets the identical runtime to
  one listing none. Full coverage now reports `unknown` ("declared, not
  enforced", exit 2) rather than a green check standing for a preview isolation
  that does not exist. `pass` is reserved for `nonProductionBranchBuilds: false`
  and for an app with no D1/KV/R2 binding, and the limitation is stated in every
  run's `limitations`.

  **Operator note.** Three behaviours change, all deliberately: `--max-versions`
  is new (minor); a `workflow_run` promote with no explicit `--sha` now exits 2
  instead of promoting the wrong commit; and an adopted app whose only preview
  isolation is a `previewBindings` declaration now exits 2 on
  `foundation:check:deployment` instead of 0. No estate app is on `narduk-v1`
  today -- every one of them is `malformed` or `absent` on item 12 -- so no
  green check turns red from that last change.

## 0.7.0

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

## 0.6.0

### Minor Changes

- 49e249b: Add the promote half of the Narduk deployment standard:
  `narduk-app deploy versions-promote`, `narduk-app deploy rollback`, and
  `narduk-app verify --live` (company-hq#745, deployment-standard design §1.5,
  §6.1–§6.3; Logan approved every recommended option on 2026-09-17).

  The standard is **Cloudflare builds, GitHub promotes**. Workers Builds already
  runs `wrangler versions upload` on every branch, so a push produces a version
  that serves no traffic; what was missing was the half that makes one live only
  after the gate check is green on that exact main SHA. `DeployAction` was
  `'deploy' | 'versions-upload'` and nothing more.

  **The commit-to-version link had to be built, not found.** The design's §6.1
  pseudocode reads "the version whose upload annotation/commit ==
  `$GITHUB_SHA`". No such field exists. Read live on 2026-09-17 against the
  deployed `buoys` Worker, `wrangler versions list --name buoys --json` returns
  only `metadata.{created_on,source,author_id,author_email,has_preview}` and
  `annotations.{workers/alias,workers/triggered_by}`; Cloudflare's Versions API
  reference documents no annotation fields at all. The one commit-shaped handle
  a version can hold is `annotations["workers/tag"]`, written by
  `wrangler versions upload --tag`. So `narduk-app deploy versions-upload` now
  stamps `WORKERS_CI_COMMIT_SHA` as the version tag when it runs inside a
  Workers Build (a caller-supplied `--tag` is left alone, and nothing is added
  outside a build), and `versions-promote` resolves a SHA back to a version id
  by reading it. Without that stamp the promote half has no input at all.

  `wrangler versions list` returns the **10 most recent** versions and takes no
  paging flag, so on a busy repository a main version can fall out of the window
  before the promote job runs. That is its own outcome — `version-not-found`,
  with the number of versions actually searched — because the remedy differs
  from every other failure.

  **Its own guard.** `isWorkersBuildDeployAllowed` refuses to run anywhere
  except inside a Cloudflare build, so reusing it for a promotion — which runs
  in GitHub Actions — would force every release through
  `NARDUK_ALLOW_LOCAL_WRANGLER_DEPLOY=1` and quietly license local production
  deploys estate-wide. Promotion carries a separate Actions-context guard (`CI`,
  `GITHUB_ACTIONS`, `GITHUB_RUN_ID`, `GITHUB_REPOSITORY`, `GITHUB_WORKFLOW`)
  with its own override, `NARDUK_ALLOW_MANUAL_PROMOTE=1`.

  **Rollback names its target.** A promote prints `previousVersionId`, and the
  promote job feeds that to `rollback --to`. Resolving "the previous version"
  from deployment history is correct exactly once: after a rollback the newest
  earlier version is the broken one just left, so an unnamed second rollback
  would roll _forward_ into it. The unnamed path refuses as soon as it can see
  the live deployment was itself a rollback, and refuses a no-op when the target
  already serves 100%.

  **`verify --live` is one code path for three callers** — the preview gate, the
  promote job's post-deploy proof (the auto-rollback trigger) and a human
  debugging an incident. It asserts `x-build-version` (prefix compare, because
  7-, 12- and 40-character spellings of one SHA all occur), `/api/health` per
  the narduk-core health contract, and one app-declared smoke route, with
  distinct exit codes per failure class (2 unreachable, 3 build version, 4
  health, 5 smoke) and a bounded retry over the whole pass for propagation and
  cold isolates. The build-version and smoke assertions share one request.

  `degraded` fails by default: §6.2 asks for both `data.status == "ok"` and
  "every required check passing", and those disagree exactly in the degraded
  case. This takes the literal reading; `--allow-degraded` takes the other, and
  never excuses a failing **required** check.

  Item 10's live header probe and `verify --live` now share one HTTP layer
  (`createLiveProbe`) rather than two fetch paths with separate timeout,
  redirect and user-agent behaviour. Every Cloudflare interaction is behind an
  injectable seam, so no test makes a network call.

  Review round 1 (Tier 2 adversarial, 2026-09-17) added three safety rules that
  the first cut did not have, each with its own outcome and exit code:

  - **`stale-promote` (exit 7).** A promote refuses a version older than the one
    already serving production, or one it cannot order against it. Two PRs
    merging seconds apart would otherwise let the older commit win by finishing
    last — reporting `promoted`, exiting 0, and passing its own live proof.
    `--force` is the deliberate revert-by-promote and is logged loudly.
  - **`branch-mismatch` (exit 8).** With `--production-branch` (or
    `NARDUK_PROMOTE_PRODUCTION_BRANCH`), a version is promotable only when the
    branch recorded in its `workers/message` annotation is that branch, and a
    version recording no branch is refused. The run's own `GITHUB_REF_NAME` and
    `GITHUB_EVENT_NAME` are checked too; `--any-branch` overrides the first.
  - **`wrangler-failed` (exit 5) is now reachable.** A wrangler failure returns
    a result carrying `trafficMayHaveChanged` instead of escaping as an
    exception the CLI flattened to 1, and usage errors moved to their own exit 2
    — so exit 1 keeps meaning "the guard refused, production is untouched".

  `verify --live` gained the same treatment: every request is sent no-cache with
  a per-attempt cache-busting query parameter (`--no-cache-bust` opts out of the
  parameter), a redirect that leaves the origin under proof now fails with exit
  6 rather than silently proving a different Worker, and `--allow-degraded` no
  longer excuses a `database` of `not_available`, `schema_error` or `error`. An
  unnamed `deploy rollback` also refuses when the live deployment carries no
  annotations at all, instead of reading unknown provenance as "not a rollback".

- 2c9f995: Add the declaration half of the Narduk deployment standard: the
  `Config/cloudflare-app.json` `deployment` block schema and
  `narduk-app foundation:check:deployment` (item 12,
  `deployment-standard-conformance`) — company-hq#745, deployment-standard
  design §2.1/§2.2 tier 1; Logan approved every recommended option on
  2026-09-17.

  The promote half already shipped: a build uploads a version, a GitHub Actions
  job deploys it at 100% after the gate check is green, and `verify --live`
  proves it. What was missing was the place an app says so, and anything that
  checks it. `Config/cloudflare-app.json` is the right home — `foundation:check`
  items 1 and 3 already read it — and the block is validated with zod, projected
  to JSON Schema by `deploymentBlockJsonSchema()` so an estate sweep or an
  editor reads one definition rather than a second hand-written copy.

  **Rollout mode is the default, and it is deliberate.** An app with no
  `deployment` block reports `NOT ADOPTED` and exits **0**. Publishing this
  command therefore turns no app's CI red on the day it ships; apps adopt one at
  a time. `--strict` makes a missing block a failure and is what CI passes once
  adoption is complete. A block declaring a `standard` other than `narduk-v1` is
  reported `not-applicable` — an exempt app is not claiming conformance, so
  reporting it as twenty schema violations would be noise, not a finding.

  **One rule fails even in rollout mode.** A Worker version captures its binding
  _configuration_, but the state behind D1, KV and R2 is not versioned, and
  `preview_database_id` / `preview_id` / `preview_bucket_name` apply to
  `wrangler dev` only — they do nothing for a Workers Builds preview. An app
  that sets `nonProductionBranchBuilds: true` while its wrangler config binds
  production D1, KV or R2 would read and write production data from every pull
  request branch. The check refuses that combination unless `previewBindings`
  names a replacement for each binding, reading every `env.*` scope of the
  wrangler config (JSON, JSONC and TOML) so a binding hidden under an
  environment still counts.

  **What the verdict is honest about.** This is a repository read with no
  credential, so it cannot see the deploy commands actually configured on the
  Workers Builds connection — the exact edit that would silently undo the
  standard — nor whether branch builds are enabled there, nor a second Worker on
  another account serving the same hostname. Those need the live read (design
  §2.2 tier 2). Every run prints that limitation beside its verdict and the
  artefact carries it in `limitations`, so a green repository check is not
  mistaken for a green deployment.

  Two additions to the design's literal §2.1 sketch, both additive: a
  `previewBindings` entry may be a bare binding name or an object carrying the
  preview resource's ids (§3.3 option A has to generate a preview wrangler
  config from this block, which needs them), and `previewChecks` is accepted and
  optional — it is the shared workflow's `preview-checks` input, and declaring
  it here is what lets a sweep see which apps still run the default.

  ## Review round 1
  - **`staging` now accepts the design's own enabled shape.** The schema
    modelled `staging` as `{ enabled: boolean }` under `strictObject`, so design
    §5.2's staging-enabled block — `workerName`, `hostname`, `approval`,
    `environment`, `bindings` — was five unknown keys and the first app to
    follow the approved design verbatim would have failed 12.0. The enabled
    shape is modelled, and an enabled stage must name its Worker, the hostname
    its proof reads and its gate (`environment`, which then has to name the
    GitHub Environment carrying `required_reviewers`, or `auto-after-proof`).
    Configuration left on a **disabled** stage is rejected rather than ignored:
    it reads as a live staging setup and is not one.
  - **12.5 reads TOML and compares the account it was told to expect.** It read
    `account_id` from JSON only, so it was `not-applicable` on exactly the two
    committed personal-account Workers the standard was written to catch — both
    are `.toml`. TOML is now read, and an app may declare
    `deployment.accountId`; every wrangler config in the checkout must then name
    that account. Without a declared `accountId` the verdict says plainly that
    it checked internal consistency **only** and cannot decide whether the
    account is the right one.
  - **Every wrangler config is scanned, not just the app's own.** 12.4 and 12.5
    resolved one config by candidate path, so a second Worker under `services/*`
    — the shape both personal-account offenders have — had its bindings and its
    account unread. Both now read every wrangler config in the checkout.
  - **New 12.6: the app and its wrangler config must agree about exposure.**
    Design §2.2 tier 1 asks that `preview_urls`/`workers_dev` agree between
    `Config/cloudflare-app.json` and the wrangler config; nothing implemented
    it. 12.6 compares `worker.workersDev` / `worker.previewUrls` against every
    scope of the wrangler config, **including by silence** — Cloudflare defaults
    both to `true`, so an app that records `workersDev: false` and never says so
    in wrangler ships a live `*.workers.dev` hostname it believes it does not
    have.
  - **The block a generated app pastes is pinned to this schema.**
    `fixtures/default-deployment-block.json` is asserted here to equal
    `defaultDeploymentBlock()` and to be accepted by `readDeploymentBlock`, and
    `create-narduk-app`'s generator test asserts its runbook emits exactly that
    file. Neither package depends on the other, and a schema change cannot reach
    a newly generated app without turning a test red first.

### Patch Changes

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

## 0.5.0

### Minor Changes

- 1af628c: Add `narduk-app foundation:check:toolchain` — foundation item 11,
  `toolchain-single-source` (Logan, askme 2026-09-17: _"Single-source toolchain
  versions (Recommended)"_ — one declared Node/pnpm source per app; every other
  place either reads it or is checked against it, so a bump is one edit).

  The command prints every place the app writes a Node or pnpm version down,
  with its file, line, value and verdict, and fails on any disagreement. Like
  items 8, 9 and 10 it is a separate command and JSON artefact
  (`tool: '@narduk-enterprises/narduk-app-tools/toolchain-single-source'`),
  because `foundation:check --json` is the exact 7-item contract company-hq
  `check-web-foundation.py` validates. Same exit codes, no warn tier, no
  credential required.

  **The sources, chosen on what tools actually read.** Node is `.node-version`:
  the widest native readership (`actions/setup-node` via `node-version-file`,
  fnm, mise, nodenv) and, decisively, the only Node declaration a workflow can
  _point at_ rather than restate — which is what removes the CI literal
  entirely. pnpm is the root manifest's `packageManager`: corepack, pnpm itself
  and `pnpm/action-setup` all read it natively, and the shared
  `nuxt-cloudflare.yml`'s own pnpm step already relies on exactly that.

  Everything else is a mirror, because Volta and npm can read a version from
  nowhere but a manifest and a Markdown table reads nothing: `engines.*`,
  `volta.*`, an optional `.nvmrc` or `.tool-versions`, and the
  `docs/workers-builds.md` rows that record the Cloudflare dashboard build
  environment. A mirror either derives from the source — a workflow's
  `node-version-file`, a `pnpm/action-setup` with no `version:` — or is compared
  against it.

  **`--fix` closes the loop.** It rewrites a drifted mirror's literal on the
  exact line the scan located, leaving every other byte alone (no
  `JSON.stringify` round trip, so an app's own manifest is not reformatted or
  reordered), and a Markdown row keeps its column width where the padding can
  absorb the change. Bumping Node becomes: edit `.node-version`, run `--fix`.

  It deliberately does not rewrite a workflow. Turning `node-version:` into
  `node-version-file:`, or dropping a `pnpm/action-setup` `version:` input,
  changes the shape of a file the app owns and its contract with the shared
  workflow — a one-time migration, reported with the exact edit and left for a
  human. It also will not invent a missing `.node-version`: with no source there
  is nothing to derive from, and promoting a mirror would be a guess.

  A CI literal that currently _agrees_ with the source is still a finding: it is
  a second declaration, and the second declaration is the thing being removed.

- 9da4063: Add `narduk-app foundation:check:coverage` — foundation item 9,
  `shared-capability-coverage`.

  **What it reports.**

  _(a) Inventory._ Every `@narduk-enterprises/*` dependency the app pins, with
  its version, the manifest it came from and the dependency block it sat in —
  one row per `(package, manifest, block)` across the root manifest and the
  workspace manifests at the monorepo-candidate paths item 1 already reads.
  Beside it, the catalog of shared capabilities the estate publishes, each
  marked adopted or not. The catalog is **derived from narduk-libs' own
  `pnpm-workspace.yaml`**, not hand-typed:
  `scripts/generate-capability-catalog.mjs` writes
  `src/foundation/capability-catalog.ts`, private workspace packages are
  excluded because an app cannot depend on one, and `pnpm run scripts:test`
  fails in required CI when the committed file falls out of step with the
  workspace. The whole inventory is a first-class `inventory` block in the
  `--json` artefact so the estate roster consumes it as data rather than parsing
  sub-check prose.

  _(b) Reimplementation detection._ Five detectors for app-local code doing a
  shared package's job — an app-local `createLogger`/`logger.ts` with a console
  transport (`@narduk-enterprises/narduk-logging`), a local `useSeo` /
  `defaultSocialMeta` twin (`narduk-seo`), a direct `posthog-js` import
  (`narduk-analytics`), a `server/api/**/health*` route that never references
  `registerHealthCheck` (`narduk-core`), and a Nitro plugin that hooks
  `error`/`afterResponse` or attaches a response `finish` listener and logs from
  it (narduk-logging adoption guide step 5). Each detector asks one further
  question: is the owning shared package a dependency? If yes the match is
  **confirmed** and reported as a **FAIL** naming the exact file path and the
  owning package; if no it is **heuristic** and reported as a **WARN**, which
  carries the existing `unknown` status (exit 2) plus `confidence: 'heuristic'`
  in the artefact. The four verdicts read as _proven_ (`pass`), _gap_ (`fail`),
  _unknown_ and _not-applicable_; there is no fifth status and no new
  vocabulary.

  **Shape.** Its own command and its own artefact
  (`tool: '@narduk-enterprises/narduk-app-tools/capability-coverage'`), exactly
  as item 8 `shared-ui-pinned` is: `foundation-check.json` stays the precise
  7-item contract company-hq `check-web-foundation.py` `validate_artefact()`
  consumes, and an `id` outside `1..7` would be a rollup-red F3 ARTEFACT finding
  on every app. No registry credential is required — every verdict comes from
  the app's own manifests and source.

  **Zero false positives** is the acceptance bar, proven against
  `narduk-enterprises/buoys` at `cc72c3d` (PASS, exit 0, 13 estate pins, 112
  files scanned, 0 detections) and a freshly generated `create-narduk-app@0.6.3`
  scaffold (PASS, exit 0, 11 pins, 7 files scanned, 0 detections). Both shapes
  are committed as fixtures.

  Also: `AppRepo.walk()` now skips `.output`, `.nuxt`, `.nitro`, `.wrangler`,
  `.turbo` and `coverage` alongside `node_modules`, `.git` and `dist`. A built
  Nitro bundle inlines every dependency, so a conformant app's
  `.output/server/chunks` contains `createLogger`, `posthog-js` and a health
  route — a content scan that reached it would report the whole estate as
  forking itself.

- 894cd17: Add
  `narduk-app foundation:check:security-headers --base-url <url> [--path <p>]...`,
  a live probe of a deployment's security response headers for narduk-core's
  `security.headers` preset.

  It reports, per probed route, whether a Content-Security-Policy is enforcing,
  report-only, or absent; whether the policy actually in force uses a nonce
  rather than `'unsafe-inline'` / `'unsafe-eval'`; and whether
  `Strict-Transport-Security`, framing restriction, `Referrer-Policy`,
  `Permissions-Policy` and `X-Content-Type-Options` are present — each proven, a
  gap, or unknown.

  Unlike items 1-8 this one has no filesystem verdict. A response header is
  produced by a running server and a checkout can describe a policy it does not
  serve, so no `--base-url` means `unknown` (exit 2), never `pass`. It is a
  separate command and one-item artefact
  (`tool: '@narduk-enterprises/narduk-app-tools/security-headers'`) for the same
  reason `foundation:check:shared-ui-pinned` and `foundation:check:coverage`
  are: `foundation-check.json` is the ratified 7-item contract company-hq
  `check-web-foundation.py` validates, and an `id` outside `1..7` is a
  rollup-red F3 ARTEFACT finding. No registry credential is required.

### Patch Changes

- b59907e: The social-preview check no longer requires
  `twitter:card=summary_large_image` or `twitter:image`, because the estate
  stopped emitting every `twitter:*` meta name (narduk-libs#349). The Open Graph
  contract is unchanged and still strict: exactly one non-empty `og:title`,
  `og:description`, `og:type`, `og:image:alt` and `og:url`, a canonical `og:url`
  on the declared origin, declared `og:image:width` / `og:image:height` of
  1200x630, and an `og:image` from a declared origin. Both the Twitterbot and
  Applebot profiles still probe every sampled route.
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

## 0.4.2

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

## 0.4.1

### Patch Changes

- 76aba10: Retire branding-based status-app classification. Keep subcheck 3.4 as
  explicitly not-applicable and continue checking actual web capabilities.
  Legacy status-runtime consumers remain supported; new apps do not need that
  package.

## 0.4.0

### Minor Changes

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

## 0.3.1

### Patch Changes

- 994551d: Read only the parsed HTML head during social-preview crawler checks,
  retaining the head byte limit and all metadata checks without downloading
  unrelated SSR payloads.

## 0.3.0

### Minor Changes

- 05a1aa9: Add `narduk-app foundation:check:shared-ui-pinned`
  (components-library-plan.md §2 item 6, narduk-libs#253): item 8
  `shared-ui-pinned` requires that wherever a UI app depends on
  `@narduk-enterprises/narduk-shell`, `narduk-ui`, or `narduk-charts`, the pin
  is an exact version — no range, no `workspace:` specifier. A shared-UI package
  the app does not depend on is `not-applicable`, and an API-only app (no
  `nuxt.config.*` and no pages/components directory at a known monorepo path) is
  `not-applicable` in full. Ships as its own command and JSON artefact, not as
  an eighth item inside `foundation:check`'s seven-item artefact (company-hq's
  `check-web-foundation.py` rejects item ids outside `1..7` as F3 ARTEFACT).
- 09b35f7: `foundation:check:shared-ui-pinned` (item 8) stops conflating
  "published" with "required", and stops needing a registry credential
  (narduk-libs#282 review).

  - **Presence is no longer derived from publication.** The item now enforces
    one rule from the app's own manifests: _if the app depends on a shared-UI
    package, that pin must be exact_. It no longer fails a UI app for not
    depending on `narduk-ui` or `narduk-charts` — those are capability-specific
    (a charting library is not mandatory on an app that draws no charts, and
    `narduk-ui` is the `Ns*` status instruments "for the status apps"). An
    unused package is `not-applicable`. The new exported `PRESENCE_REQUIRED` is
    the one place an estate-wide requirement would be recorded; it is empty,
    because no dated decision names a shared-UI package as required of _every_
    UI app, and a test pins it empty so an addition cannot land silently.
  - **No registry credential is needed, and exit 2 is no longer reachable for
    want of one.** Exact-pin discipline is a manifest fact. `RegistryReality` is
    still consulted, but only to annotate an already-decided sub-check with the
    latest published version; an unreadable registry drops the annotation and
    changes no status. `UNKNOWN` now means only "no `package.json` at a known
    monorepo path". This is what lets the command run in a generated app's CI,
    whose install step deliberately keeps the GitHub Packages token out of the
    ambient job environment.
  - **`FilesystemRegistryReality.publicationOf` fails toward `unknown` on an
    ambiguous 404.** GitHub Packages answers "no such package" and "your token
    cannot see this package" identically, so a mis-scoped token used to report
    every estate package as `unpublished` — a silent pass. A 404 is now
    corroborated with one memoized probe against `SCOPE_PROBE_PACKAGE`
    (`@narduk-enterprises/narduk-core`): only a token proven able to read the
    scope turns a 404 into `unpublished`; otherwise the answer is `unreadable`.

- fb0c50c: Add app-owned social preview generation and validation: default
  artwork, explicit route coverage, initial HTML checks, crawler image
  downloads, and distinct dynamic route images. The SEO module gains an opt-in
  global static fallback and canonical OG URLs, with explicit previews for
  public noindex pages. New scaffolds include artwork sources, metadata, route
  inventory, build gates, and crawler acceptance. Existing apps opt in through
  the migration guide; no fleet synchronization occurs.

## 0.2.1

### Patch Changes

- 3c0a608: `foundation:check` item 5.2 now also accepts `.github/dependabot.yml`
  as satisfying the "@narduk-enterprises scope addressed" requirement, alongside
  the existing `renovate.json` / `.github/renovate.json` check (narduk-libs#233,
  company-hq D-TOOLCHAIN-1). A `groups.*.patterns` entry matching the scope
  (grouping) or an `ignore[].dependency-name` entry matching it (delegation, the
  Dependabot-native equivalent of Renovate's `packageRules[].enabled: false`)
  both pass, mirroring borderwaitstat-us PR #19's `ignore` block. Dependabot is
  the documented preferred form going forward; `renovate.json` still passes on
  its own since not every repo has migrated yet. Consumers do not need to keep a
  `renovate.json` around once they adopt `.github/dependabot.yml` with either
  shape — bump to this version to delete it without failing item 5.2.

## 0.2.0

### Minor Changes

- 927f7e3: narduk-app-tools: add the `foundation:check` command (D-WEBFOUND-2
  Q5(a), Q9(a)) — the app-owned half of the web-foundation contract, built
  against the spec company-hq PR #631 merged at `docs/WEB-FOUNDATION-CHECK.md`
  and `strategy/web-foundation-libs-plan.md` §4.

  `foundation:check` evaluates all seven §4 items from inside an app's own
  checkout and CI, and writes a `foundation-check.json` artefact that
  `company-hq/scripts/check-web-foundation.py`'s weekly rollup accepts as-is
  (exact schema, `CONTRACT_ITEMS` naming, and the item-7 `not-applicable`
  invariant all mirror the rollup's own `validate_artefact()`). Exit code 0 =
  PASS, 1 = FAIL, 2 = UNKNOWN (CI must treat unknown as a failing gate too — no
  warning tier, per D-WEBFOUND-2 Q9(a)).

  Unlike the rollup, this command owns four sub-checks the rollup can only
  report `unknown` for, because they need the real checkout or a live registry
  read that a cross-repo weekly scan does not have:

  - 1.1 — resolves the actual Nitro preset from `.output/nitro.json` or
    `nuxt.config.*` when `Config/cloudflare-app.json` doesn't declare one.
  - 2.3 — the narduk-core N-1 support window (D-PKG-2), by resolving the
    installed major against the live published major.
  - item 3 in full — the five capability-package checks (auth, seo/analytics,
    uploads, status-runtime, no unauthorised chart/map dependency), gated on the
    real `access.exposureClass` and binding config.
  - 4.2 — a whitespace-normalised content-hash scan against a `narduk-libs#76`
    Wave-1 fork fingerprint list, so a locally-vendored copy of package-owned
    behaviour is caught by content, not by path.
  - P7 — eslint-config's "v2" requirement is checked against the _resolved_
    installed major, not the manifest's pin string.

  Ships as `src/foundation/**` (schema, roll-up, per-item evaluators, an
  injectable `RegistryReality` for the live npm/GitHub-Packages read) and
  `src/commands/foundation-check.ts` (`--checkout <dir>`, `--json [path]`),
  wired into `narduk-app foundation:check` in `src/cli.ts`. Full test suite
  under `tests/foundation/**` proves every sub-check in both directions with
  seeded-lie fixtures (a fixture that passes is mutated one fact at a time until
  it fails, and back).

  The shared CI callable step in the `workflows` repo that runs this command and
  uploads its artefact is out of scope for this change; see the follow-up noted
  on company-hq#628.

  Part of company-hq#628.

### Patch Changes

- d6e098e: Fix `narduk-app db migrate` for npm-based consumers. It previously
  shelled every wrangler invocation through the active package manager's `exec`
  subcommand (`spawnPnpmSync(['exec', 'wrangler', ...])`), which either invokes
  `npm exec` (silently dropping the `--command` flag's value under npm's
  argument parsing) or crashes outright when `pnpm exec` refuses to run inside
  an npm-configured consumer. Wrangler is now resolved and spawned directly (the
  consumer's own `node_modules/.bin/wrangler`, falling back to Node module
  resolution from the consumer root), independent of which package manager is
  active (narduk-libs#122).

## 0.1.3

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

## 0.1.2

### Patch Changes

- a783f18: Ignore stale package-manager entrypoints and fall back to the
  executable installed in `PNPM_HOME`, keeping repeated migration runs
  independent of `PATH`.

  Update generated-app package pins for the corrected app-tools release.

## 0.1.1

### Patch Changes

- 435cc56: Run Wrangler through the package manager entrypoint that launched
  `narduk-app`, avoiding PATH-dependent migration failures on repeated CI
  invocations.

  Update generated-app package pins for the corrected app-tools release.
