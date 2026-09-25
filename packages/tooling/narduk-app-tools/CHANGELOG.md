# @narduk-enterprises/narduk-app-tools

## 0.22.2

### Patch Changes

- 3b03a43: Make development mode survive a GitHub repository rename. The client
  resolves the origin-named repository once through `GET repos/{owner}/{name}`,
  which follows a rename, to its canonical name and numeric id.
  `development exit` now accepts a validation run whose repository and head
  repository carry that id, where it used to reject every run of a renamed
  repository by comparing full names. Workflow holds, restores and run
  cancellations address the canonical name, so no write goes through a redirect.
  Activation records, receipts and validation history keep the key they were
  created under.

  `create-narduk-app` takes the patch because it pins `narduk-app-tools` in
  generated apps.

- b55dea5: The development-mode migration classifier treats the name an
  `ALTER TABLE ... RENAME TO` moves a table to as the file's own, so the rebuild
  that renames the original table out of the way and later drops it no longer
  reports a spurious `drop-table` (#876). `deploy-local` now refuses a blank,
  non-https or local `SITE_URL` before it builds, migrates or deploys, rather
  than after production has moved (#877); `--no-probe` still skips the check.
- bfdb770: `deploy-local` now names `GH_PACKAGES_READ`'s registered route
  (nvault `github/prd/narduk-enterprises-packages-read`) when that key is
  missing, rather than sending the operator to the app's config, which holds no
  copy of it. The README shows the combined `nvault run` invocation (#333).
- cc50347: `narduk-app development validate` works from a contributor host while
  the repository is enrolled from another workstation (narduk-libs#827). Without
  a local activation record it checks GitHub: when the held workflows are
  disabled, it requests validation, so a PR can get its `ci / Required` result.
  When none is held, it refuses and names them, instead of claiming that normal
  delivery validates pushes. `development status --remote` on such a host also
  lists the held workflows.

## 0.22.1

### Patch Changes

- 89249cf: Development mode now proves and reports Worker script triggers
  (narduk-libs#756). After `wrangler triggers deploy`, `deploy:dev` reads the
  live cron schedules back and ends `unproven` instead of `verified` when the
  declared crons are not in force. `development status --remote` shows
  declared-vs-live crons and routes (zone routes plus custom domains) for each
  component, and `development enter` reports the same mismatch at entry. A live
  read that fails is reported as `unknown`, never as in sync.

## 0.22.0

### Minor Changes

- 1dc62db: Add `narduk-app db create` and fail `foundation:check` on the
  placeholder D1 id (narduk-libs#662).

  `foundation:check` sub-check 1.5 fails any `d1_databases[].database_id` (top
  level or any `env.<name>`) that is still the scaffold placeholder
  `00000000-0000-0000-0000-000000000000`, naming `narduk-app db create` and the
  raw `wrangler d1 create <name>` step. The placeholder builds, dry-runs and
  tests clean, so this is the first gate that notices the database does not
  exist. A fresh `create-narduk-app` scaffold with a database now fails 1.5, and
  only 1.5, until it is provisioned; a `--no-database` scaffold is unaffected.

  `narduk-app db create [--checkout <dir>] [--binding <NAME>] [--dry-run] [--json]`
  creates the one database a placeholder binding stands for: it refuses when the
  id is already real, takes the name from `Config/cloudflare-app.json` (never an
  argument), requires an explicit account (`account_id` or
  `CLOUDFLARE_ACCOUNT_ID`), writes the returned id into the wrangler config the
  manifest names with comments and formatting intact, prints the id and account,
  and never deletes.

  The generated `apps/web/wrangler.jsonc`, `README.md` and
  `docs/workers-builds.md` now say how to create the database.

- 1dc62db: `narduk-app deploy versions-promote` accepts
  `--gate-verified "<check>@<sha>"`, the promote workflow's attestation that the
  gate check passed on a commit (narduk-libs#400, option 2). The value splits on
  its last `@` and needs the full 40-character SHA. The promote refuses with
  `gate-mismatch` (exit 9), before touching anything, when the attested SHA is
  not the commit being promoted or the resolved version's `workers/tag` is not
  that commit. It logs the attested check and SHA and reports them as
  `gateVerified`. The flag is optional: without it the promote runs as before
  and warns that no gate attestation was passed. The generated
  `docs/workers-builds.md` promote excerpt and the `promote-d1.steps.yml` dry
  run now pass `--gate-verified "ci / Required@$VERIFIED_SHA"`.
- 1dc62db: `verify --live` diagnoses a stale local NXDOMAIN (narduk-libs#783).
  When the system lookup fails with `ENOTFOUND` / `EAI_AGAIN` but 1.1.1.1 /
  8.8.8.8 resolve the host, the report adds a distinct `dns` UNKNOWN assertion
  ("local resolver has a stale negative answer") with the public addresses and
  the remedies, instead of reading like a dead deployment; the exit code
  stays 2. The new `--resolver public` probes through the public resolvers'
  answer while keeping the hostname for TLS SNI and `Host`. Live probe responses
  also carry the transport's `errorCode`.
- 408ad37: `narduk-app deploy-local` no longer reads Doppler `narduk/tokens`:
  Doppler is retired except the `ne` root store. It takes `GH_PACKAGES_READ`,
  `NUXT_OG_IMAGE_SECRET` and `NUXT_SESSION_PASSWORD` (or the list in
  `NARDUK_APP_SECRET_KEYS`, formerly `NARDUK_APP_DOPPLER_KEYS`, still honoured)
  from its environment and fails closed, naming the missing keys and the
  `nvault run -- narduk-app deploy-local` route, when any is absent.
  `buildMergedDeployEnv` takes `secrets` instead of `dopplerSecrets`.
  `narduk-app doctor` checks for `nvault` on PATH instead of `doppler`.
- c6ec7da: development deploy: receipts carry per-step timings (`steps`,
  `totalSeconds`) and print the slowest steps. Every verified deploy queues full
  validation of the deployed commit (a capture commit for a dirty tree) to a
  detached worker that pushes `narduk-validation/<sha>/<uuid>`; one worker per
  repository, the newest SHA wins, superseded automatic runs are cancelled and
  their branches deleted, and a push that fails twice shows as `NOT PUSHED` in
  `development status`. deploy:dev refuses a capture that changes protected
  paths (`deployment.development.protectedPaths`, migration directories,
  Wrangler binding or Durable Object changes) unless run with `--gated`, and
  refuses after a `red-main` issue has been open for 24 h unless
  `--red-main-fix <issue>` names it. New
  `development rollback --to <known-good build>`; automatic rollback on failed
  proof is off unless `deployment.development.rollback` declares
  `automatic: true` with a `rehearsalRef`, and it pages instead of crossing a
  Durable Object, binding or non-expand-only migration change.
  `exec --operation migration` applies the expand-only rule (12.9): a drop or
  rename refuses unless it is a declared contract migration already landed on
  the production branch. For an app that declares no `deployment.migrations`
  (12.9 NA), files already on the production branch before the hold took effect
  (recorded as `migrationBaseline`; `enter --refresh` recovers it for an
  existing enrollment from the checkout's reflog, never from the current ref)
  are not judged; files that landed during the hold always are. An app that
  declares `deployment.migrations` (expand-contract) has every file judged.

### Patch Changes

- 1dc62db: `narduk-app e2e-serve` now drops service bindings to Workers outside
  the E2E run instead of letting workerd refuse to start
  (`binding "ENGINE" refers to a service "…", but no such service is defined`),
  and names each one on stderr. A binding back to the Worker itself is kept,
  nothing is written into the app tree, and `--keep-service-bindings` passes the
  config through untouched for an app that runs the target Worker alongside.
  Dropping needs the app's wrangler at 4.99.0 or later (narduk-libs#788).
- c6653d8: Resolve the active Worker version from provider deployment allocation
  instead of versions-inventory list position, page the deployments list the
  same way as versions when `result_info` is present, and add bounded
  preview-alias identity convergence with aggregated post-convergence
  diagnostics (narduk-libs#47).
- 10aca7a: development deploy now reconciles Worker crons and routes after
  promote. Version upload and `POST {script}/deployments` carry code only, so a
  trigger change in wrangler.jsonc previously never applied. The deploy path now
  runs `wrangler triggers deploy` from the artifact's resolved config
  (`.output/server/wrangler.json`, falling back to the source Wrangler file when
  the artifact omits those keys).
- feafb59: development enter refuses an already-disabled held workflow unless it
  is retired or `--accept-prior-state` is journaled. Adopting
  `disabled_manually` as `desiredState` silently left CI and promote off after
  exit (narduk-libs#754). Exit and `development status` now name any workflow
  restored to a disabled state.
- 1dc62db: Add `NeMeter` to the shared-component lists in eslint-config and
  narduk-app-tools so they match narduk-shell's registry after #601.
- 1c10b9b: Add `NeSearchInput` to the shared-component lists in eslint-config
  and narduk-app-tools so they match narduk-shell's registry after #815.
- d880027: `foundation:check` items 1.1, 1.2, 1.4 and 1.5 are not-applicable
  when the app's only declared deployment target is not Cloudflare
  (narduk-libs#158). The checker reads `Config/project-lifecycle.json`
  `environments[].deploymentTargets[].provider`, or `Config/coolify-app.json`
  when there is no `Config/cloudflare-app.json`. A Worker that sets
  `worker.nitroPreset` (or `worker.framework`) to `none` is the same: 1.1 no
  longer fails a hand-rolled `src/index.ts` Worker that has no Nitro build. Item
  1.3 still requires `manifests:validate`. Items 3.1/3.2 read
  `access.exposureClass` from `Config/coolify-app.json` when the Cloudflare
  manifest is absent, so a Coolify public site is still asked for narduk-seo and
  narduk-analytics.
- 9cb7dbf: `narduk-app db migrate` starts far fewer wrangler processes
  (narduk-libs#704). On `--local`, every inspection read — the table list,
  ledger shape and rows, both legacy ledgers, the lock owner and adoption
  evidence — now goes to wrangler as one multi-statement `--command`, so an
  inspection is at most two processes whatever the history. A run that finds
  nothing to apply or adopt and no lock row now returns after that read, without
  taking the lock, and a run whose work another runner already finished skips
  the redundant post-apply read. Against real wrangler on a local D1 with 19
  migrations, a warm (no-op) run went from 20.1 s to 3.3 s. On `--remote` a warm
  run drops from 15 processes to 5, and no remote path starts more processes
  than before: statements are still sent one per process there, because that
  path's multi-statement reply is not proven here. Each migration file is still
  applied and recorded on its own, and a retained lock still fails the run.
- a07c87b: Add `NeCard`, `NeCardList` and `NeDetailView` (item 17, #264).

  The eslint-config and narduk-app-tools shared-component lists name those three
  plus `NeSearchInput` so the drift and item-13 tests match `narduk-shell`'s
  registry. Explorer inventory, catalog, and usage ship beside the components.

  `NeCard` wraps `UCard` with media, title, badge, stat rows and actions.
  `NeCardList` renders the same collection state as the table (`v-model:state`
  or `:collection`) with `NeStatePanel` and `NePager` built in, so one page
  toggles cards and table. `NeDetailView` is a key-value panel: label, value,
  format, unit, and an unavailable message that never looks like zero.

  The pin literal in `create-narduk-app`'s `PACKAGE_VERSIONS` is deliberately
  not hand-edited: `versions:check` requires it to equal narduk-shell's live
  `package.json` version, and `versions:sync` re-pins it when `release:version`
  runs.

- 7ae3a16: Fill the SSR `__NUXT__` payload from Worker public bindings, so
  Workers Builds no longer ships an empty `gaMeasurementId` / `posthogPublicKey`
  when the Worker has the keys (buoys#133).

  Workers Builds does not inject `wrangler.json` `vars` into `nuxt build`, and
  Nuxt's own request-time overlay only maps `NUXT_PUBLIC_*` names. Apps that
  wrote `process.env.GA_MEASUREMENT_ID || ''` shipped an empty page payload
  while `/api/runtime/public` was correct.

  **narduk-core**: a new `00-runtime-public` Nitro plugin runs
  `applyRuntimePublicOverlay(event)` on every page request (not `/api/` or
  `/_nuxt/`) before SSR. It writes the browser-only overlay keys
  (`RUNTIME_PUBLIC_SSR_KEYS`: analytics keys and PostHog flags,
  `allowGeolocation`, `twitterSite`, `seoSearchActionUrlTemplate`) onto the
  request's own `runtimeConfig.public` clone. `previewSafeMode`,
  `deploymentTarget`, the URLs and the auth keys keep their build values on the
  server, because the 5xx sanitizer and narduk-auth read them from the same
  object; the client plugin still applies the full overlay. Preview hosts still
  blank analytics, and `analyticsPrivacy: 'strict'` is untouched. The overlay
  also accepts `NUXT_PUBLIC_GA_MEASUREMENT_ID` /
  `NUXT_PUBLIC_POSTHOG_PUBLIC_KEY` / `NUXT_PUBLIC_POSTHOG_HOST` after the short
  names, and the module seeds `gaMeasurementId` / `posthogPublicKey` so Nuxt's
  native `NUXT_PUBLIC_*` overlay has keys to fill.

  **narduk-analytics** seeds `posthogPublicKey` and accepts the same
  `NUXT_PUBLIC_*` aliases at build time. **narduk-platform** catalog notes,
  **narduk-app-tools** README and the **create-narduk-app** runbook document
  that `cf:runtime-var` is the contract and a `nuxt.config.ts` wrangler reader
  is not.

  **Upgrade (Buoys and any app with the same workaround):** bump
  `@narduk-enterprises/narduk-core` (and `narduk-analytics` if pinned), delete
  the app-local `wrangler.json` reader, drop `NUXT_PUBLIC_GA_MEASUREMENT_ID` /
  `NUXT_PUBLIC_POSTHOG_PUBLIC_KEY` wrangler copies kept only as Nuxt aliases,
  and keep the short names in wrangler `vars`.

- 4a3178b: `create-narduk-app upgrade` now writes only the top-level Workers
  Cache key on an existing `apps/web/wrangler.jsonc`. Bindings, routes and
  account stay app-owned. An explicit `cache.enabled: false` is left alone
  (narduk-libs#672).
- f84b7de: `verify --live --expect-sha` reads `x-build-version` from the health
  route when one is enabled. A prerendered smoke path (generated SEO apps
  prerender `/`) is a static asset and has no Worker header, so exact-SHA live
  proof no longer depends on that route (narduk-libs#781). `--no-health` still
  falls back to the smoke path.

## 0.21.1

### Patch Changes

- 1716307: Exclude the private Libs Explorer from the shared capability catalog
  so foundation coverage does not treat the showcase as an app-adoptable
  package.

## 0.21.0

### Minor Changes

- 1bca010: `deployment.liveProof.healthAuth: "anonymous" | "authenticated"`
  (default `anonymous`). An authenticated health route stays declared,
  `deploy hotfix` and `development deploy` skip the anonymous health assertion,
  item 12.3 says so, and the adoption live read reports requirement 12 unknown
  instead of failing a 401 (#585).
- bad1b0d: Two foundation checks for the components-library plan
  (narduk-libs#260). `narduk-app foundation:check:no-local-copy` (item 13) fails
  when an app depends on a shared UI package and keeps its own copy of one of
  its components. `narduk-app foundation:check:list-routes` (item 14) fails when
  a GET server route reads pagination from its query without narduk-core's
  `parseListQuery`. Each writes its own JSON artefact and uses the usual exit
  codes: 0 pass, 1 fail, 2 unknown. The README documents both.
- ff26c60: `narduk-app doctor` warns when a worker whose `main` is Nitro's
  `.output/server` lacks `no_bundle`, `find_additional_modules` or `base_dir`.
  Without them, wrangler re-bundles the build and every server-rendered 404/500
  comes out empty (#245).
  `deploy versions-promote --wait-for-version <seconds> [--wait-interval <seconds>]`
  re-lists while the commit's version is absent, so a Workers Build that
  finishes after CI no longer turns an unbroken merge into exit 3 (#695). The
  default is 0, which keeps today's single look.
- e6c9263: `.github/dependabot.yml`'s npm update now splits into two groups by
  `update-types` over the same packages: `safe` (minor + patch) and `majors`
  (major), `open-pull-requests-limit: 2`. A new generated
  `.github/workflows/dependabot-merge.yml` merges the `safe` lane once CI is
  green on its exact PR head; `majors` and the `github-actions` lane stay a
  deliberate person/agent PR. This replaces the old single all-in `dependencies`
  group (gonogo#104, the reference shape): apps on the old canonical shape
  (`open-pull-requests-limit: 10`, ~10 groups) stacked roughly ten open PRs that
  all edited `pnpm-lock.yaml`, so merging any one conflicted the rest, and a
  single combined group let one breaking major hold every harmless patch bump
  red behind it (riverstatus#215).

  `create-narduk-app upgrade` delivers `.github/workflows/dependabot-merge.yml`
  to existing apps as a new whole-file managed target alongside the refreshed
  `.github/dependabot.yml`.

  `narduk-app-tools`' `foundation:check` gains an advisory-only print (not a
  `FoundationSubCheck`, since this framework has no warning tier) that flags a
  `.github/dependabot.yml` npm update reproducing the old stacking shape:
  `open-pull-requests-limit` above 2, or npm groups not split by `update-types`
  into a safe and a majors lane. It never affects the check's `score`, `result`,
  or `exitCode`.

### Patch Changes

- 8ec9bb9: Tooling carpool: the migration runner refuses a contract-owned D1
  database named by its `database_name` as well as its id (#637); foundation
  item 5.2 accepts the canonical Dependabot recipe, an npm update routed through
  a registry scoped to `@narduk-enterprises` (#241); a failed schema-adoption
  probe names the adoption, says the migration has no receipt yet, and says how
  to record it or correct the evidence (#600).
- 6255d0c: Give the development build workspace a repository of its own, so an
  app's existing repository-shaped checks (`git rev-parse --show-toplevel`,
  `git ls-files -co --exclude-standard`, `git status`) run against the captured
  source instead of refusing the deploy with "fatal: not a git repository". The
  workspace repository is local-only, excludes the publisher's git identity,
  signing, hooks and init templates, and is kept between deploys so each
  iteration costs one incremental commit.

## 0.20.0

### Minor Changes

- 1759259: Foundation check 12.7 now needs narduk-core **2.10.1** or later
  before an app turns on Workers Cache, up from 2.2.4. Cores from 2.2.4 to
  2.10.0 still let Cloudflare store a thrown JSON 404 as Nitro's `no-cache`
  (narduk-libs#493). An app with the switch on and an older core now fails 12.7;
  upgrade narduk-core or remove the `cache` block.

  New `docs/workers-cache.md`: the standard for turning Workers Cache on in an
  existing app (narduk-libs#435), with its preconditions, the wrangler change,
  the `verify --live --edge-cache-path` proof, purging and rollback.

## 0.19.1

### Patch Changes

- e61a56d: `narduk-app doctor` now refuses a rate-limit `namespace_id` that is
  not a positive decimal integer, such as `"abc"`, `"0x1F"`, `"0120"`, `-5` or
  `1.5` (#509). Scaffold ids and ids declared twice were already refused,
  including across `env.*` overlays.

## 0.19.0

### Minor Changes

- 0e1a1ee: `foundation:check:deployment` enforces the expand-only half of
  `deployment.migrations.compatibility: "expand-contract"` (#399). New sub-check
  12.9 fails an app-owned D1 migration that drops or renames a table, view or
  column, because `narduk-app deploy rollback` restores code, never a schema. A
  deliberate contract migration is declared under
  `deployment.migrations.contractMigrations` (`path`, `sha256`, `reason`),
  pinned to the checksum the migration ledger records, and the failure prints
  that entry. An app with such a migration in its history adopts the rule by
  listing it once.

  `deployment.rollback.mode` now defaults to `manual` in new apps. Nothing ever
  read `"auto"`, so a generated app was declaring an automatic safety net it did
  not have. New sub-check 12.10 fails `"auto"`; the value still parses, so older
  manifests do not stop the tools. The generated deployment doc now says what
  actually triggers a rollback: only the app's own promote step, after a
  completed promotion fails its live proof. A failed migration triggers nothing.

- 2a35b4e: `foundation:check:coverage` gives each shared capability one of three
  states: `absent`, `adopted` or `forked` (#620). A capability is `forked` when
  an app pins the package and also carries its own copy of the package's
  internals. It is reported with its files and line count, and it no longer
  counts as adopted. Item 9.1 names it but does not fail, because some forks are
  deliberate and tracked.

  The signal is opt-in per capability, through `forkStems` in the generated
  catalog. Today only `narduk-mapkit` declares one (`mapkit`). A file counts
  when a directory segment of its path, or its own name, equals the stem, and it
  imports no package named for that stem.

  Inventory rows gain `state` and `fork`. `adopted` is now true only for
  `state: "adopted"`.

- ca8f56f: Generated apps run `foundation:check:deployment` and
  `foundation:check:shared-ui-pinned` with `--checkout ../..`, the repository
  root. They used to pass `--checkout ..` from `apps/web`, which is `apps/`, and
  item 12 read that as "no deployment block, not applicable" with exit 0 (#679).

  The foundation checks now exit 1 when `--checkout` has no `package.json`,
  naming the directory and the fix, so the old path cannot pass quietly. This
  covers `foundation:check` and its `:shared-ui-pinned`, `:toolchain`,
  `:deployment` and `:coverage` variants. **An app scaffolded before this fix
  must change `--checkout ..` to `--checkout ../..` in `apps/web/package.json`**
  before it takes this version.

### Patch Changes

- bbe7a1a: Document a post-merge deploy assertion for apps whose Workers Build
  deploys directly: a job that runs
  `narduk-app verify --live --expect-sha "$GITHUB_SHA"` over a build-length wait
  and names the Workers Build on failure (narduk-libs#597).
- c67b585: The generated `docs/deployment/promote-d1.steps.yml` now starts with
  two credential-free steps. They run `foundation:check:deployment` on the exact
  SHA being promoted, and refuse to migrate unless sub-check 12.9 passes. Only
  12.9 is judged, so another sub-check's UNKNOWN does not block a promotion.
  Worker rollback restores code, never a schema, so automating rollback beside
  the migrate step is safe only with this check in front of it (#399). The
  deployment-migrations runbook specifies the same ordering. It also names the
  check as a precondition for any promote workflow that runs
  `narduk-app deploy rollback` automatically.

  Existing apps copied the template once. To adopt, paste the two new steps
  above the dry-run step.

## 0.18.0

### Minor Changes

- e42c8c9: `narduk-app doctor` checks Cloudflare rate-limit namespace ids
  (#433). A `ratelimits` binding, top level or under `env.*`, fails if it uses a
  scaffold id (`1001`, `50110`, `50121`, `50300`), if its id is declared more
  than once, or if it has no `namespace_id`. `namespace_id` is unique per
  account, so any of those shares counters with another Worker or environment.
  An app with its own unique ids passes.

  `create-narduk-app` writes the new app's own namespace prefix into
  `wrangler.jsonc`, derived from the Worker name by narduk-core's scheme, beside
  a commented example binding. It still emits no binding, because the limiter
  needs none.

### Patch Changes

- 3dce8b4: Foundation item 11.3 no longer fails a job that calls a shared
  workflow with no Node input, such as `cursor-review.yml`. It no longer tells a
  caller of a `node-version`-only callable to use `node-version-file`, an input
  that callable does not declare; 11.1 still holds that caller's literal to
  `.node-version`. Workflows are also evaluated per job, so one job's
  `node-version-file` no longer satisfies another job in the same file.

## 0.17.0

### Minor Changes

- 7aeacad: Add owner-enrolled development mode (company-hq#781).
  `narduk-app development` gains `deploy`, `status`, `enter`, `pin`/`unpin`,
  `exec`, `validate`, `handoff`, `resolve` and `exit`. The optional
  `deployment.development` capability declares targets. A host-private
  activation record grants custody. Deploys capture the checkout, dirty edits
  included, and gate, build, upload, promote and prove the exact build ID under
  a target lock shared with hotfixes. Entry holds classified workflows and
  Workers Builds triggers and restores them exactly on exit, after the merged
  release commit passes explicit validation. Existing apps are unchanged until
  an owner enrolls them. See `docs/development-mode.md`.

  create-narduk-app now emits a `deploy:dev` script, a private-app explicit
  validation caller (`.github/workflows/validate.yml`, `narduk-validation/**`
  pushes only) and a Development mode section in `docs/workers-builds.md`. It
  never declares the capability.

## 0.16.0

### Minor Changes

- 7b99efb: `doctor --adoption --live` and `foundation:check:security-headers`
  now probe the paths the app declares in `deployment.liveProof`, instead of a
  hard-coded `/`, `/api/health` and `x-build-version`.

  Requirement 5 reads the build stamp from `liveProof.smokePath` under the
  header `liveProof.buildVersionHeader`, requirement 12 reads
  `liveProof.healthPath`, and requirement 8 points its header probe at the
  declared smoke path. With no `--path`, `resolveProbeUrls` now reads the base
  URL exactly as given rather than resolving `/` against it, so a
  `--base-url https://app.example/login` probes `/login`.

  `foundation:check:deployment` item 12.3 already requires those fields, so the
  declaration always existed and the tools simply did not read it. On an
  authenticated app -- one whose root correctly refuses an anonymous request --
  that reported a working delivery path as undecided (R5) and a working health
  contract as failing (R12), and rewarded an app that left its health route open
  to anonymous callers over one that did not. A required `unknown` blocks
  declaration, so this was not a cosmetic verdict.

  The old values remain the fallback for an app that declares no `liveProof`
  block, so an app declaring the defaults is unaffected. `DeploymentArtefact`
  gains `declaration.liveProof`, and `AdoptionLiveReading` gains `smokeUrl`,
  `healthUrl` and `buildVersionHeader` so a report names the routes it actually
  read.

- de5abe4: Add an explicit local incident hotfix command with a clean commit
  snapshot, offline frozen install, required app checks, isolated build
  credentials, confirmed production target, version promotion, live proof and a
  durable failure receipt. Ship the operator runbook and generator scripts.
  Existing deployment commands remain compatible.

  Prevent the shared live probe from forwarding caller-provided request headers,
  including Cloudflare Access credentials, through cross-origin redirects.

### Patch Changes

- c7a2aaf: Read `GH_PACKAGES_READ` as a registry credential, so
  `foundation:check` is decided on the sanctioned local route.

  Item 2.3 needs a live packument read to place `narduk-core` in its N-1 window.
  `NpmRegistryReality` takes its token from the environment and deliberately
  from nowhere else — it reads no `.npmrc` and no `_authToken` line, so that a
  project routing the scope elsewhere gets an anonymous read rather than a
  credential. It looked for `NODE_AUTH_TOKEN`, `GH_TOKEN` and `GITHUB_TOKEN`.

  `gh-packages-run` — the only sanctioned local route, and the one the estate
  READMEs name — supplies the value as `GH_PACKAGES_READ` and writes a 0600
  process-scoped userconfig referencing it by name, which is what `pnpm install`
  needs and which this reader cannot see by design. So the credential was
  present in the environment during `gh-packages-run pnpm run foundation:check`
  and invisible to the component that needed it: item 2.3 collapsed to
  `unknown`, and `UNKNOWN` is a blocking exit. There was no documented local
  invocation that produced a decided result (narduk-farm#148).

  `GH_PACKAGES_READ` is now last in that chain. Last rather than first keeps the
  CI path byte-identical: `nuxt-cloudflare.yml` already aliases the two names to
  the same value, and its own comment named this change as the fix — _"Export
  both names, same value, until narduk-app-tools reads GH_PACKAGES_READ
  instead."_ That alias exists because workflows#79 renamed the exported
  credential and silently broke package-token-mode `foundation-check` for every
  v1 adopter past `afbaa6051e` (buoys#39). It can retire once callers are past
  this release.

  No new destination for the token: it is still sent only to
  `npm.pkg.github.com`, and a mirrored or lookalike scope route still gets an
  anonymous read.

- 3e38fc5: `og:check`'s canonical-origin mismatch error now names both the
  actual and expected `og:url`, and hints `NUXT_PUBLIC_SITE_URL` for a local
  `--base-url` run instead of leaving "og:url does not identify the sampled page
  on the canonical origin" with no clue why (#587). Also documents when a page
  keeps the static `defaultOgImage` fallback versus getting its own generated
  image — the rule follows whether `useSeo` is called (and how), not whether the
  page is indexed.

  Pure diagnostics/docs fix, no public API change.

- 88f8ae7: `parseWranglerVersionsJson` (used by `promote`'s
  `deployments list`/`versions list` reads) now anchors to the LAST line that
  starts with `[` or `{` at column 0, instead of the first bracket anywhere in
  the captured stdout. A warning printed earlier in the same `pnpm exec` chain
  (for example, an `engines` mismatch:
  `WARN Unsupported engine: wanted: {"node":"24.21.0"}`) could contain a bracket
  mid-line; the old heuristic parsed that fragment instead of wrangler's real,
  later JSON document and reported a confusing "wrangler-failed" outcome that
  named nothing real (#470). The parse-failure message also now includes the
  first 200 characters of the captured stdout, so contamination like this names
  itself instead of being invisible.
- 9452204: Document verified persona injection for local hotfix credentials
  whose registered nVault key names differ from Wrangler's environment variable
  names.

  Preserve runtime variables through generated Wrangler configuration so local
  hotfix uploads support Wrangler 4.90.1, whose versions-upload command does not
  yet accept the equivalent CLI flag.

## 0.15.0

### Minor Changes

- eb07a18: Declare who owns each D1 schema: `deployment.databaseOwnership`

  `deployment.migrations` had to cover **every** D1 binding exactly once, which
  is right for a database whose schema is its migration history and wrong for
  one whose schema is owned by a contract and applied by a refresh job. The only
  way such an app could declare migrations for the rest of its estate was to
  manufacture a migration baseline for a database nobody migrates -- a false
  claim that the ledger describes that schema.

  `Config/cloudflare-app.json`'s deployment block now accepts an optional
  `databaseOwnership` array giving every binding exactly one owner: `migrations`
  (resolving to an entry in `deployment.migrations.databases`) or `contract`
  (naming the schema contract file and the package script that proves it).
  Absent, nothing changes -- an app that migrates everything keeps working with
  no config edit.

  The load-bearing part is at the runner, not the validator:
  `migrationDatabase()` is the single function every migration path uses to
  reach D1, and it refuses a contract-owned binding before any provider call.
  `db migrate --database READ_MODEL`, `db status`, `db migrate-deployment`,
  baseline capture and baseline registration are all refused, as is a wrangler
  config pointing another binding name at the contract-owned database id. The
  contract-owned database is also absent from the minimal wrangler config the
  deployment runner is handed.

  `foundation:check:deployment` sub-check 12.8 now applies the same coverage
  rule from the same implementation -- a contract-owned binding passes without a
  source manifest, while an uncovered or doubly-owned binding still fails -- and
  `doctor --adoption` requirement 6 reads that sub-check.

## 0.14.0

### Minor Changes

- 76e8727: feat(narduk-app-tools): `doctor --adoption` reports the fifteen
  adoption requirements

  The narduk-app adoption standard (company-hq#746) asks fifteen questions of an
  app. Six CLI commands already answered twelve of the web-foundation contract's
  items, but nothing assembled them into the thing a sign-off actually needs:
  one artefact, per requirement, that says what was checked, what the verdict
  is, what the evidence was, and **who decides the part no command can**.

  `narduk-app doctor --adoption` is that artefact. It composes the existing
  checks rather than reimplementing them — `foundation:check`,
  `:shared-ui-pinned`, `:coverage`, `:security-headers`, `:toolchain`,
  `:deployment` — and adds the two evaluators nothing owned:

  **Requirement 2, package currency.** Every consumed estate package must be
  exact-pinned at the latest published stable release, every manifest that pins
  it must agree, and the installed version must be the declared one. Four
  failures hide behind "the dependencies are fine": a range spec, two manifests
  in one workspace pinning different versions (the normal shape of a generated
  app, with the app's own dependencies in `apps/web`, and the normal way the two
  fall out of step), a pin behind the registry, and a pin that matches the
  registry while `node_modules` holds something else.
  `foundation:check:shared-ui-pinned` already refuses a non-exact pin, but only
  for the shared-UI packages and only on exactness; currency is a different
  claim over a wider set.

  **Requirement 9, MapKit provenance.** "The app installed a package called
  mapkit" is not "the app consumes the maintained one", and four stale shapes
  look identical from a dependency list: a standalone-era package name, a
  vendored copy a lockfile resolves happily, a `file:`/tarball specifier, and
  the frozen `narduk-mapkit-nuxt` adapter pinned at 2.0.x — which leaves a Nuxt
  app on a supported package and an unsupported entry at once.

  **What it refuses to claim.** Every requirement carries the tier it was
  actually decided at: `enforced`, `partially-enforced`, or `manual`. A `manual`
  requirement reports `unknown`, names its owner, and appears in `manualReview`;
  there is no flag that turns one into a pass. The top-level `result` is the
  verdict over the machine-decidable requirements only, so a PASS can never be
  read as proving more than was checked. Requirement 9 never says the map works
  — that is real-SDK browser evidence, and inferring it from a dependency line
  would be the false capability claim the standard forbids.

  Item 12 reports `not-applicable` for two different facts, and this report
  keeps them apart: an app with no `deployment` block is `unknown` (rollout
  mode's N/A is right for a rollout gate and wrong for a declaration — nobody
  wrote the delivery path down), while an app declaring a different standard is
  the `deviation` verdict.

  **The seven-item artefact is untouched.** `foundation:check` emits exactly the
  document its consumers already parse, bare `doctor` keeps its output and exit
  code, and this is a separate artefact with its own tool name and schema.

  Exit codes follow the existing convention — `0` PASS, `1` FAIL, `2` UNKNOWN,
  the last including every run given no `--live`, since three requirements are
  questions only a deployed origin can answer — and add `3` DEVIATION. An app
  declaring a different deployment standard is not failing the standard, but it
  has not adopted it either; exiting `0` would let an automation reading the
  exit code as "adopted narduk-v1" read a declared departure as adoption.

### Patch Changes

- d3f91b4: fix(narduk-app-tools): item 1.1 treats `-` and `_` as the same preset
  separator

  Nitro does, and the two spellings reach this check from different places: an
  app's `nuxt.config` literal and its `Config/cloudflare-app.json` both say
  `cloudflare_module`, while a completed build writes the canonical
  `cloudflare-module` into `.output/nitro.json`. Item 1.1 compared the raw
  string, so the live-build fallback — the path that exists precisely for an app
  not yet onboarded into the deployment standard — failed every app it was meant
  to serve, and only after a build had run (narduk-libs#350).

  The comparison now normalises the separator on both sides. Nothing else moves:
  a genuinely wrong preset (`cloudflare-pages`) still fails, and the FAIL detail
  now says the separator is already normalised so the next reader does not
  re-diagnose this.

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
