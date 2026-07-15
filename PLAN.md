# Narduk Template Decommission Foundations — Implementation Plan

## Mission

Establish `narduk-libs` as the independently releasable source of shared runtime
packages, focused app-local tooling, reusable test contracts, AI behavior, and a
one-shot app generator. This first foundation wave must be installable and
testable without `narduk-template`, Command, workspace-only imports, or mutable
Git dependencies. The canonical migration document and ledger are maintained in
this repository and supersede narduk-template PR #454.

## Current state

- Existing runtime packages live under `packages/*`, but the repository has no
  CI or release workflows.
- `@narduk-enterprises/narduk-platform` is still published from two repositories
  and contains template/Command-specific contracts.
- Fleet apps depend on the monolithic `narduk-cli`, copied toolchain wrappers,
  template-owned test assets, and path-derived migration identities.
- The approved migration contract keeps package-owned SQL but requires stable
  `(source, filename, checksum)` migration identity.
- The first wave is deliberately file-disjoint. `pnpm-lock.yaml` is a serial
  integration artifact and is updated only after all package lanes merge.

## Workstream catalog

| WS-ID | Title                                     | Files                                                                                                                                  | Actions                                                                                                                                                                                                                                                                                                                                                                | Risk   | Verify                                                                                                                            |
| ----- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------- |
| F1    | Canonical document and release foundation | `docs/architecture/**`, `.github/workflows/**`, `.changeset/**`, `scripts/release-packages.mjs`, root `package.json`, root `README.md` | Write the approved decommission document and live ledger; add CI, pack/consumer-fixture checks, independent package release automation, and root scripts. CI must not call template or Command.                                                                                                                                                                        | medium | YAML syntax, format check, existing package quality, release script dry run                                                       |
| F2    | Focused app tools                         | `packages/narduk-app-tools/**`                                                                                                         | Implement `narduk-app` with app-local dev, stable-source D1 migration, deploy, registry-auth, doctor, performance-budget, and favicon commands. Never implement sync/reconcile/drift. Migration ledger is `_narduk_migrations(source, filename, checksum, source_version, applied_at)`; ambiguous legacy rows fail closed unless explicit schema adoption proves them. | high   | focused unit tests including filename collision, checksum drift, idempotency, source ordering, remote-reset refusal; pack dry run |
| F3    | Plain testkit                             | `packages/narduk-testkit/**`                                                                                                           | Extract the direct-import Vitest factories, Playwright fixtures/contracts, UI-quality helpers, and analyzer from narduk-template testing/CLI sources. No Nuxt layer or shared config. Preserve importable behavior behind explicit exports.                                                                                                                            | medium | focused unit tests, typecheck, pack/export proof                                                                                  |
| F4    | AI library                                | `packages/narduk-ai/**`                                                                                                                | Extract AI contracts, xAI helpers, model catalog, prompt resolver, admin composable/component, and optional Nuxt route wiring. Use explicit narduk-core schema exports; do not ship a duplicate `system_prompts` baseline migration.                                                                                                                                   | high   | route/auth, model, prompt, package-export, typecheck, pack tests                                                                  |
| F5    | One-shot app generator                    | `packages/create-narduk-app/**`                                                                                                        | Implement deterministic filesystem-only CLI and API. Generate app-owned workspace, direct scripts, CI, Renovate, tests, Nuxt/Worker config, migration source manifest, docs, and exact capability packages. Reject PWA and ingestion. Never contact external services or emit template/Command artifacts.                                                              | high   | deterministic snapshots, forbidden-artifact tests, generated fixture install/quality/build smoke, pack dry run                    |
| F6    | Platform/core neutralization              | `packages/narduk-platform/**`, `packages/narduk-core/**`                                                                               | Later serial wave: remove layer/starter/Command contracts, explicit provision dependency, manifest injection, broad `#layer` aliases, and synthetic public ORM aliases while preserving v1 runtime compatibility.                                                                                                                                                      | high   | full quality plus tarball Nuxt fixtures and BSF build                                                                             |

## Wave schedule

### Wave 1 — File-disjoint foundations

| Lane       | Workstream | File scope                                                                                                                   |
| ---------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------- |
| foundation | F1         | `docs/architecture/**`, `.github/workflows/**`, `.changeset/**`, `scripts/release-packages.mjs`, `package.json`, `README.md` |
| app-tools  | F2         | `packages/narduk-app-tools/**`                                                                                               |
| testkit    | F3         | `packages/narduk-testkit/**`                                                                                                 |
| ai         | F4         | `packages/narduk-ai/**`                                                                                                      |
| create-app | F5         | `packages/create-narduk-app/**`                                                                                              |

Merge order: foundation, app-tools, testkit, AI, create-app. After all merges,
update `pnpm-lock.yaml` once and run the full repository quality gate.

### Wave 2 — Serial compatibility spine

Run F6 after Wave 1 is green. It owns all edits to existing platform/core
packages and must be validated against packed Wave 1 artifacts and the BSF
consumer before publication.

## Cross-lane contracts

- Package lanes may read old sources from
  `/Users/narduk/code/narduk-enterprises/narduk-template` but may modify only
  their declared new package directory.
- Package lanes do not edit the workspace lockfile, root scripts, CI, or another
  package. The integration step owns lockfile reconciliation.
- All packages remain under `@narduk-enterprises/*`. MapKit remains external to
  this repository under `@loganrenz/*`.
- New tooling may perform only explicit operations requested by its command. No
  postinstall hooks, hidden checkout mutation, template metadata, or fleet API.

## Merge and green gate

- Rebase each lane onto `codex/template-decommission-integration`, run its
  focused gate, merge with `--no-ff`, then run `pnpm run quality` on
  integration.
- Quarantine red lanes; never merge based on worker self-report.
- Publication requires `pnpm pack --dry-run` and an install/build test from the
  packed artifact outside the workspace.

## Risks and assumptions

- Package migrations retain ownership; this program does not unify Drizzle
  journals.
- `system_prompts` remains owned by core for v1 compatibility.
- The generator is permitted here by the approved user plan and the updated
  AGENTS boundary, but it must remain one-shot and credential-free.
- `narduk-data` does not yet exist and remains a hard blocker for final template
  archival, not for these foundations.
