---
status: active
owner: Logan Renz
last_verified: 2026-07-15
reference_app: narduk-enterprises/been-sober-for
---

# Template-based app to independent app migration

This is the operator runbook for converting an application created from
`narduk-template` into an ordinary, independently owned Nuxt repository. It is
based on the completed Been Sober For (BSF) package and application decoupling,
its source-account production deployment, and its 2026-07-15 Cloudflare traffic
cutover to Narduk Enterprises. It is deliberately more procedural than the fleet
architecture in
[`../../architecture/narduk-template-decommission.md`](../../architecture/narduk-template-decommission.md).

This packet has three parts:

```text
docs/operations/template-decoupling/
├── README.md                         # operator runbook and failure catalog
├── been-sober-for.evidence.json      # secret-free, machine-readable exemplar
└── skill-author-contract.md          # state machine and interface for automation
```

The package/application decoupling and a Cloudflare account move are separate
programs. Complete and deploy the independent app in its current account before
moving any data, zone, domain, or Registrar ownership. For the latter, use
[`../cloudflare-account-cutover.md`](../cloudflare-account-cutover.md).

## Outcome and non-goals

A migrated repository:

- installs exact immutable `@narduk-enterprises/*` versions from GitHub
  Packages;
- owns its scripts, CI, Renovate, test configuration, Worker configuration,
  runtime configuration, and database source map;
- uses explicit package exports instead of `#layer` or synthetic ORM aliases;
- has no template metadata, sync/reconcile workflow, fleet mutation, Command
  callback, or `narduk-cli` dependency;
- can install, test, migrate, build, and produce a deploy dry-run without a
  template checkout; and
- has an evidence record that another operator can independently verify.

This work does not create a new template, sync system, drift manager, fleet
deployer, or control plane. It does not shut down Command. It does not move a
Cloudflare zone or production data unless that is separately authorized and the
account-cutover gates pass.

## Status vocabulary

Never compress the migration into a single `done` flag. Use these states:

| State                      | Meaning                                                                                                 |
| -------------------------- | ------------------------------------------------------------------------------------------------------- |
| `inventoried`              | Remote truth, production baseline, dependencies, capabilities, data, and routes are recorded.           |
| `packages-ready`           | Required packages have passed candidate and external-consumer gates and are published immutably.        |
| `app-decoupled`            | The app has no functional template coupling and all app-owned local gates pass.                         |
| `source-deployed`          | The exact merged decoupling release is proven in the existing production account.                       |
| `target-rehearsed`         | A production-data rehearsal and target workers.dev proof pass without touching target production data.  |
| `account-cutover-ready`    | Zone, Workers Build, credentials, target production resources, and go/no-go packet are complete.        |
| `traffic-cutover-complete` | Data, zone, Registrar, Custom Domains, HTTPS, and writes pass in the target account.                    |
| `product-proof-complete`   | Authenticated final-domain profile mutation and upload/retrieval pass, including required device proof. |
| `retention-complete`       | The 30-day recovery window closes and source resources are removed after zero-traffic proof.            |

BSF is `traffic-cutover-complete`: authentication succeeded on the physical
iPhone by user/operator attestation, but profile mutation and upload/retrieval
remain unproven. Reviewer sign-off and the 30-day retention closeout also remain
open. Do not collapse those facts into a single `complete` flag.

## Phase 0: establish remote truth

Do not start from an old migration branch, a dirty shared checkout, or a local
`main`. The historical BSF branch proved package consumption, but the actual
cutover started again from current `origin/main`.

1. Fetch and prune each app, `narduk-libs`, and any capability repository.
2. Confirm the remote default branch and create a fresh worktree from it.
3. Preserve unrelated dirt and existing worktrees.
4. Record the baseline commit, production Worker version/deployment, public
   build marker, routes, domains, resource IDs, schedules, and current health.
5. Capture the current dependency and lockfile source graph.
6. Inventory every inherited surface before deleting it. A file inherited from
   the template may now contain app-owned changes.

Minimum baseline commands, adapted to the repository:

```bash
git fetch --prune origin
git remote show origin
git status --short --branch
git worktree list --porcelain
git rev-parse origin/main
pnpm list --depth Infinity
rg -n --hidden 'narduk-template|narduk-cli|narduk-fleet|#layer|templateManaged|CONTROL_PLANE_URL' .
```

The search output is evidence, not an automatic deletion list. Documentation,
archived history, ordinary Babel package names, and unrelated vendored `file:`
dependencies can be legitimate. Classify functional coupling by inspecting the
owning file and dependency.

## Phase 1: classify capabilities and ownership

Build an app-specific capability table before changing package pins:

| Capability                          | Migration action                                                                                          |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Core, auth, analytics, SEO, uploads | Consume the exact published package from `narduk-libs`.                                                   |
| Shared test fixtures                | Consume `@narduk-enterprises/narduk-testkit`; retain app-owned config and wrappers.                       |
| App-local operations                | Use `@narduk-enterprises/narduk-app-tools`; keep direct package scripts.                                  |
| AI                                  | Consume `@narduk-enterprises/narduk-ai`; keep `system_prompts` migration ownership in core.               |
| MapKit                              | Consume canonical packages from `narduk-geo/narduk-mapkit`, not `narduk-libs`.                            |
| Operator UI                         | Recreate only actually used primitives locally with Nuxt UI.                                              |
| PWA                                 | Remove through a service-worker cleanup release followed by a removal release.                            |
| Ingestion                           | Freeze in place until `narduk-data` passes its acceptance gate. Do not copy or invent an interim package. |

Record `apps/web/package.json` `narduk.capabilities` for status and onboarding
only. It must never trigger sync or mutation.

## Phase 2: prove and publish the package closure

Do this before editing the app lockfile. A repository-local green build does not
prove that the consumer can install the package.

1. In `narduk-libs`, determine the complete transitive package closure and exact
   versions needed by the app.
2. Build, typecheck, test, lint, run `publint`, and pack each changed package.
3. Install only packed artifacts into a fixture outside the monorepo.
4. Run a production Nuxt/Cloudflare build, package consumer tests, database
   compilation, and deploy dry-run in that fixture.
5. Merge the candidate only after exact-head CI is green.
6. Require the regenerated Changesets release PR's exact head to pass; its SHA
   is a distinct gate from the package candidate.
7. Merge the Changesets release PR, require merged-main release success for the
   exact merge SHA, and prove tags, package metadata, and authenticated registry
   install.
8. Do not let the app consume a version merely because a tag exists. Verify the
   immutable artifact through the registry.

GitHub Packages is the canonical registry. GitHub Actions installs with its
repository `GITHUB_TOKEN` and `permissions: packages: read`; grant the consumer
repository access to every private package in the transitive closure. External
builders use the approved organization read token through their secret store.
Never commit `.npmrc` credentials or install a reusable personal token in an app
repository.

The BSF package closure at its accepted app head was:

```text
@narduk-enterprises/narduk-analytics  1.19.20
@narduk-enterprises/narduk-auth       1.19.27
@narduk-enterprises/narduk-core       1.20.0
@narduk-enterprises/narduk-seo        1.20.0
@narduk-enterprises/narduk-uploads    1.19.18
@narduk-enterprises/narduk-app-tools  0.1.2
@narduk-enterprises/narduk-testkit    1.0.0
```

`narduk-platform`, `narduk-app`, and `eslint-config` may be transitive members;
registry access must cover the full lockfile closure, not only direct
dependencies.

## Phase 3: regenerate the app dependency graph

1. Replace workspace, Git, branch, tarball, and template-layer dependencies with
   exact package versions. Do not use ranges for Narduk packages during
   migration.
2. Configure both the repository root and nested workspace package for GitHub
   Packages when nested installs or Cloudflare builds may change the working
   directory.
3. Regenerate `pnpm-lock.yaml` using only published artifacts.
4. Perform a clean frozen install using the same authentication class CI uses.
5. Inspect lockfile resolution sources, not just `package.json`.
6. Capture the lockfile SHA-256 and resolved Narduk dependency graph.

Use scoped searches. BSF intentionally retained an unrelated app-owned
`file:vendor/archiver-utils`; a blanket ban on every `file:` entry would have
been a false failure.

## Phase 4: materialize app-owned operation surfaces

Before deleting template files, make the app self-sufficient:

- `.github/workflows/ci.yml` with meaningful PR and main gates;
- `renovate.json` for independent `@narduk-enterprises/*` updates;
- root and app package scripts that call the actual tools directly;
- root `playwright.config.ts` and app-owned Vitest configuration;
- `apps/web/wrangler.jsonc` plus isolated staging/test variants where needed;
- `apps/web/nuxt.config.ts` with explicit modules, aliases, runtime config, and
  environment validation;
- app-owned registry authentication script or `narduk-app registry-auth`;
- app-owned database source map and seed/reset behavior; and
- app-owned operating documentation and rollback pins.

Quality, formatting, linting, typechecking, Knip, tests, and builds remain
direct scripts. `narduk-app` is for focused operations, not a new wrapper around
the entire lifecycle.

## Phase 5: migrate imports, schemas, and database journals

### Aliases

- Keep Nuxt's native `#server/*` for concrete app files.
- Replace `#layer/server/*` imports with explicit package subpaths.
- Replace synthetic app/core ORM aliases with one app-owned `#narduk-db` dialect
  selector.
- Use package-private `#narduk-core/schema` and `#narduk-core/postgres-runtime`
  only inside their owning package contract.

### Migration sources

Create `apps/web/migrations.sources.json` with stable source IDs. Package
migrations run before app migrations. `_narduk_migrations` uses
`(source, filename)` identity plus checksum, source version, and application
timestamp; it does not replace or rewrite the legacy journal.

Legacy adoption is evidence-based:

1. Enumerate legacy rows and candidate stable migrations.
2. Read the SQL.
3. Inspect every required table, column, and index in the actual database.
4. Record the stable source, filename, and checksum plus schema evidence.
5. Fail closed on ambiguity or checksum drift.
6. Run migrations twice and require the second run to apply and adopt nothing.

Never reset a remote database. Rehearse remote changes against a current
production copy and use forward-only corrective migrations.

## Phase 6: remove functional template coupling

Only after phases 3 through 5 are locally green, remove:

```text
.template-reference/
.template-version
narduk.layout.json
guardrail-exceptions.json
scripts/narduk-toolchain.mjs
template sync/reconcile workflows
Command callbacks, leases, and registry mutation calls
@narduk-enterprises/narduk-cli
@narduk-enterprises/narduk-starter-toolkit
@narduk-enterprises/narduk-nuxt-module
@narduk-enterprises/narduk-nuxt-template-layer-*
```

Compare inherited files before deletion. Preserve app-owned documentation,
tests, hooks, and configuration by moving or rewriting them under explicit app
ownership. Remove stale AGENTS instructions that still require template-only
paths or APIs.

The functional zero-reference scan excludes archival documentation and this
deprecation runbook, but it includes active source, scripts, workflows,
configuration, and dependency metadata. Store both the command and its empty
output or checksum in the evidence record.

## Phase 7: add a cutover-safe maintenance contract

If a later account or database move is expected, add maintenance mode during the
app migration so it is tested before the outage window.

The BSF contract is `BSF_MAINTENANCE_MODE=off|read-only`:

- invalid or missing unexpected values fail closed;
- public pages, health, images, and status remain readable;
- unsafe methods, uploads, account provisioning, destructive operations, session
  exchange, native auth, and auth refresh are blocked before shared middleware
  can create state;
- blocked responses are `503` with `Retry-After: 60`; and
- health/status exposes only the mode, never secret configuration.

Customize mutation coverage for each app. A generic unsafe-method guard is not
enough if a GET route creates sessions or state.

## Phase 8: local and exact-head acceptance

Run the same commands CI will run, from a clean install:

1. frozen install from authenticated immutable packages;
2. format check;
3. lint with zero warnings;
4. typecheck;
5. unit and integration tests;
6. production Nuxt/Cloudflare build;
7. Knip/dead-code check;
8. local D1 migration and an empty second pass;
9. full browser acceptance;
10. maintenance-mode positive and negative tests; and
11. Wrangler deploy dry-run with expected bindings and asset count.

Open one focused PR. Record its head SHA before trusting checks. A locally green
branch is not complete until exact-head CI is green on the runner class that
will protect the repository.

BSF's accepted decoupling head `ae35e2f0c512` passed 44 unit tests, 102 browser
tests, build, Knip, eight local migrations followed by an empty second pass, and
a deploy dry-run with 224 assets plus D1, KV, R2, and seven rate-limit bindings.
It merged as `e949bd9873bd` in PR
[#62](https://github.com/narduk-enterprises/been-sober-for/pull/62).

## Phase 9: prove the merged release in the current production account

Do not combine this with the account transfer.

1. Capture D1 recovery state/export, migration ledgers, schema/index metadata,
   table counts, R2 manifest, KV inventory, current Worker version, routes, and
   health.
2. Deploy the exact merged SHA using the repository-owned production path.
3. Run stable-ledger adoption and migrations; require an empty repeat.
4. Confirm the deployed SHA/build marker and every app-critical public, auth,
   mutation, storage, cron, and device route.
5. Reconcile D1, R2, and KV against the pre-deploy record.
6. Store protected raw evidence locally with restrictive permissions; check in
   only checksums, IDs safe for documentation, counts, names, and conclusions.

BSF source proof retained 21 legacy and eight stable migration rows, 14 R2
objects totaling 5,818,346 bytes, an empty KV namespace, and the expected D1
table counts while serving exact build marker `e949bd9873bd`.

## Phase 10: rehearse the target account without risking production

Use the separate Cloudflare account runbook. The important ordering learned from
BSF is:

1. Provision target resources, but leave target production D1 untouched.
2. Build the exact merged SHA with a temporary config: a uniquely named
   disposable D1, `routes: []`, `workers_dev: true`, staging search safety, and
   read-only maintenance.
3. Hard-reject the target production D1 by both name and UUID in rehearsal
   tooling.
4. Export live source D1, import into the disposable target database, reconcile
   schema/indexes/ledgers/counts, and run migrations twice.
5. Pre-copy and delta-copy R2 using separate source and target credentials;
   compare key and size manifests and retain ETags/checksums for review.
6. Classify KV. Create an empty target namespace instead of copying an empty
   cache.
7. Recreate runtime secret names from the approved owner without reading or
   recording values.
8. Prove health, public routes, login/callback surfaces, mutation blocking,
   object retrieval by class, and build identity on `workers.dev`.
9. Revoke every temporary operator token immediately after its bounded use.

The rehearsal is not a production cutover. Do not attach Custom Domains, move
DNS or Registrar ownership, enable writes, or run a deploy command that
implicitly migrates target production D1.

## Phase 11: prepare and execute the final account cutover

This phase remains pending for BSF. Before it can start, the target Workers
Build, build variables, zone configuration, credentials, billing/verification,
Registrar acceptance, and target production go/no-go packet must be complete.

Follow [`../cloudflare-account-cutover.md`](../cloudflare-account-cutover.md)
for the freeze, final D1 export/import, R2 delta, DNS/Registrar/Custom Domain
move, HTTPS proof, write reopening, rollback boundaries, and 30-day retention.
Do not treat target rehearsal evidence as final-freeze evidence; re-measure all
mutable data.

## Evidence packet requirements

Each app gets one checked-in secret-free evidence manifest patterned after
[`been-sober-for.evidence.json`](been-sober-for.evidence.json). Protected raw
artifacts stay outside Git and are referenced by absolute operator path plus a
manifest checksum.

Required evidence classes:

- app/repository identity, baseline SHA, accepted head, merge SHA, PR, and
  deployed SHA;
- exact direct package versions, transitive package-access closure, lockfile
  checksum, registry host, and clean-install proof;
- CI run URLs and results for candidate head and merged main;
- executed gate names and quantitative results;
- migration source config checksum, legacy/stable ledger counts, adoption
  evidence, schema/count checksums, and empty-repeat proof;
- Worker/deployment IDs, account/resource IDs, bindings, domains, schedules,
  runtime/build variable names, and secret names without values;
- D1 recovery/export checksum, R2 manifests/count/bytes, and KV classification;
- route/status/maintenance/auth/storage/device proofs;
- zero-reference command and result;
- operator, reviewer, timestamps, rollback point, and explicit blockers; and
- protected evidence roots and their checksum manifests.

Every proof records the exact commit it tested. Evidence from an older head can
support history but cannot satisfy the current gate.

## Failure catalog and skill guardrails

| ID    | Symptom                                                                       | Cause                                                                                                                       | Required guard                                                                                                                                             |
| ----- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `F01` | Package publication is blocked by npm/passkey.                                | npm was treated as the only registry.                                                                                       | Use GitHub Packages as canonical; verify authenticated install before app work.                                                                            |
| `F02` | GitHub Packages grant job returns `404`.                                      | Package Actions access is not available through the assumed API/path or token.                                              | Treat repository `GITHUB_TOKEN` plus explicit package Manage Actions access as the CI contract; probe access with a frozen install.                        |
| `F03` | `narduk-app` works locally but cannot spawn pnpm in CI.                       | `npm_execpath` may point to JS, native, missing, or stale paths; nested scripts may lose PATH.                              | Resolve only existing executable candidates, include `PNPM_HOME`, preserve PATH, and test in the real runner.                                              |
| `F04` | Browser jobs intermittently fail with address-in-use.                         | Multiple runner registrations share one LXC/network namespace and fixed port `4173`.                                        | Derive an isolated high port from `GITHUB_RUN_ID`; pass the same port to server and Playwright.                                                            |
| `F05` | A CI-only selector fails despite correct UI.                                  | Ambiguous text selector such as `getByText('42')`.                                                                          | Prefer stable app-owned test IDs or role/name contracts.                                                                                                   |
| `F06` | A shell proof corrupts PATH or status handling.                               | zsh reserves variables such as `path` and `status`.                                                                         | Use names such as `route_path` and `http_status`; run shellcheck-equivalent review.                                                                        |
| `F07` | Route proof reports false failures.                                           | The script guessed `/profiles` or `/api/build` instead of inspecting the app.                                               | Derive routes from source/tests and record the route contract before probing.                                                                              |
| `F08` | Maintenance test expects the wrong body.                                      | The error is wrapped in the framework's nested `.data` envelope.                                                            | Assert status, headers, and the actual serialized response contract.                                                                                       |
| `F09` | Target rehearsal sitemap is `404`.                                            | Staging intentionally disables indexability.                                                                                | Treat `404` plus `X-Robots-Tag: noindex, nofollow` as rehearsal success; prove production sitemap after domains move.                                      |
| `F10` | Deploy upload succeeds but route reassertion errors.                          | Source token lacks zone-route permission while existing routes remain valid.                                                | Inspect deployed Worker version and live route state independently; do not broaden credentials merely to repeat an idempotent route write.                 |
| `F11` | Rehearsal risks production data.                                              | Normal deploy command migrates the configured remote D1.                                                                    | Generate a temporary rehearsal config, hard-deny production D1 name/UUID, and never invoke the production deploy script.                                   |
| `F12` | Operator command receives the wrong secrets/account.                          | Repository Doppler defaults point at a broad or stale config.                                                               | Remove dangerous defaults; require explicit project/config on every operator invocation.                                                                   |
| `F13` | Cloudflare mutation cannot be completed with an account token.                | Workers Builds and some zone/user operations require user-scoped interactive authority.                                     | Use least-privilege child tokens where API supports them; stop at the documented interactive boundary instead of bypassing it.                             |
| `F14` | R2 copy token returns `401` immediately after creation or `403` persistently. | Credential propagation delay or incorrect S3 credential derivation/scope.                                                   | Retry bounded propagation; for Cloudflare S3 use token ID as access key and SHA-256 of token value as secret, scoped to the bucket, then prove and rotate. |
| `F15` | Equal R2 objects have different ETags.                                        | Multipart/provider ETags are not portable content hashes.                                                                   | Make key and size equality the hard gate; retain both ETag/checksum manifests and sample each object class.                                                |
| `F16` | Physical iPhone cannot exercise target workers.dev.                           | The native app is intentionally pinned to the production hostname.                                                          | Defer physical-device proof to the final domain cutover; prove browser/API contracts during rehearsal.                                                     |
| `F17` | CI optimization consumes time without improving delivery.                     | Package build itself is short; lint/Nuxt prepare, typecheck, and packed consumer smoke dominate.                            | Profile first; cap independent package matrix at four; stop optimization once release testing is unblocked.                                                |
| `F18` | A package release looks green but the app cannot install it.                  | Only monorepo-local tests or tags were checked.                                                                             | Require an external frozen exact-version consumer smoke and registry install proof.                                                                        |
| `F19` | Local and CI truth disagree.                                                  | Runner topology, PATH, network namespace, auth, or generated state differs.                                                 | Reproduce the canonical CI command and fix the gate; exact-head CI remains authoritative.                                                                  |
| `F20` | A rerun repeats expensive safe work after a tail-only proof failure.          | Scripts lack resumable phases.                                                                                              | Persist phase evidence and allow proof-only continuation under a new temporary token without repeating imports/copies.                                     |
| `F21` | Existing target staging is promoted as production.                            | A working staging stack is mistaken for a production foundation despite synthetic data, partial secrets, and different IDs. | Provision fresh production Worker, D1, KV, R2, rate limits, and build; use staging only as a behavioral reference.                                         |
| `F22` | CI discovers migration defects one at a time.                                 | The candidate was pushed without an authenticated clean install and full local acceptance.                                  | Treat missing package credentials as a defect; run the complete canonical sequence before push.                                                            |
| `F23` | Workers Builds API rejects a valid account token.                             | The Builds API requires a user-scoped API token; its build token is a separate trigger credential.                          | Record both credential classes; use minimum Builds Configuration edit plus Workers Scripts read for API operation.                                         |
| `F24` | A rehearsal candidate accidentally becomes production.                        | The normal deploy command activates a version before target data is imported and reconciled.                                | Upload without activation; record the prior active version and prove target production D1 stayed unchanged.                                                |
| `F25` | Public HTTPS works but the operator Mac still resolves a dead IP.             | Local DNS retained the target zone's pre-activation placeholder after public resolvers converged.                           | Prove authoritative/public resolvers; use `curl --resolve` for TLS and route proof while local cache expires.                                              |
| `F26` | Device authentication is reported as full product acceptance.                 | Operator attestation, app launch, profile mutation, and upload/retrieval were conflated.                                    | Record machine proof, operator attestation, and unproven flows separately.                                                                                 |
| `F27` | Cutover configuration remains temporary after traffic moves.                  | The trigger still targets a cutover branch/version upload or test config still names source resources.                      | Restore `main` plus canonical commands and rerun the functional source-account/cutover-reference scan.                                                     |
| `F28` | The canonical build compiles but D1 migration fails with `10000`.             | Cloudflare's automatically selected user build token can deploy Workers but does not include D1 edit.                       | Supply a separate app-scoped D1/Worker deploy token as a masked build variable, export it only for migration/deploy, and fail closed when absent.          |
| `F29` | Committing deployment evidence immediately creates a newer deployment.        | The permanent production trigger watches documentation paths, so an evidence-only merge redeploys unchanged code.           | Exclude `docs/**` while keeping application, config, lockfile, and migration paths deployable.                                                             |

## Reusable operator checklist

### Discovery

- [ ] Fresh worktree from fetched remote default branch.
- [ ] Baseline commit, production deployment, routes, resources, and health
      recorded.
- [ ] Template/layer imports, metadata, workflows, scripts, and package sources
      inventoried.
- [ ] Capabilities classified as package, app-owned, retired, deferred, or
      external.
- [ ] Secrets recorded by name and owner only.

### Packages

- [ ] Complete direct and transitive package closure identified.
- [ ] Candidate package head passes package and packed-consumer gates.
- [ ] Changesets release merged and immutable GitHub Package versions proven.
- [ ] Consumer repository granted package access.
- [ ] External builder token contract exists without a committed token.

### App

- [ ] Exact versions and lockfile regenerated from registry artifacts.
- [ ] App-owned CI, Renovate, scripts, tests, Nuxt config, and Worker config
      exist.
- [ ] Stable migration sources and evidence-based legacy adoption exist.
- [ ] `#layer` and synthetic ORM aliases are gone.
- [ ] Functional template, CLI, fleet, and Command references are zero.
- [ ] Read-only maintenance mode covers all state creation.
- [ ] Clean local gate and exact-head CI pass.

### Production proof

- [ ] Exact merged SHA deployed in the current production account first.
- [ ] D1 recovery/export, ledgers, schema, indexes, and counts reconcile.
- [ ] R2 manifest and KV inventory reconcile.
- [ ] Health, public, auth, mutation, storage, cron, and app-specific routes
      pass.
- [ ] Evidence manifest and protected raw-evidence checksums are complete.

### Optional account move

- [ ] Target production D1 remains untouched during rehearsal.
- [ ] Disposable-D1 rehearsal, double migration, R2 copy, KV classification, and
      workers.dev proof pass.
- [ ] Workers Build, build variables, zone, credentials, and Registrar readiness
      pass the go/no-go gate.
- [ ] Final cutover follows the separate account runbook.

## BSF evidence index

| Evidence                  | Reference                                                                                                                                                                                                                                                              |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Package release           | `narduk-libs` PR [#2](https://github.com/narduk-enterprises/narduk-libs/pull/2), merge `10a9f4f`; app-tools fixes/releases PRs [#9](https://github.com/narduk-enterprises/narduk-libs/pull/9) through [#12](https://github.com/narduk-enterprises/narduk-libs/pull/12) |
| App decoupling            | BSF PR [#62](https://github.com/narduk-enterprises/been-sober-for/pull/62), accepted head `ae35e2f`, merge `e949bd9`                                                                                                                                                   |
| Exact-head CI             | [run 29443355862](https://github.com/narduk-enterprises/been-sober-for/actions/runs/29443355862)                                                                                                                                                                       |
| Merged-main CI            | [run 29443848957](https://github.com/narduk-enterprises/been-sober-for/actions/runs/29443848957)                                                                                                                                                                       |
| Source deployment record  | BSF PR [#64](https://github.com/narduk-enterprises/been-sober-for/pull/64), merge `62636a5`                                                                                                                                                                            |
| Target rehearsal record   | BSF PR [#65](https://github.com/narduk-enterprises/been-sober-for/pull/65), merge `d6192f2`                                                                                                                                                                            |
| Runner PATH fix           | BSF PR [#66](https://github.com/narduk-enterprises/been-sober-for/pull/66), merge `3c8459a`                                                                                                                                                                            |
| Runner port isolation     | BSF PR [#67](https://github.com/narduk-enterprises/been-sober-for/pull/67), merge `2404f4e`                                                                                                                                                                            |
| CI package parallelism    | `narduk-libs` PR [#8](https://github.com/narduk-enterprises/narduk-libs/pull/8), merge `f28c73f`, maximum parallelism four                                                                                                                                             |
| Cloudflare procedure      | [`../cloudflare-account-cutover.md`](../cloudflare-account-cutover.md)                                                                                                                                                                                                 |
| BSF live execution record | `been-sober-for/docs/operations/cloudflare-account-cutover.md`                                                                                                                                                                                                         |
| Final traffic cutover     | BSF PR [#70](https://github.com/narduk-enterprises/been-sober-for/pull/70), final execution record and machine-readable schema-v2 evidence                                                                                                                             |
| Workers Build D1 repair   | BSF PR [#71](https://github.com/narduk-enterprises/been-sober-for/pull/71); failed build `d183d2fc-cabb-4d47-b577-52b69b701f1d` stopped before migration authenticated; repaired build `ee9689c3-2a5d-4951-b085-d1b473d797d6` deployed `b2e462c` successfully          |
| Final automation evidence | BSF PR [#72](https://github.com/narduk-enterprises/been-sober-for/pull/72), canonical Workers Build, idempotent migration, deployed version, and live-marker evidence                                                                                                  |

The JSON exemplar is the compact handoff. The BSF repository execution record
remains the authoritative live account-cutover ledger and must be updated as
pending final steps complete.
