# @narduk-enterprises/narduk-app-tools

## Social preview checks

`narduk-app og:generate` renders an app-owned default share image.
`narduk-app og:check` validates the default and route inventory; add `--live` to
verify actual server-rendered metadata and downloaded images as crawlers. New
app scaffolds wire these into builds and browser CI. Existing apps adopt them
using the [social preview guide](docs/social-previews.md).

Focused app-local tooling exposed as `narduk-app`. It operates on the current
application only: local development, prebuilt-Worker e2e serving, source-owned
D1 migrations, guarded Wrangler deployment, registry authentication,
diagnostics, performance budgets, and favicon assets.

## Local development (`narduk-app dev`)

```sh
narduk-app dev [--credentials <none|nvault>] [--project <name>] \
  [--environment <name>] [--config <name>] [--dry-run] -- <command...>
```

The command runs one child process. Without `--credentials` it runs that child
directly, so an app whose local development needs no secrets has no secret-store
dependency at all. The child defaults to `nuxt dev`.

`--credentials nvault` is the registered local credential route. It requires a
complete selector and runs
`nvault run -p <project> -e <environment> -c <config> -- <command>`, so values
stay process-local for that one run and are never written to a file (company-hq
[`docs/SECRETS-MATRIX.md`](https://github.com/narduk-enterprises/company-hq/blob/main/docs/SECRETS-MATRIX.md),
plane 4 "Local workstation overlay"). A partial selector is refused by name
rather than resolved to some nearby scope. `--dry-run` prints the exact command
without running it.

### Migrating off the retired Doppler wrapper

Before 0.4.0 this command always ran its child through `doppler run`, and
`--project` / `--config` selected a Doppler project and config — an implicit
dependency on the retired app-secret store (narduk-libs#321). That route is
gone: the old invocation now fails with the migration message below rather than
silently starting a dev server without the environment it used to receive.

| Before                                                    | After                                                                                                          |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `narduk-app dev --project <app> --config dev -- nuxt dev` | no secrets needed: `nuxt dev` (or `narduk-app dev -- nuxt dev`)                                                |
| `narduk-app dev --project <app> --config dev -- nuxt dev` | secrets needed: `narduk-app dev --credentials nvault --project <p> --environment <e> --config <c> -- nuxt dev` |

Choosing the second form needs a real nvault project, environment and config for
the app; adopt them with the `adopt-nvault` workflow rather than guessing a
selector. Doppler `ne/*` root provisioners remain a separately approved
provider-root exception and are **not** an application development credential
source.

For incident patches from a workstation, use `narduk-app deploy-hotfix` and the
[local break-glass runbook](docs/local-hotfix.md). It uses injected recovery
credentials, a clean commit snapshot, required local checks, version promotion
and live proof. Legacy `deploy-local` retains its historical Doppler/migration
behavior for compatibility; it is not the new hotfix procedure.

For an app still being built, an owner can enroll it in **development mode**:
one approved workstation deploys its checkout, uncommitted edits included, with
`narduk-app development deploy` (`pnpm run deploy:dev`), while push/merge
automation and Workers Builds triggers are held and later restored exactly. Each
deploy also reconciles the Worker's script-level crons and routes from the
artifact; version promotion does not. Full validation runs on request and on
exit. Nothing enrolls automatically. See the
[development mode runbook](docs/development-mode.md).

## Prebuilt-Worker e2e (`narduk-app e2e-serve`)

```sh
narduk-app e2e-serve <port> [--entrypoint <file>] [--config <file>] \
  [--assets <dir>] [--cwd <dir>]
```

Serves an already-built Worker for Playwright when the shared `nuxt-cloudflare`
callable sets `E2E_PREBUILT_ARTIFACT=1`. Defaults match the narduk-app layout
(`apps/web/.output/server/index.mjs` and `wrangler.jsonc` / `wrangler.json` from
the app directory or repository root). Flags override those paths; nothing
app-specific is baked in.

The command will not compile a fallback. A missing artifact fails immediately.
It binds `127.0.0.1` only (`E2E_HOST` must be that address or unset). Startup
notes go to stderr as `[e2e-serve] cwd=…` / `ready on …` because Playwright
forwards only a webServer's stderr — without them a stalled start looks like a
hung poll.

`wrangler` is the app's dependency (optional peer here). It is resolved from the
app cwd and, if needed, `apps/web`. Missing wrangler fails with one line:

`wrangler is not installed in this app. Add it as a dependency and retry.`

Real worker errors pass through. The only filtered stderr is workerd's
client-abort block
(`kj::getCaughtExceptionAsKj() … disconnected: ::write(…): Broken pipe` or
`Connection reset by peer`, plus the following `stack: …workerd@…` line). A
following `ECONNREFUSED` is the real crash
([cloudflare/workers-sdk#15202](https://github.com/cloudflare/workers-sdk/issues/15202)).
See [the e2e-serve guide](docs/e2e-serve.md).

## Migration config

`narduk-app db migrate` accepts a JSON config with explicit source names and
versions. Paths are relative to the config file:

```json
{
  "schemaVersion": 1,
  "sources": [
    {
      "id": "@narduk-enterprises/narduk-core",
      "dir": "node_modules/@narduk-enterprises/narduk-core/runtime/drizzle"
    },
    {
      "id": "@narduk-enterprises/narduk-auth",
      "dir": "node_modules/@narduk-enterprises/narduk-auth/drizzle"
    },
    {
      "id": "app",
      "dir": "drizzle"
    }
  ],
  "adoptions": []
}
```

Package sources are applied before `app`. The ledger uses `(source, filename)`
as its primary key and stores the SHA-256 SQL checksum. When the canonical
manifest omits a source version, the command resolves it from the owning
package's `package.json` (including the app package) before planning; it never
writes `unversioned` to a ledger. Existing ambiguous rows are refused unless an
adoption entry names the exact target checksum and proves the expected schema
tables, columns, and indexes. A migration and its ledger row are submitted in
the same D1 batch so a failed statement rolls back the batch.

Before any remote mutation, the command fails closed unless it can capture a D1
Time Travel bookmark, current migration ledgers, and `sqlite_master` metadata.
The mode-`0600` recovery artifact is written under `.narduk/recovery/d1/` and
its path is printed by the CLI. Remote reset is never supported; corrective
database changes are forward-only.

Only numbered migration files such as `0000_initial_schema.sql` or `0001.sql`
are discovered. Utility SQL such as `seed.sql` is deliberately excluded and is
never executed against local or remote application databases by this command.

App Worker configuration may use `wrangler.jsonc` (preferred) or legacy
`wrangler.json`. All Wrangler calls run through the app's pinned dependency via
`pnpm exec wrangler`. Dry runs are allowed without credentials or the local
deployment override. Production and preview deploys are allowed in Cloudflare
Workers Builds only when its injected `CI`, `WORKERS_CI`, build UUID, commit
SHA, and branch variables form a complete attestation. A real local deploy
requires the explicit `NARDUK_ALLOW_LOCAL_WRANGLER_DEPLOY=1` recovery opt-in;
unrelated environment flags never bypass that guard. A package-manager
passthrough separator is normalized before invoking Wrangler so it cannot
neutralize `--dry-run`.

Generated Workers Builds scripts pass `--workers-build-only` to the remote
migration command. That attestation is checked before D1 recovery capture or
mutation, so invoking the production script locally cannot migrate a remote
database and then fail only at the deploy step.

The command never writes secret files. Registry auth writes the requested
`.npmrc.auth` path and scopes GitHub Packages to both `@narduk-enterprises` and
`@narduk-geo`.

`narduk-app assets favicons` creates ordinary browser favicon files only. It
does not create a web manifest, service worker, install UI, or PWA icon set.

## Automatic D1 migration gate

The narduk-v1 production and shared-preview workflow integration, D1-only
persona, read-only drift checks, database locks, expand/contract review and
recovery steps are in [D1 deployment migrations](docs/deployment-migrations.md).

`db migrate-deployment --target production --sha <verified-sha>` migrates before
promotion; `--check` is read-only and fails on pending or divergent history.
`db bundle --output <file>` packages SQL/data for trusted preview tooling
without giving D1 credentials to PR code. Existing apps must adopt the workflow
steps; installing the package alone does not activate migration writes.

An app whose D1 estate is mixed -- some databases migrated, one whose schema is
owned by a contract and a refresh job -- declares `deployment.databaseOwnership`
instead of manufacturing a migration baseline for the database nobody migrates.
Every binding gets exactly one owner, and the migration runner refuses a
contract-owned database even when an operator names it directly. See
[Declare who owns each schema](docs/deployment-migrations.md#declare-who-owns-each-schema-databaseownership).

## Promotion, rollback and live proof

The Narduk deployment standard is **Cloudflare builds, GitHub promotes**:
Workers Builds runs `wrangler versions upload` on every branch, so a push
produces a version that serves no traffic, and a GitHub Actions job deploys that
exact version at 100% only once the gate check is green on that exact main SHA
(company-hq#745, deployment-standard design §1.5).

An app whose Workers Build still deploys directly has no promote run to turn red
when a build fails; it adds the
[post-merge deploy assertion](docs/deploy-assertion.md) (narduk-libs#597).

### How a commit is linked to a version

A Worker version carries **no commit field**. Read live on 2026-09-17 against
the deployed `buoys` Worker, `wrangler versions list --name buoys --json`
returns only `metadata.{created_on,source,author_id,author_email,has_preview}`
and `annotations.{workers/alias,workers/triggered_by}` — and Cloudflare's
Versions API reference documents no annotation fields at all.

So the link is **made, not discovered**. `wrangler versions upload --tag <sha>`
writes `annotations["workers/tag"]`, the only commit-shaped handle a version can
hold, and `narduk-app deploy versions-upload` now sets it automatically from
`WORKERS_CI_COMMIT_SHA` when it runs inside a Workers Build. A caller-supplied
`--tag` is always left alone.

> **Window:** `wrangler versions list` returns the 10 most recent versions and
> takes no paging flag. On a repository with many branch builds a main version
> can fall out of that window before the promote job runs; that is reported as
> `version-not-found` with the number of versions searched, not as a generic
> failure. Promote by `--version-id` to recover.

### `narduk-app deploy versions-promote`

```sh
narduk-app deploy versions-promote [--sha <commit> | --version-id <id>] \
  [--name <worker>] [--account-id <id>] [--production-branch <name>] \
  [--any-branch] [--force] [--percentage <1-100>] [--message <text>] \
  [--max-versions <n>] [--wait-for-version <seconds>] \
  [--wait-interval <seconds>] [--gate-verified "<check>@<sha>"] \
  [--dry-run] [--json]
```

Resolves the version whose `workers/tag` matches the commit (prefix-compared in
both directions, because 7-, 12- and 40-character spellings of one SHA all
occur) and deploys it at 100%. The Worker name and account id default to the
committed Wrangler config.

**The lookup is bounded, not capped at ten.** `wrangler versions list` prints
"the 10 most recent Versions of your Worker" and takes no paging flag, so with
non-production branch builds on, ten branch uploads landing between a merge
build and its promote job used to bury the version and leave production
un-updated. The lookup now walks Cloudflare's Versions endpoint with
`per_page`/`page` up to `--max-versions` (default 500) and never paginates
unbounded. That path needs an account id and `CLOUDFLARE_API_TOKEN`; without
both it falls back to `wrangler versions list` and says
`versionSearch.source: "wrangler"` in the result, because a miss in ten means
something different from a miss in five hundred.

**A promote that promotes nothing is exit 3, never 0.** The `version-not-found`
detail names the SHA, how many versions were read, the bound, and whether the
search reached the end of the Worker's history (no build ever uploaded this
commit) or stopped at the bound (raise `--max-versions`, or use `--version-id`).
Wire the step so that exit is a **red** job, never a skip.

**The build and the promote are not ordered.** Under narduk-v1 the Workers Build
uploads the version, while `workflow_run` on the gate starts the promote, and
nothing sequences the two. When the build finishes after CI, an unbroken merge
exits 3 and production stays on the previous release: Buoys hit this on
2026-09-22 with a 51-second gap (narduk-libs#695).
`--wait-for-version <seconds>` (0..3600, default 0 = look once) re-lists every
`--wait-interval` seconds (default 30) while the SHA is simply absent, and
promotes as soon as it appears. Only absence waits. An ambiguous match, a branch
refusal or an ordering refusal is about the commit, not about timing, so each
still answers on the first listing. On expiry the exit is still 3, and the
detail adds how long it waited and how many listings it read.

**`--sha` under `workflow_run`.** It defaults to `GITHUB_SHA` on every event but
one. Under `on: workflow_run`, `GITHUB_SHA` is the default branch's head at
trigger time rather than the commit whose run completed, so the command
**refuses** to default there (exit 2) instead of promoting a commit the gate
check never passed. Pass the triggering commit explicitly:

```yaml
env:
  VERIFIED_SHA: ${{ github.event.workflow_run.head_sha }}
steps:
  - run:
      narduk-app deploy versions-promote --sha "$VERIFIED_SHA" --gate-verified
      "ci / Required@$VERIFIED_SHA" --production-branch main --json
  - run:
      narduk-app verify --live https://<hostname> --expect-sha "$VERIFIED_SHA"
```

**`--gate-verified <check>@<sha>` binds the gate result to the commit.** The
command proves its execution context but cannot read whether `ci / Required` is
green on the commit it promotes: narduk-app-tools is deliberately never given a
GitHub token. Of the three options in narduk-libs#400 — (1) rely on the
workflow's step ordering alone, (2) have the workflow pass what it observed as
an explicit attestation, (3) read the check conclusion with `GITHUB_TOKEN`,
which would put a GitHub credential in the process holding the promote
credential — **option 2 was chosen**. The workflow passes the gate check's name
and the full SHA it ran on (`workflow_run.head_sha`), and the promote refuses
with `gate-mismatch` (exit 9), before touching anything, unless

- the attested SHA is exactly the commit being promoted (`--sha`, or its
  `GITHUB_SHA` default) — a full 40-character SHA, compared in full; and
- the resolved version's `workers/tag` is that commit. A `--version-id` promote
  is bound this way only, so a version with no tag, or one outside the searched
  window, is refused rather than assumed to match.

The value is split on its **last** `@`, so a check name may contain spaces,
slashes and even `@`; control characters are refused because the name is logged.
On success the promote logs the check and SHA it was given, and the result
carries them as `gateVerified`. This is still an attestation, not a
verification: it does not catch a workflow that lies, but it does catch one that
promotes a different commit from the one its gate ran on, and it leaves the
claim in the log. Keep the promote job conditioned on the `workflow_run`
conclusion being `success`.

The flag is optional so that existing app-owned promote workflows keep working.
Without it the promote behaves as before and prints a warning (stderr, so
`--json` stays parseable) that no gate attestation was passed, and the result
carries `gateVerified: null`. `promote.yml` is app-owned — the generator only
documents it — so each app adds the flag to its own workflow; the generated
`docs/workers-builds.md` and `docs/deployment/promote-d1.steps.yml` templates
already pass it.

It carries **its own** GitHub Actions guard, not `deploy`'s Workers Builds one:
reusing that would force every promotion through
`NARDUK_ALLOW_LOCAL_WRANGLER_DEPLOY=1` and so license local production deploys
estate-wide. Its own override is `NARDUK_ALLOW_MANUAL_PROMOTE=1`, for deliberate
recovery work.

#### Three refusals that exist because the happy path is not the dangerous one

**An older commit may not roll production backwards.** Two PRs merge forty
seconds apart; B's promote deploys its version at 100%, and A's promote — still
running — resolves its own SHA to the older version and deploys _that_ at 100%.
Without a guard the result is `promoted`, exit 0, and A's own live proof passes,
because the older version really does serve the SHA A expects. So the promote
compares the target against the version already serving production (Cloudflare's
own sequential `number`, or `metadata.created_on` when a payload carries no
number) and refuses with `stale-promote` (exit 7). When neither field can order
the pair it refuses too: "we cannot tell" is not "it is fine". `--force` is the
deliberate revert-by-promote, and it is logged loudly in both the summary and
the JSON (`forced: true`).

**A non-production branch build may not be promoted.** A feature branch's
Workers Build of a commit carries the same `workers/tag` as main's build of that
commit, so if main's build failed the branch build is the single match. Pass
`--production-branch <name>` (or set `NARDUK_PROMOTE_PRODUCTION_BRANCH`) and the
promote reads the branch out of `workers/message` — the annotation
`versions-upload` writes — and refuses with `branch-mismatch` (exit 8) unless it
names that branch. A version that records **no** branch is refused as well:
unreadable provenance is not production provenance. `--any-branch` overrides.

**The run's own ref and event are checked.** With `--production-branch`, the
promote requires `GITHUB_REF_NAME` to equal it, and it refuses any event outside
`push`, `workflow_run`, `workflow_dispatch`, `repository_dispatch`, `schedule`
and `release` — a workflow holding the promote credential must not be reachable
from a `pull_request` run.

| Exit | Outcome                                                         |
| ---- | --------------------------------------------------------------- |
| 0    | `promoted`, `already-live` (idempotent no-op) or `dry-run`      |
| 1    | `guard-refused` — context, ref or event. **Nothing attempted.** |
| 2    | usage error. **Nothing attempted.**                             |
| 3    | `version-not-found` inside the searched window                  |
| 4    | `ambiguous-version` — more than one version carries the tag     |
| 5    | `wrangler-failed` — see `trafficMayHaveChanged`                 |
| 7    | `stale-promote` — the target is older than the live version     |
| 8    | `branch-mismatch` — not a production-branch build               |
| 9    | `gate-mismatch` — `--gate-verified` names another commit        |

The 1/2-versus-5 split is the one a promote job branches on. 1 and 2 mean
production is untouched; 5 means wrangler died, and `trafficMayHaveChanged` says
whether it died during a read (nothing changed) or during a `versions deploy`
(the live version is unknown — read `wrangler deployments list` before deciding
whether to roll back). Every code in this table is reachable, and a test asserts
so.

The machine-readable result names `previousVersionId`: **feed it to
`rollback --to`.** Resolving "the previous version" from history is only correct
once — after a rollback the newest earlier version is the broken one you just
left, so an unnamed second rollback would roll _forward_.

### `narduk-app deploy rollback`

```sh
narduk-app deploy rollback [--to <version-id>] [--name <worker>] \
  [--account-id <id>] [--message <text>] [--dry-run] [--json]
```

Same guard. Refuses (exit 6) when the target already serves 100%, when there is
no earlier deployed version, when the live deployment is itself a rollback and
no `--to` was given — and when the live deployment carries **no annotations at
all**, because "we cannot see that it was a rollback" is not "it was not one",
and reading it as the latter is exactly what rolls forward into the broken
version. Exit 5 with `trafficMayHaveChanged: true` when wrangler fails during
the rollback itself.

### `narduk-app verify --live`

```sh
narduk-app verify --live <url> [--expect-sha <sha>] [--health-path <p>] \
  [--smoke-path <p>] [--expect-content-type <t>] [--attempts <n>] \
  [--interval-seconds <n>] [--allow-degraded] [--no-cache-bust] \
  [--access-client-id-env <NAME> --access-client-secret-env <NAME>] [--json [path]]
```

Three assertions against a running deployment, so the preview gate, the promote
job's post-deploy proof and a human debugging an incident all run one code path
(design §6.2):

1. `x-build-version` is the expected commit (prefix compare; narduk-core
   publishes 12 characters).
2. `/api/health` is healthy per the narduk-core health contract —
   `{ success, data: { status, checks } }`, with every `required: true` check
   passing.
3. One app-declared smoke route answers 2xx with the expected content type.

The build-version and smoke assertions share one request. Defaults match design
§2.1 `liveProof`: `/api/health`, `/`, 6 attempts, 10 s apart, 15 s timeout.
Retries cover the whole pass, because a promotion has to propagate and a cold
isolate is roughly 10× slower than a warm one.

`degraded` fails by default. Design §6.2 asks for both `data.status == "ok"` and
"every required check passing", and those two disagree exactly in the degraded
case; this command takes the literal reading, and `--allow-degraded` takes the
other. The status is recorded verbatim either way. `--allow-degraded` never
excuses a failing **required** check — and never excuses a broken database:
narduk-core reports a missing D1 binding as `required: false` on an app that
never declared `databaseBackend`, so a release whose `DB` binding was dropped
summarises to `degraded`. A `database` of `not_available`, `schema_error` or
`error` fails the proof whatever the flag says.

#### Behind Cloudflare Access

A host whose every path, `/api/health` included, sits behind Cloudflare Access
answers 401 before the Worker runs, so the proof would never see the build. Name
the environment variables that hold an Access service token and every probe
carries `CF-Access-Client-Id` / `CF-Access-Client-Secret`:

```sh
CF_ACCESS_CLIENT_ID=... CF_ACCESS_CLIENT_SECRET=... \
  narduk-app verify --live https://ops.example.com --expect-sha "$VERIFIED_SHA" \
  --access-client-id-env CF_ACCESS_CLIENT_ID --access-client-secret-env CF_ACCESS_CLIENT_SECRET
```

The flags take variable NAMES, never values, so a secret stays off argv; both
halves are required together; an unset or empty variable fails the run before
any request, naming the variable and not its value. Neither value appears in the
report or the JSON. This proves the right build is live to a holder of the
token; that anonymous visitors are still refused is a separate proof.

#### What this proves, and what it does not

It proves that, at this moment, a request **this process made** to the origin of
`--base-url` was answered by a deployment reporting the expected build, a
healthy `/api/health`, and a 2xx smoke route.

It does not prove that a cached copy of the previous release is gone from every
edge. Because design §6.5 tells apps to turn Cloudflare's cache on, an
uncontrolled `GET /` can be answered from cache by the **previous** release for
the whole proof window — and under this standard the proof is the auto-rollback
trigger, so that is a good release rolled back. Every request therefore sends
`cache-control: no-cache, no-store, max-age=0`, `pragma: no-cache` and fetches
with `cache: 'no-store'`, and each attempt appends its own
`_nardukProof=<token>` query parameter so no intermediary can already hold a
copy of that URL. `--no-cache-bust` drops the query parameter for an app that
rejects unknown query strings; the request headers stay.

It does not prove anything about a **different origin**. Redirects are followed,
because an apex that 308s to `www` is ordinary — but a final origin other than
`--base-url`'s is refused with exit 6. Design §2.3's named hazard is two Workers
in two accounts answering one hostname, and a proof that reads the other one's
headers is a proof of the wrong deployment.

It does not prove that every route works, that the release is correct, or that
Cloudflare's configuration matches what the repository declares (that is
`foundation:check:deployment` tier 1 and `doctor --cloudflare` tier 2).

| Exit | Failure class                                      |
| ---- | -------------------------------------------------- |
| 0    | every assertion passed                             |
| 1    | usage error                                        |
| 2    | the deployment could not be read at all            |
| 3    | `x-build-version` mismatch after the bounded retry |
| 4    | `/api/health` not healthy                          |
| 5    | smoke route wrong status or content type           |
| 6    | a redirect left the origin under proof             |
| 7    | an edge-cache assertion failed (see below)         |

#### Edge cache proof (`--edge-cache-path`, `--edge-uncached-path`)

`setCacheProfile` headers are inert until Workers Cache is on, and a repository
read (12.7) cannot tell whether Cloudflare actually stores a route
(narduk-libs#435). Both flags repeat, and each named route is fetched **twice**
from the same URL, without the no-cache request headers the other assertions
send, so the requests look like a visitor's. With the cache buster on (the
default) that URL is new for each attempt, so the first GET cannot already be
warm and a HIT on the second is this run's own store, not a previous release's.

- `--edge-cache-path <p>` (a `live` / `slow` / `static` route): the second
  response's `Cf-Cache-Status` must be `HIT` (or `STALE`, `UPDATING`,
  `REVALIDATED`, which are stored responses too). No `Cf-Cache-Status` at all
  means Workers Cache is not on. A `private` / `no-store` answer is `unknown`
  ("cannot prove a HIT here"): that is what a preview-safe `*.workers.dev` or
  preview hostname serves, so run the edge proof against the production
  hostname.
- `--edge-uncached-path <p>` (a `none` route, an SSR page on a nonce-CSP app, a
  preference-shaped response, a route that 404s): neither response may come from
  the cache.

```sh
narduk-app verify --live https://buoystat.us --no-health --no-smoke \
  --edge-cache-path /api/stations --edge-uncached-path /
```

## Rate-limit namespace ids (`narduk-app doctor`)

Cloudflare's `ratelimits[].namespace_id` is unique per **account**, not per
Worker: two bindings with one id share counters across every Worker on the
account, and one id reused by two environments couples preview to production.
`narduk-app doctor` reads the app's wrangler config, top level and every
`env.*`, and fails:

- a scaffold id pasted from an example (`1001`, `50110`, `50121`, `50300`);
- an id declared more than once;
- a binding with no `namespace_id`.

It does not require a particular scheme, so an app already on its own unique ids
(Buoys' `2869300` / `2869120`) passes. New ids should come from narduk-core's
`rateLimitNamespaceId(workerName, limit)`. `create-narduk-app` writes each new
app's prefix into its `wrangler.jsonc` beside a commented example binding
(narduk-libs#433).

## The deployment standard block

An app declares its half of the standard in the `deployment` block of
`Config/cloudflare-app.json`.
`narduk-app foundation:check:deployment [--checkout <dir>] [--strict] [--json [path]]`
checks it (item 12, `deployment-standard-conformance`). Like items 8-11 it
writes its own one-item artefact
(`tool: '@narduk-enterprises/narduk-app-tools/deployment-standard'`) rather than
entering `foundation-check.json`, which is the ratified 7-item contract.

```jsonc
"deployment": {
  "standard": "narduk-v1",
  "builder": "workers-builds",
  "productionBranch": "main",
  "productionDeployCommand": "narduk-app deploy versions-upload",
  "nonProductionDeployCommand": "narduk-app deploy versions-upload",
  "nonProductionBranchBuilds": false,
  "promotion": {
    "mode": "auto-on-green",
    "gateCheck": "ci / Required",
    "credential": "cloudflare/prd/narduk-enterprises-<app>-promote"
  },
  "liveProof": {
    "buildVersionHeader": "x-build-version",
    "healthPath": "/api/health",
    "smokePath": "/",
    "attempts": 6,
    "intervalSeconds": 10
  },
  "rollback": { "mode": "manual", "alert": "resend" },
  "staging": { "enabled": false },
  "previewBindings": { "d1": [], "kv": [], "r2": [] }
}
```

`liveProof.healthAuth` is `"anonymous"` (the default) or `"authenticated"`.
Declare `"authenticated"` when `healthPath` sits behind the app's auth and
refuses an anonymous request: the path stays required, because the route exists,
but `deploy hotfix` and `development deploy` pass `--no-health` instead of
asserting it, item 12.3 says so in its detail, and `doctor --adoption --live`
reports requirement 12 as unknown, with the reason, rather than failing on the
401 the app is right to send (#585). An app whose promote workflow passes
`--no-health` should declare it here, so the manifest and the workflow agree.

`staging.enabled` defaults to `false` and `previewBindings` to all-empty, so a
block that omits them still validates. `previewChecks` is accepted and optional
(the shared workflow's `preview-checks` input). A `standard` other than
`narduk-v1` means the app is deliberately exempt: it is reported as
`not-applicable`, never as twenty violations of a contract it never claimed.

#### An enabled staging stage

Staging is one flag that inserts a stage, never a fork. Switching it on means
naming the whole stage, because a staging Worker with no name, no hostname to
prove against and no stated gate is not a stage:

```jsonc
"staging": {
  "enabled": true,
  "workerName": "operator-portal-staging",
  "hostname": "staging.ops.example.com",
  "approval": "environment",        // or "auto-after-proof"
  "environment": "production",      // required by "environment": the GitHub
                                    // Environment carrying required_reviewers
  "bindings": { "d1": [], "kv": [], "r2": [] }
}
```

Staging is a **separate Worker name**, never a wrangler `env.staging` block --
`narduk-app deploy` retires those environments outright. Configuration left
behind on a disabled stage is rejected rather than ignored, because it reads as
a live staging setup and is not one.

#### `accountId`, and what 12.5 can and cannot decide

`"accountId": "<32 hex>"` is optional and names the Cloudflare account this app
deploys to. When it is present, **every** wrangler config in the checkout -- the
app's own and every second Worker beside it, `.toml` included -- must name that
account or the check fails. When it is absent, 12.5 degrades to internal
consistency only (all configs agree with each other) and says so in its own
verdict, because a repository read has no way to know which account is the right
one. Declaring it is what turns "these agree" into "these are correct".

**Rollout mode is the default, and it is the point.** An app with no
`deployment` block reports `NOT ADOPTED` and exits **0**, so publishing this
command turns no app's CI red; adoption happens app by app. `--strict` makes a
missing block a failure, and is what CI passes once the estate has adopted.

| Exit | Meaning                                                                                                    |
| ---- | ---------------------------------------------------------------------------------------------------------- |
| 0    | conformant, exempt, or not yet adopted (rollout mode)                                                      |
| 1    | claims `narduk-v1` and does not satisfy it, or the preview-binding rule fired, or `--strict` with no block |
| 2    | the block is valid but something it depends on could not be read                                           |

**The rule that fails even in rollout mode.** A Worker version captures its
binding _configuration_ but not the state behind it, and `preview_database_id`,
`preview_id` and `preview_bucket_name` apply to `wrangler dev` only -- they do
nothing for a Workers Builds preview. So an app that sets
`nonProductionBranchBuilds: true` while its wrangler config binds production D1,
KV or R2 would read and write production data from every pull request branch.
The check refuses that combination unless `previewBindings` names a replacement
for each of those bindings.

**Naming the preview resource is what isolates a preview** (narduk-libs#473,
design §3.3 option A). The design and its limits are in
[docs/preview-isolation.md](docs/preview-isolation.md). Give each entry the
preview resource's id, using wrangler's own field names:

```jsonc
"previewBindings": {
  "d1": [{ "binding": "DB", "database_id": "<preview uuid>", "database_name": "app-preview" }],
  "kv": [{ "binding": "KV", "id": "<preview namespace id>" }],
  "r2": [{ "binding": "UPLOADS", "bucket_name": "app-uploads-preview" }]
}
```

`narduk-app deploy versions-upload` then checks `WORKERS_CI_BRANCH`. On any
branch other than `productionBranch`, it writes `.wrangler.deploy.preview.json`,
with every D1, KV and R2 binding rebound, and uploads with that file. The
production branch, `deploy`, a run outside Workers Builds, an explicit `--env`
target and an app without a valid `narduk-v1` block keep
`.wrangler.deploy.production.json`, as before.

The rebinding is all or nothing. If any binding lacks its preview resource, or
names a production one, the build keeps the production config and prints a
`WARNING` naming the binding. A half-rebound preview would read preview data and
write production caches under the same keys.

12.4 runs the same planner against the app's own config, so its verdict
describes the config a branch build would upload:

| `previewBindings` against the wrangler config                                        | 12.4                                 |
| ------------------------------------------------------------------------------------ | ------------------------------------ |
| every binding rebound to a resource that is not a production one                     | `pass`                               |
| a production binding with no entry                                                   | `fail`                               |
| an entry naming no binding of its kind (a typo or a removed binding)                 | `fail`                               |
| a preview id, name or bucket that is a production one, in any scope                  | `fail`                               |
| an entry that is a bare name, or a D1 entry missing its id or name                   | `unknown` ("declared, not enforced") |
| bindings in a TOML config, or in a second Worker's config the build does not rewrite | `unknown`                            |

The artefact's `previewConfig` records the plan, and the printed summary shows
it on its `preview` line. A repository read still cannot prove the preview
resources exist on Cloudflare, or that the Workers Builds non-production command
really runs `narduk-app deploy versions-upload`. Those are the tier-2 live read.

**Every wrangler config counts, not just the app's own.** A repo with a second
Worker under `services/*` or beside the app is the exact shape the two committed
personal-account Workers in the estate have. The binding scan and the account
check read all of them -- JSON, JSONC and TOML -- so a second Worker cannot
carry a production D1 binding or a foreign account past the gate by living
outside the path `findWranglerConfig` resolves.

**The app and its wrangler config must agree about exposure.** `workers_dev` and
`preview_urls` decide whether a Worker is reachable outside its own custom
domain. Check 12.6 compares `worker.workersDev` / `worker.previewUrls` in
`Config/cloudflare-app.json` against what the wrangler config actually sets, in
every environment scope -- **including by silence**, since Cloudflare defaults
both to `true`. An app that records `workersDev: false` and never says so in
wrangler ships a live `*.workers.dev` hostname it believes it does not have.
Wrangler reads the config, not the declaration.

**Workers Cache only on a core that keeps errors out of it.** Check 12.7
(narduk-libs#435) looks for `"cache": { "enabled": true }` in every wrangler
config and scope (JSON, JSONC, TOML `[cache]` / `[env.<name>.cache]`). With the
switch off it is `not-applicable`: `setCacheProfile`'s edge headers are inert.
With it on, the app's `@narduk-enterprises/narduk-core` must be at least
**2.10.1**, the first release that pins thrown 4xx/5xx/429 (narduk-libs#429),
including those answered as JSON (#493), preference-shaped responses (#427) and
nonce-CSP SSR HTML (#435) to `private, no-store`. An older core is a `fail`
**even in rollout mode and even without a `deployment` block** -- the failure is
one visitor's response being replayed to others, not a missing declaration. A
spec that names no version (`workspace:*`, a git URL) is `unknown`. 12.7 cannot
see whether the running Worker actually HITs; `verify --live --edge-cache-path`
does. Turning the switch on in an existing app, with its preconditions, proof,
purge and rollback, is [docs/workers-cache.md](./docs/workers-cache.md).

**D1 migrations are expand-only unless reviewed.** Check 12.9 (narduk-libs#399)
reads every app-owned migration the `deployment.migrations` source manifests
name and fails any `DROP TABLE`, `DROP VIEW`, `ALTER TABLE ... DROP [COLUMN]` or
`ALTER TABLE ... RENAME` -- `narduk-app deploy rollback` restores code, never a
schema, so a Worker rolled back past a contract migration talks to a database
that no longer has what it reads. A file that drops or renames only what it
created itself (a table rebuild's scratch table) passes. A deliberate contract
migration is declared under `deployment.migrations.contractMigrations` as
`{ "path", "sha256", "reason" }`, pinned to the checksum the migration ledger
records, and the failure prints that entry for you; a waiver whose file changed,
vanished or drops nothing fails too. Package-owned sources are not read. The
classifier cannot see a data rewrite or a new constraint the old code violates.

**The declared rollback mode is the one that runs.** Nothing reads
`rollback.mode`: no tool rolls back on its own. Rollback happens only when a
person, or a step the app wrote into its own promote job, runs
`narduk-app deploy rollback`; a failed migration triggers nothing and no
database is ever restored. So the generated default is `manual`, and check 12.10
fails `"auto"`, which still parses so an older manifest does not stop the tools.

**What a green verdict does not mean.** This is a repository read with no
credential. It cannot see the deploy commands actually configured on the Workers
Builds connection, whether branch builds are enabled there, or whether a second
Worker on another account serves the same hostname. Those need the live read.
Every run prints that limitation beside its verdict, and the artefact carries it
in `limitations`.

## Web foundation conformance

`narduk-app foundation:check [--checkout <dir>] [--json [path]]` evaluates the
seven web-cf foundation items ratified by D-WEBFOUND-2 Q9 (a) (company-hq
`strategy/web-foundation-libs-plan.md#4`) against the whole checkout. Every item
resolves to `pass`, `fail`, `unknown`, or `not-applicable` -- there is no
warning tier, and `unknown` is never a pass. Exit code `0` is PASS, `1` is FAIL,
`2` is UNKNOWN (an app's own CI should treat that as a failure too). The
`--json [path]` artefact is `schemaVersion: 1`,
`tool: '@narduk-enterprises/narduk-app-tools'`, and is the exact shape
company-hq's `scripts/check-web-foundation.py` `validate_artefact()` consumes
for the weekly fleet rollup.

**`--checkout` must be an app checkout.** `foundation:check`, and its
`:shared-ui-pinned`, `:toolchain`, `:deployment` and `:coverage` variants, exit
`1` before evaluating anything when the directory has no `package.json`. From
`apps/web`, the repository root is `--checkout ../..`. `--checkout ..` is
`apps/`, and item 12 used to read that as an app with no deployment block:
`not-applicable`, exit `0` (narduk-libs#679). Apps scaffolded before the
generator fix carry `--checkout ..` in `apps/web/package.json`. Change it to
`../..`.

**Registry reads follow the project's scope route.** Sub-check 2.3 needs the
highest published `narduk-core` major. The reader takes the last
`@narduk-enterprises:registry=` line in the checkout's own `.npmrc` (the same
rule as the shared CI workflows). A route to any registry other than GitHub
Packages, in practice the `https://npm.nard.uk` mirror, is read anonymously: no
`Authorization` header and no token needed. With no such line, or a route to
`npm.pkg.github.com`, the reader uses GitHub Packages with `NODE_AUTH_TOKEN`
(then `GH_TOKEN`, then `GITHUB_TOKEN`) as a Bearer token. Only that route
corroborates an ambiguous 404 with a scope probe. Other scopes, such as
`@narduk-geo`, always stay on GitHub Packages.

The 2026-09-16 D-WEBFOUND-2 amendment retires status-app classification.
Sub-check 3.4 remains explicitly `not-applicable` to preserve artifact IDs;
product names do not require `narduk-ui` or `status-runtime`. Existing
status-runtime consumers remain supported. All actual capability checks and
exact-pin requirements continue to apply.

### Security headers (`foundation:check:security-headers`)

`narduk-app foundation:check:security-headers --base-url <url> [--path <p>]... [--json [path]]`
-- narduk-core's `security.headers` preset
([company-hq#745](https://github.com/narduk-enterprises/company-hq/issues/745)).
The evaluator is `src/foundation/items/item-10-security-headers.ts` and matches
items 1-7 (`check()` sub-checks, no warn tier). Like items 8 and 9 it is a
separate command and JSON artefact
(`tool: '@narduk-enterprises/narduk-app-tools/security-headers'`) because
`foundation:check --json` is the exact 7-item contract company-hq
`check-web-foundation.py` validates; an `id` outside `1..7` is a rollup-red F3
ARTEFACT finding. Same exit codes (`0` PASS, `1` FAIL, `2` UNKNOWN).

**This item is the one that cannot read the repository.** Every other item
decides from the app's own files. A response header is produced by a running
server, and a checkout can describe a policy it does not serve -- a Cloudflare
Transform Rule can add or strip a header the Worker never wrote. So this is a
live probe and nothing else: **no `--base-url` means `unknown`, never `pass`.**
"We did not look" is not evidence of absence, and it is not evidence of presence
either.

Repeat `--path` to probe several routes; each gets its own `10.N.M` sub-checks,
and a single route keeps the plain `10.M` ids. Probes are sequential against one
origin, because a burst looks like an attack to a WAF.

**With no `--path`, the probe reads `--base-url` exactly as given** -- a
`--base-url https://app.example/login` probes `/login`, not `/`. It used to
resolve `/` against the base URL, which silently discarded the path the caller
asked for; on an authenticated app that root is the one route that refuses the
request, so the check reported the headers of a route nobody asked about
([#632](https://github.com/narduk-enterprises/narduk-libs/issues/632)). An
explicit `--path` still resolves against the origin, so `/map` means the same
route whatever path the base URL carried.

`doctor --adoption --live` reaches the same evaluator, and defaults its probe to
the app's declared `deployment.liveProof.smokePath` rather than to `/`, for the
same reason. It reads `liveProof.healthPath` and `liveProof.buildVersionHeader`
too -- the fields `foundation:check:deployment` item 12.3 already requires -- so
requirements 5, 8 and 12 are decided against the routes the app says it serves.
With `liveProof.healthAuth: "authenticated"` it does not fetch `healthPath`
anonymously at all: requirement 12 is reported unknown, with that reason, rather
than failed on the 401 the app is right to send (#585). The hard-coded `/`,
`/api/health` and `x-build-version` remain the fallback for an app that declares
no `liveProof` block.

What it decides, per route:

| Sub-check                                            | Proven when                                                                                                                                                                                                        |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `.0` base URL responds                               | the route answered at all; otherwise the route is `unknown`                                                                                                                                                        |
| `.1` CSP is enforcing                                | a `Content-Security-Policy` header is served. Report-only alone is a **gap**: nothing is enforced. Both headers together is a pass and is reported as "a soak is in progress"                                      |
| `.2` enforced `script-src` uses a nonce              | the policy actually in force has a `'nonce-…'` source and no effective `'unsafe-inline'` / `'unsafe-eval'`. `'strict-dynamic'` neutralises those two, and the detail says so rather than failing on an inert token |
| `.3` `Strict-Transport-Security`                     | present with `max-age` of at least six months                                                                                                                                                                      |
| `.4` framing is restricted                           | a `frame-ancestors` directive **or** an `X-Frame-Options` header                                                                                                                                                   |
| `.5` / `.6` `Referrer-Policy` / `Permissions-Policy` | present                                                                                                                                                                                                            |
| `.7` `X-Content-Type-Options`                        | exactly `nosniff`                                                                                                                                                                                                  |

Sub-check `.2` deliberately assesses the **enforcing** policy even when a
stricter report-only one is served beside it. Reading the report-only header
would claim a strictness the browser is not applying, which is precisely the
false green a soak makes easy.

**No credential is needed.** This reads public response headers, so it can be
wired into a generated CI job after the install step has dropped the GitHub
Packages token.

### Shared UI pinned (`foundation:check:shared-ui-pinned`)

`narduk-app foundation:check:shared-ui-pinned [--checkout <dir>] [--json [path]]`
-- components-library-plan.md §2 item 6
([narduk-libs#253](https://github.com/narduk-enterprises/narduk-libs/issues/253)).
The evaluator is `src/foundation/items/item-8-shared-ui-pinned.ts` and matches
items 1-7 (`check()` sub-checks, no warn tier). It is a separate command and
JSON artefact (`tool: '@narduk-enterprises/narduk-app-tools/shared-ui-pinned'`)
because `foundation:check --json` is the exact 7-item contract company-hq
`check-web-foundation.py` validates; an `id` outside `1..7` is a rollup-red F3
ARTEFACT finding. Same exit-code convention as `foundation:check` (`0` PASS, `1`
FAIL, `2` UNKNOWN).

**Presence policy:** this command enforces exactly one rule, decided from the
app's own manifests: _if the app depends on a shared-UI package, that pin must
be exact_. It deliberately does **not** require an app to take a dependency it
does not use -- an unused shared-UI package is `not-applicable`, not a finding.
An earlier revision registry-gated presence ("narduk-charts is published,
therefore every UI app must depend on it"), which conflated _published_ with
_required_: narduk-charts is a charting library and narduk-ui is the `Ns*`
status instruments, so neither is mandatory on an app that needs neither. The
exported `PRESENCE_REQUIRED` is the one place a genuine estate-wide requirement
would be recorded; it is empty because no dated decision names a shared-UI
package as required of every UI app, and a test pins it empty so an addition
cannot land silently.

**No registry credential is needed.** Exact-pin discipline is a manifest fact,
so this item never needs a registry read to reach a verdict and a missing
`NODE_AUTH_TOKEN` can no longer turn the command into exit `2`; `unknown` now
means only "no `package.json` at a known monorepo path". `RegistryReality` is
still consulted, but only to annotate an already-decided sub-check with the
latest published version -- an unreadable registry drops the annotation and
changes no status. That is what lets the generated CI run this check after its
install step has dropped the GitHub Packages token
(`foundation:shared-ui-pinned` in the generated `quality:static` chain).

"Has UI" reuses `hasNuxtUiSurface()` -- item 1.1's `NUXT_CONFIG_CANDIDATES` plus
a pages or components directory at those same monorepo prefixes (the paths item
3 / Wave-1 already walk). A `nuxt` dependency alone does not count. API-only
apps are `not-applicable` in full.

**Rule table:**

| Sub-check       | Condition                                                                                 | Verdict                                                                           |
| --------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| 8.0             | No `package.json` readable at a known monorepo-candidate path                             | `unknown`                                                                         |
| 8.0             | No `nuxt.config.*` at a known path, or no pages/components directory at the same prefixes | `not-applicable` (whole check)                                                    |
| 8.0             | Nuxt config and a pages/components directory exist                                        | `pass`                                                                            |
| 8.1 / 8.2 / 8.3 | not a dependency of this app, and not listed in `PRESENCE_REQUIRED`                       | `not-applicable` -- capability-specific, so its absence is not a finding          |
| 8.1 / 8.2 / 8.3 | not a dependency, but listed in `PRESENCE_REQUIRED` (today: none are)                     | `fail` -- "required of every UI app and is not a dependency"                      |
| 8.1 / 8.2 / 8.3 | depended on, but the pin is a range or a `workspace:` / `file:` specifier                 | `fail`, names the package and the fix                                             |
| 8.1 / 8.2 / 8.3 | depended on and pinned to an exact version (`1.2.3` or `1.2.3-alpha.1`)                   | `pass`, annotated with the latest published version when the registry is readable |

### No local copy of a shared component (`foundation:check:no-local-copy`)

`narduk-app foundation:check:no-local-copy [--checkout <dir>] [--json [path]]`
-- item 13, components-library plan
([narduk-libs#260](https://github.com/narduk-enterprises/narduk-libs/issues/260);
numbered 13 because 9-12 were taken first). This is the repository half of the
`narduk/no-shadowed-shared-component` lint rule in
`@narduk-enterprises/eslint-config`. The evaluator is
`src/foundation/items/item-13-no-local-copy.ts`. It has its own JSON artefact
(`tool: '@narduk-enterprises/narduk-app-tools/no-local-copy'`) for the same
reason as item 8, and the same exit codes: `0` PASS, `1` FAIL, `2` UNKNOWN.

The component list is `src/foundation/shared-components.ts`. Its test fails if
it differs from the eslint-config registry, so the lint rule and this check
always name the same components. A name matches on the file name or on the name
Nuxt registers from the path (`components/ne/DataTable.vue` is `NeDataTable`).

| Sub-check    | Condition                                                                  | Verdict                                                 |
| ------------ | -------------------------------------------------------------------------- | ------------------------------------------------------- |
| 13.1 only    | no UI surface (same rule as item 8)                                        | `not-applicable` (whole check)                          |
| 13.1 to 13.5 | the owning package is a dependency, and a local component carries its name | `fail`, naming each file                                |
| 13.1 to 13.5 | the owning package is a dependency, and nothing matches                    | `pass`                                                  |
| 13.1 to 13.5 | the owning package is not a dependency                                     | `not-applicable`; any same-named files are still listed |

The sub-checks are one per owner: narduk-shell, narduk-core, narduk-auth,
narduk-ui and narduk-charts.

### List routes use the query contract (`foundation:check:list-routes`)

`narduk-app foundation:check:list-routes [--checkout <dir>] [--json [path]]` --
item 14, the same plan and issue. A server list route parses its query with
narduk-core's `parseListQuery`
([narduk-libs#257](https://github.com/narduk-enterprises/narduk-libs/issues/257)):
limit clamped, sort from an allowlist, unknown keys rejected. The evaluator is
`src/foundation/items/item-14-list-routes-use-contract.ts`. Its artefact is
`tool: '@narduk-enterprises/narduk-app-tools/list-routes-use-contract'`.

A list route is found from its source. It is a file under `server/api/` or
`server/routes/` at any monorepo prefix that answers GET (a `.get.` file or no
method suffix) and either calls `parseListQuery(`, or reads its query
(`getQuery(` / `getValidatedQuery(`) and names a pagination key: `limit`,
`offset`, `cursor`, `pageSize` or `perPage`. A key counts as an object key not
given a number literal, a string, or a property read that is not a call. So a
Drizzle `.limit(10)` or a fixed `{ limit: 1 }` alone does not make a route a
list route. It is a heuristic, and a false positive is a reason to fix the
heuristic, not to reword the route.

| Sub-check | Condition                                          | Verdict                   |
| --------- | -------------------------------------------------- | ------------------------- |
| 14.1      | no `server/api` or `server/routes` handlers        | `not-applicable`          |
| 14.1      | handlers exist, none is a list route               | `pass`                    |
| 14.1      | every list route calls `parseListQuery(`           | `pass`                    |
| 14.1      | a list route reads pagination without the contract | `fail`, naming each route |

### Shared-capability coverage (`foundation:check:coverage`)

`narduk-app foundation:check:coverage [--checkout <dir>] [--json [path]]` --
item 9, company-hq
[`docs/NARDUK-APP-COMPLIANCE.md`](https://github.com/narduk-enterprises/company-hq/blob/main/docs/NARDUK-APP-COMPLIANCE.md)
§3.9 (Logan, 2026-09-16: _"the rule is to fix the lib if there is a bug rather
than working around the issue in the app"_). Like item 8, it is a separate
command and JSON artefact
(`tool: '@narduk-enterprises/narduk-app-tools/capability-coverage'`) because
`foundation:check --json` is the exact 7-item contract company-hq
`check-web-foundation.py` validates; an `id` outside `1..7` is a rollup-red F3
ARTEFACT finding. No registry credential is needed -- every verdict comes from
the app's own manifests and its own source.

It reports two things.

**(a) Inventory.** Every `@narduk-enterprises/*` dependency the app pins, with
its version, the manifest it came from and the dependency block it sat in -- one
row per `(package, manifest, block)`, across the root manifest and the workspace
manifests at the same monorepo-candidate paths item 1 already reads. Beside it,
the catalog of shared capabilities the estate publishes, each in one of three
states. `absent` means no manifest pins the package. `adopted` means it is
pinned and the app carries no copy of its internals. `forked` means it is pinned
**and** the app carries its own copy (narduk-libs#620). A fork keeps the
dependency, so a pin-only reading would call it adopted. A capability opts in
with `forkStems`, set in the generator's `FORK_STEMS` (today only
`narduk-mapkit`: `mapkit`). An app-local file counts toward a fork when a
directory segment of its path, or its own name, equals a stem, and it imports no
package named for that stem. A `forked` row carries its files and line count.
9.1 names it and never counts it as adopted, but it is not a failure, because
some forks are deliberate and tracked. **The catalog is derived, never
hand-typed**: `scripts/generate-capability-catalog.mjs` reads narduk-libs'
`pnpm-workspace.yaml` (the four families, D-WEBFOUND-2 Q2 (a)) and writes
`src/foundation/capability-catalog.ts`; `--check` fails when the committed file
falls out of step with the workspace, and `pnpm run scripts:test` runs that
comparison in required CI. Private workspace packages are excluded because an
app cannot depend on one. The whole inventory is a first-class `inventory` block
in the `--json` artefact, so the estate roster reads it as data rather than
parsing sub-check prose.

**(b) Reimplementation detection.** App-local code doing a shared package's job.
Every detector is a source signal plus one question -- _is the owning shared
package a dependency of this app?_

- **Yes → `confirmed`**, reported as a **FAIL** naming the exact file path and
  the owning package. The package is installed and the app wrote its own anyway;
  that is the §3.9 duplication finding.
- **No → `heuristic`**, reported as a **WARN**. There is app-local code doing a
  shared package's job, but nothing proves it is a fork rather than something
  the app genuinely owns.

There is no fifth status. A WARN carries the foundation vocabulary's `unknown`
(exit `2`) with `confidence: 'heuristic'` in the artefact, because "we found
code doing a shared package's job but cannot prove it is a fork" is exactly what
`unknown` already means here -- never a pass, never a decided failure. The four
verdicts read as _proven_ (`pass`), _gap_ (`fail`), _unknown_, and
_not-applicable_.

Only tracked-source directories at the usual monorepo prefixes are walked
(`app/`, `src/`, `server/`, `shared/`, `composables/`, `utils/`, `plugins/`,
`components/`, `layers/`, `scripts/`), bounded at 2000 files. `AppRepo.walk()`
skips `node_modules`, `.git`, `dist`, `.output`, `.nuxt`, `.nitro`, `.wrangler`,
`.turbo` and `coverage` -- which matters most here: a built Nitro bundle inlines
every dependency, so a conformant app's `.output/server/chunks` contains
`createLogger`, `posthog-js` and a health route, and a scan that reached it
would fail every app in the estate.

**Rule table:**

| Sub-check | Condition                                                                                                                                              | Verdict                                                                            |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| 9.0       | No `package.json` readable at a known monorepo-candidate path                                                                                          | `unknown` (whole item)                                                             |
| 9.0       | At least one manifest readable                                                                                                                         | `pass`, names the manifests read                                                   |
| 9.1       | The inventory and capability coverage, always produced once 9.0 passes                                                                                 | `pass`, summarizing pins, manifests and adopted capabilities                       |
| 9.2       | An `@narduk-enterprises/*` pin the derived catalog cannot classify (retired, renamed, external)                                                        | `unknown` -- the roster cannot score it                                            |
| 9.2       | Every estate pin resolves to a published capability                                                                                                    | `pass`                                                                             |
| 9.3       | A `createLogger` declaration, or a `logger.ts`/`logging.ts` exporting a logger, **with** a `console.*` transport and no `@narduk-enterprises/*` import | `fail` if narduk-logging **or** narduk-core is a dependency, else `unknown` (WARN) |
| 9.4       | An app-local `useSeo` / `defaultSocialMeta` declaration or file that shadows narduk-seo's auto-import, and does not import narduk-seo                  | `fail` if narduk-seo is a dependency, else `unknown` (WARN)                        |
| 9.5       | An `import`/`require` of `posthog-js` in scanned source                                                                                                | `fail` if narduk-analytics is a dependency, else `unknown` (WARN)                  |
| 9.5       | A direct `posthog-js` pin with no such import in the scan                                                                                              | `unknown` (WARN) -- manifest-level signal only                                     |
| 9.6       | A `server/api/**/health*` route that never references `registerHealthCheck`                                                                            | `fail` if narduk-core is a dependency, else `unknown` (WARN)                       |
| 9.6       | No `server/api` directory at any known prefix                                                                                                          | `not-applicable`                                                                   |
| 9.7       | A Nitro plugin that hooks `error`/`afterResponse` or attaches a response `finish` listener **and** logs from it (narduk-logging adoption guide step 5) | `fail` if narduk-logging **or** narduk-core is a dependency, else `unknown` (WARN) |
| 9.7       | No `server/plugins` directory and no `defineNitroPlugin` in the scan                                                                                   | `not-applicable`                                                                   |
| 9.3-9.7   | The scan found no source directory at a known path                                                                                                     | `unknown` -- nothing could be looked for                                           |
| 9.3-9.7   | Scanned, and no reimplementation found                                                                                                                 | `pass` (_proven_); `unknown` if the 2000-file ceiling was reached                  |

The hook alone is not a 9.7 finding: the adoption guide says "Do not replace
product-specific error handling", so an app may hook `error` for its own
behaviour. The finding is a hook that **also logs** -- a second request-summary
or error-log implementation running beside the shared one, which is what "Keep
only one request-summary implementation active" forbids.

**Zero false positives** is the acceptance bar, proven against two conformant
checkouts: `narduk-enterprises/buoys` at `cc72c3d` (PASS, exit 0, 13 estate pins
across two manifests, 112 files scanned, 0 detections) and a freshly generated
`create-narduk-app@0.6.3` scaffold (PASS, exit 0, 11 pins, 7 files scanned, 0
detections, 9.6/9.7 `not-applicable`). Both shapes -- including the near-misses
that would trip a naive detector: a `defineNitroPlugin` registering health
checks, PostHog named throughout the analytics configuration, and a built
`.output` tree -- are committed as fixtures in
`tests/foundation/capability-coverage-artefact.test.ts`.

### Single-source toolchain versions (`foundation:check:toolchain`)

`narduk-app foundation:check:toolchain [--checkout <dir>] [--fix] [--json [path]]`
-- item 11 (Logan, askme 2026-09-17: _"Single-source toolchain versions
(Recommended)"_ — one declared Node/pnpm source per app; every other place
either reads it or is checked against it, so a bump is one edit;
[company-hq#745](https://github.com/narduk-enterprises/company-hq/issues/745)).
The evaluator is `src/foundation/items/item-11-toolchain-single-source.ts` and
matches items 1-7 (`check()` sub-checks, no warn tier). Like items 8, 9 and 10
it is a separate command and JSON artefact
(`tool: '@narduk-enterprises/narduk-app-tools/toolchain-single-source'`) because
`foundation:check --json` is the exact 7-item contract company-hq
`check-web-foundation.py` validates; an `id` outside `1..7` is a rollup-red F3
ARTEFACT finding. Same exit codes (`0` PASS, `1` FAIL, `2` UNKNOWN).

**No credential is needed.** Every verdict comes from the app's own files, so
this can be wired into generated CI after the install step has dropped the
GitHub Packages token.

#### The two sources, and why

| Tool / consumer               | Reads for **Node**                                                                            | Reads for **pnpm**                                     |
| ----------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `actions/setup-node@v7`       | `node-version`, or `node-version-file` pointed at `.node-version` / `.nvmrc` / `package.json` | —                                                      |
| `pnpm/action-setup@v6`        | —                                                                                             | `packageManager`, when the step declares no `version:` |
| Volta                         | `package.json` → `volta.node` **only**                                                        | `volta.pnpm`                                           |
| corepack, pnpm itself         | —                                                                                             | `packageManager`                                       |
| npm / pnpm engine enforcement | `engines.node`                                                                                | `engines.pnpm`                                         |
| fnm, mise, nodenv             | `.node-version` (and `.nvmrc`)                                                                | —                                                      |
| nvm                           | `.nvmrc` **only**                                                                             | —                                                      |
| Cloudflare Workers Builds     | dashboard `NODE_VERSION`                                                                      | dashboard `PNPM_VERSION`                               |

- **Node → `.node-version`.** The widest native readership (setup-node via
  `node-version-file`, fnm, mise, nodenv) and — the deciding property — the only
  Node declaration a workflow can **point at** instead of restating. The shared
  `nuxt-cloudflare.yml` accepts a `node-version-file` caller input for exactly
  that (workflows#97), and a caller that uses it carries no Node literal at all.
- **pnpm → root `package.json` `packageManager`.** corepack, pnpm and
  `pnpm/action-setup` all read it natively; the shared workflow's own pnpm step
  declares no `version:` and proves the path in production. There is no dotfile
  equivalent worth preferring.

Everything else is a **mirror**, because Volta and npm can read a version from
nowhere but a manifest, and a Markdown table reads nothing at all. A mirror
either derives from the source (a workflow's `node-version-file`, an unpinned
`pnpm/action-setup`) or is compared against it here. `--fix` rewrites a drifted
mirror's literal in place, so bumping Node is: edit `.node-version`, run
`narduk-app foundation:check:toolchain --fix`.

`.nvmrc` is **optional**. Every consumer in this estate that reads it also reads
`.node-version`; the only tool that reads `.nvmrc` and not `.node-version` is
`nvm`, which is not the installed manager here. The generator emits
`.node-version` alone, and this item fails on a kept `.nvmrc` only when it
disagrees.

#### What `--fix` will and will not do

It swaps a **value**, never a file's **shape**. It rewrites `engines.*`,
`volta.*`, `.nvmrc`, `.tool-versions` and the Workers Builds table rows on the
exact line the scan located, leaving every other byte alone (an app's own
manifest is not reformatted, reordered, or round-tripped through
`JSON.stringify`). A Markdown row keeps its column width where the padding can
absorb the change; otherwise the app's formatter re-pads it.

It does **not** rewrite a workflow. Turning `node-version:` into
`node-version-file:`, or deleting a `pnpm/action-setup` `version:` input,
changes the structure of a file the app owns and the caller's contract with the
shared workflow — a one-time migration, reported with the exact edit and left
for a human. It also does not invent a missing `.node-version`: with no source
there is nothing to derive from, and picking a mirror to promote would be a
guess.

#### Rule table

| Sub-check   | Condition                                                                                | Verdict                                                                                                                              |
| ----------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 11.0        | No `package.json` readable at a known monorepo-candidate path                            | `unknown` (whole item)                                                                                                               |
| 11.0        | No `.node-version`, or no root `packageManager`                                          | `fail` — the source is missing                                                                                                       |
| 11.0        | A source declares a range (`24`, `^10.33`) rather than an exact `x.y.z`                  | `fail` — a range pins nothing a second tool could agree with                                                                         |
| 11.0        | Both sources present and exact (a corepack `+sha512…` suffix is accepted)                | `pass`                                                                                                                               |
| 11.1 / 11.2 | A mirror's value differs from its source                                                 | `fail`, naming `file:line`, the value found, and the value expected                                                                  |
| 11.1 / 11.2 | Every mirror agrees, or no mirror restates a version                                     | `pass`                                                                                                                               |
| 11.3        | A workflow pins a Node literal — **even one that currently agrees**                      | `fail`; a second declaration is the thing being removed                                                                              |
| 11.3        | A `node-version-file` points at something other than `.node-version`                     | `fail`                                                                                                                               |
| 11.3        | No workflow sets up Node                                                                 | `not-applicable`                                                                                                                     |
| 11.3        | A job calls a shared workflow with no Node input (`cursor-review`, `code-review`, …)     | not a Node site; it is not judged                                                                                                    |
| 11.3        | A job passes `node-version` to a callable that accepts no `node-version-file`            | not a failure (workflows#135); 11.1 still requires the literal to agree                                                              |
| 11.4        | A `pnpm/action-setup` step declares a `version:` input                                   | `fail` — drop it and let the action read `packageManager`                                                                            |
| 11.4        | No workflow installs pnpm with `pnpm/action-setup`                                       | `not-applicable`                                                                                                                     |
| 11.5        | A `docs/workers-builds.md` `NODE_VERSION` / `PNPM_VERSION` row disagrees with its source | `fail` — these record the Cloudflare dashboard build environment, which no checkout can read, so update the dashboard alongside them |
| 11.5        | No such doc or rows                                                                      | `not-applicable`                                                                                                                     |

The `--json` artefact carries a first-class `sites` block — every declaration
site with its file, line, value, role (`source` / `derives` / `mirror`) and
verdict — so the estate roster reads the table as data rather than parsing
sub-check prose, and a `fixes` block recording what `--fix` rewrote.

For existing D1 schemas, use the
[reviewed baseline and frozen cutover proof](docs/migration-baselines.md):
`narduk-app db baseline capture|sql|check|register|prove`. Registration is a
one-time reviewed metadata operation, separate from automatic deployment
migrations.
