---
status: active - approved migration foundation
owner: Logan Renz
supersedes: narduk-template PR #454 and the legacy layers-to-libraries plan
last_updated: 2026-07-14
---

# Narduk template decommission

This document is the durable source of truth for moving shared capability out of
`narduk-template` and into independently versioned `narduk-libs` packages. It
records the approved decisions, the live migration and retirement ledgers, the
evidence required for each app, and the gates that must pass before the old
repository can be archived.

The current repository scope is `@narduk-enterprises/*`. Earlier planning used
`@narduk-enterprises-libs/*`; that name is normalized here to the published
scope already owned by `narduk-libs`.

## Mission and non-negotiable boundaries

The target is a set of plain Nuxt apps that import exactly the capabilities they
use. Framework wiring is delivered through thin, opt-in Nuxt modules; app-owned
pages, schema composition, and migration journals are scaffolded once and then
owned by the app. Standardization is maintained by agent rules and versioned
config packages, not by a runtime command or a file-sync machine.

This program preserves the Cloudflare Workers/D1/KV/R2/Doppler hosting model and
the behavior of each capability behind parity gates. It does not build a new
fleet framework, codemod system, or continuing control plane.

The following are hard boundaries for this repository:

- Published packages must build and test without `narduk-template`, Command,
  Nuxt layers, workspace-only imports, or mutable Git dependencies.
- Package ownership is explicit. Cross-capability dependencies are package
  dependencies, not auto-imports, aliases, or positional `extends` order.
- New tooling performs only the requested app-local operation. It does not sync,
  reconcile, enforce drift, mutate a registry, call a fleet API, or create a
  continuing relationship with an app repository.
- Package SQL retains package ownership, and migration identity is the stable
  tuple `(source, filename, checksum)`. Path-derived and ambiguous bundle
  identities fail closed.
- Published versions are immutable. A correction is a new package version and a
  reviewed consumer upgrade, never an overwrite of an existing version.

## Capability ownership ledger

The `Today` column describes the legacy layer surface. `Target owner` is the
package or app-owned surface that must own the replacement. `Exit evidence` is
required before the capability's old layer can be removed.

| Capability          | Today                                                                                               | Target owner                                                                                          | Target shape                                                                                 | Exit evidence                                                                          | Status                      |
| ------------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | --------------------------- |
| core                | `layers/core`: runtime config, server routes, components, composables, middleware, database helpers | `@narduk-enterprises/narduk-core` plus the F6 neutralization of `@narduk-enterprises/narduk-platform` | Explicit core runtime package, pure helpers, database/server utilities, and thin Nuxt wiring | Isolation fixture, route/config parity, packed consumer, no layer aliases              | Existing; F6 pending        |
| auth                | `layers/auth`: pages, routes, components, composables, middleware, auth tables                      | `@narduk-enterprises/narduk-auth` and its explicit auth/core exports                                  | Package logic and thin module; logic-free auth pages are app-owned                           | Auth route/middleware parity, security tests, app visual/e2e baseline, schema evidence | Existing; migration pending |
| seo                 | `layers/seo`                                                                                        | `@narduk-enterprises/narduk-seo`                                                                      | Explicit SEO imports plus an opt-in Nuxt module                                              | Sitemap/robots/OG route parity and packed consumer                                     | Existing; migration pending |
| analytics           | `layers/analytics`                                                                                  | `@narduk-enterprises/narduk-analytics`                                                                | Client libraries plus opt-in plugins/proxy routes                                            | Analytics route/plugin parity, typecheck, packed consumer                              | Existing; migration pending |
| uploads             | `layers/uploads`                                                                                    | `@narduk-enterprises/narduk-uploads`                                                                  | Upload helpers plus two explicit handlers                                                    | Upload route/e2e smoke and packed consumer                                             | Existing; migration pending |
| app tools           | `narduk-cli` wrappers and copied toolchain behavior                                                 | `@narduk-enterprises/narduk-app-tools` (F2)                                                           | Focused app-local `narduk-app` commands only                                                 | Command inventory shows no sync/drift/fleet behavior; focused tests and pack smoke     | F2                          |
| testing             | Template testing layer and copied test assets                                                       | `@narduk-enterprises/narduk-testkit` (F3)                                                             | Plain Vitest/Playwright contracts and helpers; no Nuxt layer                                 | Explicit exports, fixture tests, packed consumer                                       | F3                          |
| ai                  | `layers/ai` and its schema/routes                                                                   | `@narduk-enterprises/narduk-ai` (F4)                                                                  | AI contracts/clients plus optional Nuxt route wiring; core owns `system_prompts` v1          | Route/auth/model/prompt tests and packed consumer                                      | F4                          |
| maps                | `layers/maps`                                                                                       | Future maps package under `@narduk-enterprises/*`                                                     | Pure client code plus one token route; dead drizzle config removed                           | Token route and package export proof                                                   | Later leaf wave             |
| operator            | `layers/operator`                                                                                   | Future operator-ui package under `@narduk-enterprises/*`                                              | Pure presentational components                                                               | Component/export and visual proof                                                      | Later leaf wave             |
| pwa                 | `layers/pwa`                                                                                        | Future app-owned or thin PWA module; not generated by F5                                              | Explicit opt-in service-worker wiring                                                        | Decision and app-specific proof; no accidental generation                              | Blocked by product decision |
| ingestion           | `layers/ingestion`                                                                                  | Future `narduk-data` ownership                                                                        | Explicit dispatch/ledger package and routes                                                  | `narduk-data` contract, migration/data proof, and app pilot evidence                   | Hard-gated                  |
| one-shot generation | `starters/default` and template scaffolding                                                         | `@narduk-enterprises/create-narduk-app` (F5)                                                          | Deterministic filesystem-only generator                                                      | Deterministic snapshot, forbidden-artifact scan, fixture install/quality/build         | F5                          |

## F1-F6 migrate ledger

This is the complete workstream ledger from `PLAN.md`. A row is complete only
when its verify column is green on the integration branch; worker self-report
does not close a row.

| WS-ID | Workstream                                | Owned files                                                                                                                            | Migrate/retire action                                                                                                                                                                                                                                                                                                                                                                                                       | Risk   | Verify                                                                                                  | Status      |
| ----- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------- | ----------- |
| F1    | Canonical document and release foundation | `docs/architecture/**`, `.github/workflows/**`, `.changeset/**`, `scripts/release-packages.mjs`, root `package.json`, root `README.md` | Establish this ledger, CI, packed-artifact checks, independent Changesets release automation, and root commands. CI and release do not call template or Command.                                                                                                                                                                                                                                                            | Medium | YAML validation, format, release dry run, package quality, publint/pack, outside-workspace consumer     | In progress |
| F2    | Focused app tools                         | `packages/narduk-app-tools/**`                                                                                                         | Implement app-local dev, stable-source D1 migration, deploy, registry-auth, doctor, performance budget, and favicon commands. Never implement sync/reconcile/drift. Use `_narduk_migrations(source, filename, checksum, source_version, applied_at)` with `(source, filename)` identity, checksum fail-closed behavior, deterministic package-before-app ordering, remote reset refusal, and explicit legacy adoption only. | High   | Focused tests for collision, checksum drift, idempotency, ordering, reset refusal; pack dry run         | Wave 1      |
| F3    | Plain testkit                             | `packages/narduk-testkit/**`                                                                                                           | Extract direct-import Vitest factories, Playwright fixtures/contracts, UI-quality helpers, and the analyzer. No Nuxt layer or shared config.                                                                                                                                                                                                                                                                                | Medium | Focused tests, typecheck, explicit exports, pack proof                                                  | Wave 1      |
| F4    | AI library                                | `packages/narduk-ai/**`                                                                                                                | Extract AI contracts, xAI helpers, model catalog, prompt resolver, admin UI, and optional route wiring. Use explicit core schema exports; do not duplicate the `system_prompts` baseline migration.                                                                                                                                                                                                                         | High   | Route/auth/model/prompt/export/typecheck/pack tests                                                     | Wave 1      |
| F5    | One-shot app generator                    | `packages/create-narduk-app/**`                                                                                                        | Generate an app-owned workspace, direct scripts, CI, Renovate, tests, Nuxt/Worker config, migration source manifest, docs, and exact capability packages. Reject PWA and ingestion. Never contact external services or emit template/Command artifacts.                                                                                                                                                                     | High   | Deterministic snapshots, forbidden-artifact scan, generated fixture install/quality/build, pack dry run | Wave 1      |
| F6    | Platform/core neutralization              | `packages/narduk-platform/**`, `packages/narduk-core/**`                                                                               | Remove layer/starter/Command contracts, implicit provision dependency, manifest injection, broad `#layer` aliases, and synthetic public ORM aliases while preserving v1 runtime compatibility.                                                                                                                                                                                                                              | High   | Full quality, packed Nuxt fixtures, and BSF consumer build                                              | Wave 2      |

## Retirement ledger

The following assets are retired only at the stated gate. “Frozen” means no new
feature development and no new consumers, while existing stragglers retain a
rollback path until the final archive gate.

| Legacy asset                                                                                    | Disposition                                                           | Retirement gate                                                                                              | Evidence owner      |
| ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------- |
| `layers/*` (11 layers)                                                                          | Delete one capability at a time after its package/module lands        | Every app using that layer has package, route, e2e, and visual evidence; fleet inventory says zero consumers | App migration owner |
| `packages/narduk-nuxt-module`                                                                   | Delete computed `extends` ordering and `#server/app-orm-tables` alias | Every app composes explicit modules and owns its schema entry/journal                                        | F6                  |
| `packages/narduk-platform`                                                                      | Mostly dissolve; salvage only genuinely pure helpers                  | F6 API/export audit and no platform-only template/Command contracts                                          | F6                  |
| `packages/narduk-cli` (`narduk`/`narduk-fleet`)                                                 | Retire runtime commands; keep at most the one-shot generator in F5    | Command gate is green and all app-local commands have direct replacements                                    | F2/F5               |
| `provision.json` / `narduk.layout.json`                                                         | Delete; app identity/config lives in explicit Nuxt config and env     | Per-app evidence records replacement config and no remaining reader                                          | App migration owner |
| `.template-reference/` / `guardrail-exceptions.json`                                            | Delete                                                                | App extends zero template layers and zero-reference scan is green                                            | App migration owner |
| Dead `drizzle.config.ts` in maps/uploads/analytics                                              | Delete                                                                | Package has no schema it owns and packed package scan is green                                               | Capability owner    |
| `tools/publish-layer-bundles.ts`, `export-starter.ts`, `starter-smoke.ts`, layer-bundle tooling | Delete/replace with per-package Changesets and packed fixtures        | Release workflow and consumer smoke are green                                                                | F1                  |
| `starters/default`                                                                              | Replace with F5 output                                                | Generator snapshot and generated fixture gates are green                                                     | F5                  |
| `narduk-template` repository                                                                    | Archive after downstream Wave 4                                       | All archive gates below, including the hard `narduk-data` gate                                               | Logan Renz          |

## Execution waves

### Step 0: authoritative fleet inventory

Before downstream migration starts, enumerate `narduk-enterprises` repositories
and record, per app, whether `package.json` contains a
`@narduk-enterprises/narduk-nuxt-template-layer-*` dependency and whether the
app contains `provision.json`. The inventory is the source for the app ledger;
there is no hand-maintained static fleet list.

The inventory command is:

```sh
gh repo list narduk-enterprises --json name
```

Per-app inspection must be read-only. Record the commit SHA, current deploy
target, layer list, schema/migration state, and the owner who signs the
evidence.

### Wave 1: file-disjoint foundations in this repository

Merge lanes in this order: foundation (F1), app-tools (F2), testkit (F3), AI
(F4), and create-app (F5). The integration lane updates `pnpm-lock.yaml` once
after all five lanes merge, then runs the full quality gate.

### Wave 2: serial compatibility spine

Run F6 after Wave 1 is green. Validate the existing platform/core packages
against packed Wave 1 artifacts and the BSF consumer before publication.

### Downstream migration waves

The approved architecture plan has a second, downstream wave vocabulary. It is
retained here so the F1 ledger cannot lose the sequencing decision:

| Wave   | Scope                                                                                                                                                   | Exit condition                                                                             |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Wave 0 | Meta-template/shared config, core pure packages, auth-core carve, layer re-pointing, database model, and the uploads reference conversion               | Coexistence invariant and reference app packed/isolation gates green                       |
| Wave 1 | Leaf capabilities: operator-ui, testing, maps                                                                                                           | Each leaf has explicit exports and no app extends its old layer                            |
| Wave 2 | Hybrid capabilities: PWA, analytics, SEO, AI, ingestion                                                                                                 | Every capability has module/route/schema evidence; `narduk-data` gate applies to ingestion |
| Wave 3 | Load-bearing auth wiring, then core Nuxt wiring                                                                                                         | Auth pages are logic-free app-owned shells; route/config parity is green                   |
| Wave 4 | Delete layers, template references, provision support, layer tooling, dead drizzle configs, and runtime CLI commands; update rules and archive template | All archive gates below are green and evidence is signed                                   |

## Per-app evidence ledger

Step 0 creates one row per app. Capability migrations append evidence to the
same row rather than replacing history. `N/A` is valid only with a written
reason; blank means incomplete.

| App/repository       | Owner + commit SHA | Current layers/`extends` | `provision.json` / identity | Target packages/modules | Baseline routes/middleware | Baseline visual/e2e | Schema + migration evidence | Build/typecheck/lint/knip | Package consumer proof | Zero-reference scan | Rollback ref + sign-off |
| -------------------- | ------------------ | ------------------------ | --------------------------- | ----------------------- | -------------------------- | ------------------- | --------------------------- | ------------------------- | ---------------------- | ------------------- | ----------------------- |
| Step 0 inventory row | TBD                | TBD                      | TBD                         | TBD                     | TBD                        | TBD                 | TBD                         | TBD                       | TBD                    | TBD                 | TBD                     |

For each migrated capability, retain the old and new route/middleware/plugin/
runtime-config inventory, the packed package versions, the app commit tested,
and visual screenshots or approved baselines. A package is not considered
migrated because its source exists; the consuming app must prove the behavior.

## Hard gates

### `narduk-data` gate

`narduk-data` does not yet exist. That is a hard blocker for final template
archival and for claiming ingestion/data ownership, but it is not a blocker for
F1 foundations or the other independent package lanes.

Do not infer or invent a data package to satisfy this gate. Before ingestion or
any data-dependent archive decision can close, the evidence must include all of
the following:

1. A real `narduk-data` repository/package contract with an owner, immutable
   release version, explicit exports, and a supported runtime/storage boundary.
2. Stable migration identity and schema evidence for package-owned SQL,
   including `(source, filename, checksum)` and the app's applied migration
   ledger.
3. An outside-workspace packed-artifact consumer install/build and a pilot app
   route/data smoke with no layer or Command dependency.
4. A rollback version and an app sign-off showing that the data path can be
   reverted without a remote reset or destructive migration.

Until these are present, F5 rejects ingestion and the template remains
unarchivable. A green F1 CI run must never be reported as satisfying this gate.

### Command retirement gate

The runtime `narduk`/`narduk-fleet` command is not replaced by another drift
enforcer. Before retiring it:

- every required app-local operation has a direct script or focused package;
- no package, workflow, generator output, or release path calls Command,
  dispatches a control-plane event, or depends on a Command payload;
- `sync`, `reconcile`, `drift`, `check-setup`, `check-health`, and `check-drift`
  behavior is removed or replaced by ordinary package/app gates;
- remaining consumers are listed in the app ledger with an owner and rollback;
- zero-reference and packed consumer scans are green.

### Template archive gate

Archive `narduk-template` only when every item is true:

- Step 0's fleet inventory is current and every app has signed evidence.
- Every app extends zero template layers and imports its replacement packages or
  owns the replacement surface.
- Every app passes build, typecheck, lint, knip, e2e smoke, and visual parity
  against its pre-migration baseline.
- `layers/`, `.template-reference/`, provision support, `narduk-nuxt-module`,
  layer-bundle tooling, and retired runtime CLI commands have no live consumers.
- Old layer packages are frozen and a documented package-version rollback exists
  for any remaining operational incident.
- The Command gate and the hard `narduk-data` gate are both green.
- The zero-reference scans below are green on apps, packages, workflows, and
  generator output.

## Zero-reference patterns

Run these scans from each app or the template checkout, excluding this canonical
ledger because it deliberately names retired assets:

```sh
git grep -n -E \
  -- ':!docs/architecture/narduk-template-decommission.md' \
  'narduk-nuxt-template-layer-|\.template-reference|provision\.json|narduk\.layout\.json|narduk-fleet|#layer/orm-tables|#server/app-orm-tables|guardrail-exceptions\.json|scripts/narduk-toolchain\.mjs'
```

For retired command behavior, use the narrower patterns below so valid package
names such as `narduk-app` are not falsely matched:

```sh
git grep -n -E '(^|[^[:alnum:]_-])(check-setup|check-health|check-drift|sync|reconcile|drift)([^[:alnum:]_-]|$)'
```

For every packed artifact, assert that the published manifest contains neither
workspace nor mutable Git dependencies:

```sh
tar -xOf path/to/package.tgz package/package.json \
  | rg -n 'workspace:|git\+|github\.com/.+\.git|file:/|narduk-template|Command'
```

The expected result is no output. Scans over this document itself are not a
substitute for scans over the consuming apps and packed manifests.

## Release and package verification

`narduk-libs` uses Changesets for independent package versions. A changeset
names only the packages whose public behavior changed. The release workflow:

1. installs with the frozen lockfile and authenticates only the
   `@narduk-enterprises` GitHub Packages scope;
2. runs format, lint, typecheck, build, tests, publint, and pack checks;
3. runs an install smoke from packed tarballs in a temporary directory outside
   the pnpm workspace;
4. uses Changesets to prepare or publish only the changed package versions;
5. publishes to GitHub Packages and creates immutable version tags; it does not
   dispatch to an app repository or depend on a fleet control plane.

Local commands are intentionally explicit:

```sh
pnpm run quality
pnpm run release:dry-run
pnpm run release:consumer-smoke
```

`release:dry-run` never publishes, changes package versions, writes a lockfile,
or commits. It validates each public package manifest, runs publint, and asks
pnpm for a dry-run pack listing. The consumer smoke creates and removes only a
temporary directory outside the workspace.

## Rollback and verification instructions

### Package or capability rollback

1. Stop the rollout and preserve the app commit, package tarball, test output,
   route inventory, and visual baseline that exposed the regression.
2. Change the app to the prior immutable package version, or temporarily restore
   the old layer only for the capability whose migration failed. Do not
   overwrite a published version and do not delete or reset a remote database.
3. Re-run the app's build/typecheck/lint/e2e/visual gate and compare the old/new
   route, middleware, plugin, config-key, and migration evidence.
4. Fix the owning package, add a changeset, publish a new version, and repeat
   the packed consumer gate before resuming the fleet rollout.
5. Remove the temporary old-layer fallback only after the app ledger is updated
   with the new evidence and sign-off.

### Migration rollback

Migration identity is append-only. A checksum change for an existing
`(source, filename)` is a fail-closed error that requires a new filename or an
explicit reviewed adoption record. Remote reset is never an automatic rollback;
local reset is allowed only when the command explicitly requests it and the
operator records the reason.

### Final verification checklist

- F1-F6 ledger status and commit links are current.
- Each app evidence row has no unexplained blanks and names a rollback version.
- Packed manifests resolve without workspace-only or mutable Git dependencies.
- `pnpm run quality`, `pnpm run release:dry-run`, and the outside-workspace
  consumer smoke are green on the exact commit being merged.
- Command, template, and `narduk-data` archive gates are separately green.
- The final archive action is reviewed against this document, not against a
  worker summary or an old template PR.
