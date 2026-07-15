# Skill-author contract: migrate a template-based Narduk app

This is a behavioral contract for the agent that will turn the operator runbook
into one or more skills. It is not itself an installed skill. Read the sibling
[`README.md`](README.md) and
[`been-sober-for.evidence.json`](been-sober-for.evidence.json) before
implementing automation.

## Recommended skill boundary

Use two composable skills rather than one irreversible mega-skill:

1. `migrate-narduk-template-app` — inventory, package readiness, app decoupling,
   local/exact-head gates, merge, and source-account deployment proof.
2. `cutover-cloudflare-account` — target resource rehearsal, zone preparation,
   write freeze, final data move, domain/Registrar transfer, live proof,
   rollback, and retention.

The first skill may prepare maintenance mode and account-cutover documentation,
but it must not move accounts. The second consumes the first skill's completed
evidence packet and the generic Cloudflare account runbook.

## Invocation contract

Inputs should be explicit and serializable:

```text
repository                 narduk-enterprises/<repo>
worktree_root              absolute path
default_branch             discovered, not assumed
app_workspace              apps/web
production_url             https://...
package_scope              @narduk-enterprises
package_registry           https://npm.pkg.github.com
capabilities               discovered then operator-confirmed
cloudflare_source_account  optional in app-decoupling skill
cloudflare_target_account  required only in account-cutover skill
evidence_output            repository-relative checked-in manifest path
protected_evidence_root    absolute non-Git path
mode                       audit | implement | resume | verify
```

Never accept secret values as command-line options or write them into reports.
Credential inputs are owner/project/config/name references. Resolve them only
inside the bounded operation that needs them.

## Required state machine

```text
inventoried
  -> packages-ready
  -> app-decoupled
  -> source-deployed
  -> target-rehearsed
  -> account-cutover-ready
  -> account-cutover-complete
  -> retention-complete
```

Each transition has a stored evidence predicate. `resume` begins by validating
the stored exact SHA, artifacts, protected evidence paths, and current remote
state. If mutable state changed, invalidate only the affected downstream gates.
Do not repeat D1 imports, R2 copies, deployments, or credential creation merely
because a tail-end HTTP proof failed.

The state file must distinguish:

- `not-started`;
- `in-progress` with recoverable evidence;
- `passed` at an exact commit and timestamp;
- `stale` because an input changed;
- `blocked` by an external authority boundary; and
- `failed` with a safe retry point.

## Discovery behavior

The skill must inspect remote truth across three repositories before making a
plan:

- the consumer application;
- `narduk-libs` or another canonical capability publisher; and
- historical `narduk-template` state only to classify inherited behavior.

Historical plan branches are evidence, not implementation truth. Determine
ownership from current packages and app behavior. Use a fresh fetched worktree,
preserve unrelated dirt, and identify the remote default branch rather than
assuming `main`.

Discovery output must include:

- baseline and production SHA/deployment identity;
- direct and transitive Narduk dependencies with resolution source;
- inherited files classified as delete, rewrite, retain-app-owned, or inspect;
- package/module/import/alias surface;
- database journals and migrations;
- Worker bindings, routes, schedules, resources, domains, runtime/build variable
  names, and secret names;
- critical product flows and test coverage; and
- capability disposition, including PWA, ingestion, AI, maps, and operator UI.

The operator must approve retirement or deferral of a product capability when
discovery cannot derive it safely. Routine file ownership and exact package
selection do not need extra approval when the canonical contract is clear.

## Package gate behavior

For every new or changed library version, the skill must require:

1. repository-local quality gates;
2. pack and package metadata validation;
3. an external fixture that installs only packed artifacts;
4. a frozen exact-version registry consumer after publication;
5. exact-head CI before merge;
6. release/tag/package proof after the Changesets release; and
7. the full private-package Actions access closure for the consumer.

It must not infer publication from a Git tag, a release PR, or monorepo-local
success. Prefer semantic GitHub checks (`gh pr checks`, `gh run view`, and
`gh run watch`) over raw log URLs that may transiently return `404`.

## App transformation behavior

The skill should produce small coherent commits in this order:

1. app-owned configuration and direct scripts;
2. package pins and lockfile;
3. explicit imports and aliases;
4. stable migration sources and adoption evidence;
5. app-owned tests/CI/Renovate;
6. maintenance mode when a data/account cutover is expected;
7. removal of functional template/CLI/fleet/Command coupling; and
8. documentation and evidence manifest.

Order may be compressed when a repository is small, but the app must become
self-sufficient before inherited files are deleted. Shared bugs discovered by
the app belong in `narduk-libs`; release and repin the fix instead of leaving an
app-local fork.

## Validation behavior

Validation must be generated from the actual repository scripts and CI, not a
hard-coded generic command list. The minimum semantic gates are:

- authenticated frozen install;
- format, lint with zero warnings, typecheck, unit/integration tests;
- production build and Knip;
- local migration first run and empty repeat;
- browser acceptance on the canonical runner topology;
- maintenance-mode allow/block tests;
- deploy dry-run and expected binding inventory;
- functional zero-reference scan; and
- exact-head PR plus merged-main CI.

Browser server ports must be isolated per workflow run when runner services
share a host/network namespace. Child process launch must use an existing pnpm
executable and preserve `PNPM_HOME`/PATH through nested scripts.

## Evidence behavior

The checked-in record must follow the sibling JSON exemplar and remain
secret-free. It contains conclusions, safe IDs, names, counts, checksums, URLs,
commits, timestamps, and protected evidence references. Raw exports, HTTP
bodies, credentials, personal data, and storage objects stay in a mode-`0700`
operator directory with mode-`0600` files.

Every evidence-producing command records:

- phase and attempt ID;
- exact app/package commit;
- command or normalized operation name;
- start/end timestamps and result;
- output artifact path and SHA-256; and
- whether the artifact is safe to check in.

Normalize nondeterministic exports before comparing them. Preserve original
artifacts as well as normalized manifests.

## Cloudflare safety contract

The account-cutover skill must follow these invariants:

- use explicit Doppler project/config on every invocation; never inherit a
  repository default for operator infrastructure;
- use an approved provisioner only to mint a narrower temporary token;
- never use the provisioner directly for ordinary operations;
- record token name/ID/scope/lifetime, never value, and revoke after the phase;
- classify API capabilities before attempting them; Workers Builds and some
  zone/user operations may require an interactive user-scoped boundary;
- never mutate target production D1 during rehearsal;
- hard-deny production database name and UUID in rehearsal scripts;
- never attach routes, DNS, Registrar, or Custom Domains during rehearsal;
- never reset remote D1; corrections are forward-only;
- never reopen writes until target data, HTTPS, routes, and app flows pass; and
- after target writes open, never roll traffic back to stale source data.

R2 credentials are source/target-specific. Cloudflare S3 derivation, bucket
scope, propagation retry, manifest comparison, multipart ETag caveats, and
credential rotation must be explicit gates.

## Failure classification

Failures should be classified into these retry domains:

| Domain                   | Examples                                             | Retry point                                                 |
| ------------------------ | ---------------------------------------------------- | ----------------------------------------------------------- |
| `source-drift`           | default branch or deployed SHA changed               | re-inventory affected downstream phases                     |
| `package-artifact`       | unpublished package, inaccessible transitive package | package gate only                                           |
| `runner-environment`     | missing/stale pnpm path, shared port                 | exact failed CI gate after durable fix                      |
| `app-contract`           | wrong route, selector, response envelope             | focused test/proof then full acceptance                     |
| `migration-integrity`    | checksum drift, ambiguous adoption, count mismatch   | stop; inspect schema/data before any retry                  |
| `credential-scope`       | 403, unsupported account token capability            | mint narrower/correct authority or mark interactive blocker |
| `credential-propagation` | immediate R2 401 after creation                      | bounded retry without rotating prematurely                  |
| `rehearsal-safety`       | production D1 selected, routes non-empty             | abort before mutation and regenerate config                 |
| `zone-certificate`       | inactive target zone, Universal SSL pending          | wait/repair target; keep writes closed                      |
| `tail-proof`             | one HTTP probe or artifact upload failed             | resume proof-only; do not repeat data movement              |

Use the failure IDs and required guards in the sibling runbook. A failure that
could compromise production data, credential scope, or traffic must stop the
phase. A test ambiguity or proof-script defect is fixed and rerun; it is not
waived.

## Progress and operator visibility

For long migrations, emit phase and overall progress and provide one combined
followable log at launch. Progress is state-based, not elapsed-time based. A
phase is not complete because a worker reports success; the stored gate must
pass at the expected SHA.

The skill should support a concise status command returning:

```json
{
  "app": "been-sober-for",
  "state": "target-rehearsed",
  "exactCommit": "e949bd9873bd72d60efcff870e50b863353d3983",
  "passedGates": 5,
  "nextGate": "account-cutover-ready",
  "blockers": ["Workers Build user authorization", "target zone preparation"],
  "evidence": "docs/operations/template-decoupling/been-sober-for.evidence.json"
}
```

## Prohibited behavior

The skill must never:

- merge the historical pilot branch into the current app;
- recreate a template, sync, reconcile, drift, fleet mutation, or central deploy
  relationship;
- broaden a token merely because an idempotent proof call lacks permission;
- print, log, commit, or include secret values in evidence;
- delete inherited files before classifying app-owned changes;
- adopt legacy migrations without schema evidence;
- reset a remote database;
- use staging as target production or promote staging data;
- run the ordinary production deploy command during target rehearsal;
- treat a target workers.dev proof as the final domain/device proof;
- transfer Apple Developer/App Store ownership when the public URL and Apple
  team remain unchanged; or
- mark the whole migration complete while account-cutover or retention states
  are still pending.

## Acceptance tests for the future skill

Test the skill first against a disposable fixture, then in `audit` and `verify`
mode against BSF without changing state.

Required fixtures:

- package is tagged but unavailable in registry;
- one transitive private package lacks Actions access;
- `npm_execpath` is JS, native, missing, and stale;
- two concurrent browser jobs share a host;
- lockfile contains a Narduk workspace/Git/tarball resolution plus an unrelated
  legitimate app `file:` dependency;
- ambiguous and checksum-drift migration adoption;
- empty and non-empty KV inventories;
- R2 manifests with equal key/size and different multipart ETags;
- accidental selection of target production D1 during rehearsal;
- unsupported Cloudflare account-token API operation;
- target sitemap intentionally disabled; and
- proof-only resume after successful import/copy.

The BSF verify-mode result must reproduce the current `target-rehearsed` state
and the pending blockers in the JSON exemplar without reading secret values or
mutating GitHub, Cloudflare, Doppler, DNS, data, or deployments.
