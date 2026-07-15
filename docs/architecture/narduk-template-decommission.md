---
status: active
owner: Logan Renz
decision_date: 2026-07-14
last_verified: 2026-07-14
supersedes: https://github.com/narduk-enterprises/narduk-template/pull/454
---

# Narduk template decoupling and final decommission

This document is the source of truth for decoupling the current Narduk app scope
and permanently decommissioning `narduk-template`. Migrated apps also remove
their Command coupling, but operational Command shutdown and archival are a
deferred follow-on, not a current phase-completion gate. This document
explicitly supersedes
[narduk-template PR #454](https://github.com/narduk-enterprises/narduk-template/pull/454);
that PR is historical context and must not guide implementation.

The program is gate-driven, not date-driven. A current-scope repository is
complete only when its row below contains reviewed PR, immutable package
versions, migration proof, deployed Worker/SHA and route proof, and a
zero-reference result. The 20 repositories in the owner-approved deferred table
are skipped for now, not retired or complete, and are excluded from the current
migration-progress denominator. They must later be migrated or formally retired
before a final template archive can omit them. A package or repository may be
frozen before it is archived. Nothing is unpublished: historical repositories,
tags, and package artifacts remain available and read-only after retirement.

## 1. Locked decisions

- Surviving apps become ordinary, independently owned Nuxt repositories that
  consume explicit, immutable package versions.
- `narduk-libs` is the canonical monorepo and sole publisher for shared Narduk
  runtime and tooling packages under `@narduk-enterprises/*`.
- `/Users/narduk/code/narduk-geo/narduk-mapkit` is the sole MapKit source and
  publishes immutable packages under the repo-aligned `@narduk-geo/*` scope on
  GitHub Packages.
- Generic ingestion moves to a future `narduk-data` pipeline outside
  `narduk-geo` and `narduk-libs`. No interim ingestion package is permitted.
- PWA and operator-layer concepts are retired. No replacement PWA or operator
  package is created.
- Apps remove Command callbacks, leases, mutation endpoints, and deployment
  coupling as they migrate. Command remains operational for now; its shutdown,
  resource recovery window, and repository archive are a deferred follow-on with
  no replacement control plane. `narduk-control` remains a read-only inventory
  and proof surface.
- New apps are created once by a deterministic scaffolder and onboarded by a
  skill. Generated repositories retain no scaffold, registry, or sync
  relationship.
- `narduk-template` is in feature freeze immediately. Only critical security
  fixes and migration unblockers are allowed.
- Final template archival cannot happen until every surviving repository has
  zero functional template references and `narduk-data` passes its production
  gate. A repository marked `deferred` must be reactivated and migrated or
  formally retired before that final archive gate.
- Cloudflare Workers Builds remains the production deployment owner. There is no
  centralized fleet deploy workflow.

## 2. Target architecture

### Shared capability disposition

| Existing surface                                     | Final owner and disposition                                                                                                                                                                                                                                                                                             |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Core, auth, analytics, SEO, uploads, runtime helpers | Keep `@narduk-enterprises/narduk-app`, `narduk-core`, `narduk-auth`, `narduk-analytics`, `narduk-seo`, and `narduk-uploads` in `narduk-libs`. Preserve current behavior during migration.                                                                                                                               |
| `narduk-platform`                                    | `narduk-libs` is its sole publisher immediately. Retain only neutral environment, onboarding, and provider contracts. Remove layer manifests, starter composition, Command origins, `CONTROL_PLANE_URL`, and `templateManaged` behavior.                                                                                |
| AI layer                                             | Add `@narduk-enterprises/narduk-ai` in `narduk-libs`, exposing existing xAI helpers, model catalog, prompt resolution, admin composable/component, and optional Nuxt route registration. The already-published `system_prompts` schema and migration remain in `narduk-core`; do not create another baseline migration. |
| Testing layer                                        | Add dev-only `@narduk-enterprises/narduk-testkit` with reusable Vitest factories, Playwright fixtures/contracts, visual-audit helpers, and analyzer. Apps own test configuration and discovery wrappers.                                                                                                                |
| Operator layer                                       | Retire. Any consumer brought into scope recreates only the primitives it actually uses as app-local Nuxt UI. Do not create `narduk-operator`. App Builder itself is deferred for now.                                                                                                                                   |
| PWA layer                                            | Retire without replacement. Remove install/update UI, offline behavior, service workers, offline pages, and the core-injected manifest link. Ordinary icons or an app-owned non-PWA web manifest may remain.                                                                                                            |
| Maps layer                                           | Extract generic behavior into canonical `narduk-geo/narduk-mapkit`, never `narduk-libs`.                                                                                                                                                                                                                                |
| Ingestion layer                                      | Freeze temporarily. Do not copy it into apps or create a temporary library. Remove it only after `narduk-data` passes section 8.                                                                                                                                                                                        |
| Template testing/smoke app                           | Replace it with packed package-consumer fixtures in `narduk-libs`, then retire the smoke repository.                                                                                                                                                                                                                    |

`narduk-core` remains the v1 compatibility facade during the migration. Further
decomposition is allowed later and cannot block template retirement. Before the
final gate, internal `#layer` imports and broad compatibility aliases must be
gone.

### MapKit canonicalization

Convert `/Users/narduk/code/narduk-geo/narduk-mapkit` into a two-package
workspace:

- `@narduk-geo/narduk-mapkit@1.x`: framework-neutral client, server, token,
  geometry, temporal, vector-overlay, and Apple Maps API helpers.
- `@narduk-geo/narduk-mapkit-nuxt@1.x`: `AppMapKit`, `useMapKit`,
  `useMapkitToken`, Nuxt registration, and `/api/mapkit-token`.

Both packages publish immutable SemVer releases from the canonical repository to
GitHub Packages. GitHub requires authenticated npm-format installs even for
public package visibility, so registry-auth tooling routes both
`@narduk-enterprises/*` and `@narduk-geo/*` through `https://npm.pkg.github.com`
using the existing read-token contract. Package metadata points to
`narduk-geo/narduk-mapkit`.

The generic unconfigured-token response remains `503`. GoNoGo keeps its
intentional app-owned `200` fallback. Before deleting other copies, rescue the
stale checkout's vector-overlay helpers and the Earthdata vendor cache. Remove
vendored MapKit source, absolute tarball references, mutable Git branches,
redirected repository URLs, and copied token implementations only after every
consumer is on the immutable packages.

### Focused app tooling

Add `@narduk-enterprises/narduk-app-tools` to `narduk-libs` with binary
`narduk-app`. It is app-local only and must never implement sync, reconcile,
drift, fleet mutation, registry mutation, or template-layout enforcement.

Supported commands are:

```text
narduk-app dev -- <command>
narduk-app db migrate --config <file> --database <name> --local|--remote
narduk-app deploy <deploy|versions-upload> [...]
narduk-app deploy-local [...]
narduk-app registry-auth
narduk-app doctor
narduk-app performance-budget [...]
narduk-app assets favicons
```

Formatting, linting, typechecking, Knip, tests, quality, and builds remain
direct app scripts. Secrets are loaded in-memory; there is no file-writing
`pull-secrets` replacement.

Publish one final `@narduk-enterprises/narduk-cli` compatibility release. It
delegates retained operations to `narduk-app` or `narduk-testkit` and fails each
removed command with specific migration instructions. Then freeze and deprecate
`narduk-cli`, `narduk-starter-toolkit`, `narduk-nuxt-module`, and every
`narduk-nuxt-template-layer-*` package.

### Database and alias contract

Package-owned and app-owned migration journals remain separate. Every app owns
`apps/web/migrations.sources.json`:

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
  ]
}
```

`narduk-app db migrate` uses `_narduk_migrations` with primary key
`(source, filename)` and stores checksum, source version, and application
timestamp. Explicit source IDs, not paths, define identity. Package sources run
before app sources; a second run is empty; checksum drift fails closed.

Legacy `bundle:*`, `layer:*`, path-derived, and bare-filename rows are adopted
only after inspecting the actual tables, columns, and indexes named by the SQL.
An ambiguous row is an error, never an implicit success. Remote resets are
forbidden. Rollback is forward-only through corrective migrations. Every remote
cutover records the D1 Time Travel or recovery state, current ledgers, and
schema metadata and rehearses the migration against a production copy.

Alias target:

- Keep Nuxt's native `#server/*` alias for concrete app files.
- Replace synthetic `#server/app-orm-tables` and `#server/core-orm-tables` with
  one app-owned dialect selector, `#narduk-db`.
- Replace app `#layer/server/*` imports with explicit package subpaths.
- Package-private dynamic aliases become `#narduk-core/schema` and
  `#narduk-core/postgres-runtime`.
- Final searches for `#layer` and synthetic ORM aliases return zero in every
  surviving repository.

### Environment ownership after app decoupling

| Surface                                          | Owner                                         |
| ------------------------------------------------ | --------------------------------------------- |
| Routes, non-secret vars, bindings, cron triggers | App-owned `wrangler.jsonc`                    |
| Build variables and runtime secrets              | Cloudflare Workers settings                   |
| Runtime-config shape and defaults                | App-owned `nuxt.config.ts`                    |
| Capability-specific validation                   | Each capability package                       |
| Capability inventory for status/onboarding only  | `apps/web/package.json` `narduk.capabilities` |

`narduk.capabilities` is informational. It never triggers sync or mutation.

### New-app contract

Add `@narduk-enterprises/create-narduk-app` in `narduk-libs` with binary
`create-narduk-app` and API
`createNardukApp(options): Promise<CreateNardukAppReport>`.

```text
pnpm dlx @narduk-enterprises/create-narduk-app@<exact-version> <slug>
  --display-name="..."
  --description="..."
  --site-url=https://...
  --target-dir=/absolute/path
  --capabilities=auth,seo,analytics,uploads,ai,mapkit
  --visibility=private|public
  --local-dev-port=3011
  --json
```

Core is implicit. `pwa` is rejected as retired. `ingestion` is rejected with
guidance to `narduk-data`; a future `data` capability may be added only after
that service is production-ready.

The generator creates a deterministic pnpm workspace with `apps/web`, exact
package versions, direct scripts, app-owned CI, Renovate, Playwright/Vitest,
Worker config, migrations, docs, and explicit Nuxt modules. It may initialize
local Git but performs no GitHub, Cloudflare, or Doppler mutation. It never
creates template metadata, toolchain wrappers, sync workflows, Command payloads,
service workers, or generic ingestion files. Its report lists generated files,
package versions, capabilities, and validation results.

The `create-narduk-app` skill in `narduk-skills` owns idempotent GitHub,
Proxmox-runner, Cloudflare, Doppler, Workers Builds, migration, deployment, and
live-proof steps. It never calls Command and never creates a continuing registry
relationship.

## 3. Evidence model and current inventory snapshot

Every current-scope app row must eventually record:

1. canonical repository and owner, migration owner, baseline commit, and
   production URL;
2. Worker, domains, D1/KV/R2/Queue resources, schedules, capability packages,
   runtime/build variable names, secret names, and baseline deployment proof;
3. migration PR and merge SHA, exact package versions, CI run, and Renovate
   configuration;
4. D1 recovery point, pre/post ledgers and schema, production-copy rehearsal,
   remote migration result, and empty second run;
5. Workers Build/deployment ID, deployed SHA, health/public/auth/mutation/cron/
   map/AI/app-specific route proof; and
6. final zero-reference output, rollback pins, reviewer, and completion date.

The first read-only Command snapshot was exported from `command-db` at
`2026-07-14T22:03:12.940Z`, source revision
`3238e183836efdf145365bfc9762b0ffabd5a553`, with 34 apps, canonical content
SHA-256 `0e1654dcdfdad83f4a6f274f4044f5cd968ee2452eb3427462f6aaa4fb293119`, and
file SHA-256 `c932bf93f13f774e5273e1332fcc00119c6bf96cf501dc169813459a68e14321`.
It is redacted and checksummed. It does not model schedules, and resource target
names can be declarative; repository and Cloudflare inspection must fill those
gaps. `narduk-control` consumes the checked-in artifact read-only and does not
call Command APIs or D1.

Wave 0 implementation evidence:

| Evidence                          | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Template feature freeze           | [narduk-template PR #456](https://github.com/narduk-enterprises/narduk-template/pull/456), merge `faf414afefade12b475da67d1380f9f91dd7cbbd`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Command export and feature freeze | [Command PR #375](https://github.com/narduk-enterprises/command/pull/375), merge `0c638b9450c46d819c74b46182e3e60e60759fe8`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Read-only inventory import        | [narduk-control PR #1](https://github.com/narduk-enterprises/narduk-control/pull/1), merge `b4af3a64b8ffdbff09e6b4125dcbc4049a7e0da8`; Cloudflare version `bfcf877e-e29c-4827-b951-43e315f276af` (`git-b4af3a64b8ff`); health is `200`, protected inventory is registered and returns unauthenticated `401`; 24 tests, lint, typecheck, build, deploy dry-run, and zero pending D1 migrations passed; authenticated response proof remains pending                                                                                                                                                                                                                                                                                                                                                                     |
| Canonical MapKit extraction       | [narduk-mapkit PR #2](https://github.com/narduk-geo/narduk-mapkit/pull/2), merge `b263088b557c151942668d7801a75f3ec33d0bf5`; [main CI run 29376623323](https://github.com/narduk-geo/narduk-mapkit/actions/runs/29376623323); 43 core tests, 6 Nuxt tests, strict package checks, Cloudflare build, packed-consumer fixtures, and release tarball artifacts passed. [Recovery PR #4](https://github.com/narduk-geo/narduk-mapkit/pull/4) merged at `4416ac3`; [recovery release run 29387399924](https://github.com/narduk-geo/narduk-mapkit/actions/runs/29387399924) passed at that exact merge, skipped existing `@narduk-geo/narduk-mapkit@1.0.0`, published `@narduk-geo/narduk-mapkit-nuxt@1.0.0`, then installed both exact versions in a clean consumer and proved the `503/403/200/405` token-route contract. |

Wave 1 implementation evidence:

| Evidence                   | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Independent onboarding     | [narduk-skills PR #23](https://github.com/narduk-enterprises/narduk-skills/pull/23) introduced `create-narduk-app`; [PR #24](https://github.com/narduk-enterprises/narduk-skills/pull/24), merge `acab9ef51ef34992e22947e1a63669ca4e260e43`, hardened Workers Builds, Doppler, registry-auth, secret-name, and live-proof contracts. [PR #25](https://github.com/narduk-enterprises/narduk-skills/pull/25) merged at `71cfb62` with the GitHub Packages onboarding contract. Release-auth recovery [PR #26](https://github.com/narduk-enterprises/narduk-skills/pull/26) merged at `9e32e4d`; [release run 29387490210](https://github.com/narduk-enterprises/narduk-skills/actions/runs/29387490210) published `@narduk-enterprises/narduk-skills@0.8.0`, tag `v0.8.0`, and the corresponding GitHub release. |
| Platform publisher handoff | [narduk-template PR #457](https://github.com/narduk-enterprises/narduk-template/pull/457), merge `d07d6f4e547058a741a5325d9867b9159724b74c`, removed `narduk-platform` from every template publication path, registry-version lookup, retry repair, and dispatch payload; [Publish Layers run 29377569930](https://github.com/narduk-enterprises/narduk-template/actions/runs/29377569930) selected no targets and skipped publication after merge                                                                                                                                                                                                                                                                                                                                                             |
| Independent package PR     | [narduk-libs PR #1](https://github.com/narduk-enterprises/narduk-libs/pull/1) contains independent release automation, app tools, stable migration journals, AI, testkit, deterministic scaffolding, neutralized Platform contracts, and canonical `#narduk-core/*` private database aliases. [CI run 29387638555](https://github.com/narduk-enterprises/narduk-libs/actions/runs/29387638555) passed at `a689507`, including full package quality, manifest and pack checks, and the external packed-consumer fixture with both GitHub Package scopes configured. Immutable internal-package publication remains a draft gate.                                                                                                                                                                                |
| Generated consumer proof   | The automated release gate packs all 11 artifacts, imports both Testkit runner families with native Node, executes the compiled Testkit CLI, runs the packed generator, mounts packed Core's `LayerAppHeader` to exercise color-mode SSR, proves exact pins and zero forbidden references, performs clean and frozen installs, format/lint/typecheck/unit/Knip, warning-free Nuxt/Cloudflare build, eight applied migrations plus an empty rerun, Playwright, performance budget, and Wrangler deploy dry-run; immutable published-registry proof remains pending                                                                                                                                                                                                                                              |
| Final CLI compatibility    | [narduk-template PR #458](https://github.com/narduk-enterprises/narduk-template/pull/458) is a blocked draft for `narduk-cli@1.28.74`; it delegates retained operations to exact app-tools/testkit releases and fails retired sync, fleet, Command, layout, path-migration, quality-wrapper, and secret-file commands with migration guidance; real-registry delegate proof remains pending                                                                                                                                                                                                                                                                                                                                                                                                                    |

Status values are `inventory`, `local-validated`, `pr-open`, `landed`,
`staging`, `production-proved`, `blocked`, `deferred`, and `complete`. Only
`complete` satisfies a current migration gate. `deferred` means owner-approved
skip for now, not retirement or completion.

## 4. Decision-complete fleet ledger

### Current active-registry migration scope: 22 apps

`Pending` in an evidence column is an explicit open gate, not missing scope. The
canonical repository column applies the approved ownership corrections even when
the Command snapshot still names the old repository.

The 2026-07-14 remote audit confirmed all 34 registry rows are unarchived and
`active/live`, and every one still has functional template markers at current
remote HEAD. The owner subsequently deferred 13 of those apps. The current
active-registry migration denominator is therefore 21. A scan of 169 unarchived
repositories across the relevant owners found no additional template-coupled
repository. Existing local checkouts for Clawdle, Favicon Checker, iMessage
Dictionary, and LLB CPA still point at pre-transfer origins and must have their
remotes corrected before migration worktrees are created.

Across the original 44 migration and audit candidates, 24 remain in the current
program denominator: 21 active registry apps, `narduk-control`, canonical
`narduk-charts`, and direct MapKit consumer `hydrogen`. Twenty are deferred in
the table below. Already-decoupled deployed surfaces and explicit retirement
targets remain tracked for final completeness but are not counted in this
migration denominator.

| Candidate bucket               | Original | Deferred | Current denominator |
| ------------------------------ | -------: | -------: | ------------------: |
| Active registry apps           |       34 |       13 |                  21 |
| Additional retain/audit        |        4 |        2 |                   2 |
| Direct MapKit consumers        |        6 |        5 |                   1 |
| **Total migration candidates** |   **44** |   **20** |              **24** |

| App                       | Canonical repository                           | Cohort / capabilities                                          | Baseline evidence                                                                                                    | Migration PR + exact pins                                             | Migration proof                                                                                                              | Worker build/SHA + routes                                | Zero refs                              | Status          |
| ------------------------- | ---------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | -------------------------------------- | --------------- |
| been-sober-for            | `narduk-enterprises/been-sober-for`            | Reference; analytics, auth, SEO, uploads                       | `b22a660`; `www.beensoberfor.com` 200; `/api/health` 200; auth runtime 200; D1 recovery bookmark captured 2026-07-14 | Local cutover `0574482`; immutable publication and PR pending         | Local quality, browser, build, D1 apply plus empty rerun, and packed-artifact proof green; production-copy rehearsal pending | Current deployed SHA `b22a660f0a64`; replacement pending | Local proof green; remote scan pending | local-validated |
| apps-catalog              | `narduk-enterprises/apps-catalog`              | Baseline; analytics, SEO                                       | Command snapshot                                                                                                     | Local cutover/evidence `ead6f7`; immutable publication and PR pending | Exact packed candidate and local app gate green; registry and remote proof deferred                                          | Pending                                                  | Local proof green; remote scan pending | local-validated |
| clawdle                   | `narduk-incubator/clawdle`                     | Baseline; analytics, auth, SEO                                 | Command snapshot; ownership correction verified                                                                      | Local cutover `f88b852`; immutable publication and PR pending         | Full local cutover gate green; publication and remote proof deferred                                                         | Pending                                                  | Local proof green; remote scan pending | local-validated |
| domain-name-search-org    | `narduk-enterprises/domain-name-search-org`    | Baseline; analytics, auth, SEO                                 | Command snapshot                                                                                                     | Local cutover `67b3be4`; immutable publication and PR pending         | Quality/build/Knip, 31 unit tests, D1 `8 + 0`, legacy adoption `8 -> 8`, Playwright `48/48`, and deploy dry-run green        | Pending                                                  | Local proof green; remote scan pending | local-validated |
| favicon-checker           | `narduk-incubator/favicon-checker`             | Baseline; analytics, auth, SEO                                 | Command snapshot; ownership correction verified                                                                      | Local cutover `a543045`; immutable publication and PR pending         | Strict quality/build/Knip, 2 unit tests, D1 `11 + 0`, Playwright `4/4`, visual score 100, and deploy dry-run green           | Pending                                                  | Local proof green; remote scan pending | local-validated |
| howtostartafirewithsticks | `narduk-enterprises/howtostartafirewithsticks` | Baseline; analytics, SEO                                       | `b132c91`; production pages and `/api/health` 200; D1/KV inventory captured                                          | Local cutover `db3c3ea`; registry lock and PR pending                 | Warning-free quality/build, D1 `6 + 0`, Playwright `9/9`, visual 100, Knip, actionlint, and deploy dry-run green             | Current deployed SHA `b132c91`; replacement pending      | Local proof green; remote scan pending | local-validated |
| llb-cpa                   | `narduk-enterprises-clients/llb-cpa`           | Baseline; analytics, SEO                                       | Command snapshot; ownership correction verified                                                                      | Pending                                                               | Pending                                                                                                                      | Pending                                                  | Pending                                | inventory       |
| lucys-loomies             | `narduk-enterprises/lucys-loomies`             | Baseline; analytics, auth, SEO, uploads                        | Command snapshot                                                                                                     | Pending                                                               | Pending                                                                                                                      | Pending                                                  | Pending                                | inventory       |
| old-austin-grouch         | `narduk-enterprises/old-austin-grouch`         | Baseline; analytics, SEO                                       | Command snapshot                                                                                                     | Pending                                                               | Pending                                                                                                                      | Pending                                                  | Pending                                | inventory       |
| sanitize-data             | `narduk-enterprises/sanitize-data`             | Baseline; analytics, auth, SEO                                 | Command snapshot                                                                                                     | Pending                                                               | Pending                                                                                                                      | Pending                                                  | Pending                                | inventory       |
| spacex-ipo                | `narduk-enterprises/spacex-ipo`                | Baseline; analytics, SEO                                       | Command snapshot                                                                                                     | Pending                                                               | Pending                                                                                                                      | Pending                                                  | Pending                                | inventory       |
| tprinvest                 | `narduk-enterprises-clients/tprinvest`         | Baseline; analytics, SEO                                       | Command snapshot; ownership correction verified                                                                      | Pending                                                               | Pending                                                                                                                      | Pending                                                  | Pending                                | inventory       |
| austin-texas-net          | `narduk-enterprises/austin-texas-net`          | Map/data; analytics, maps, SEO, ingestion audit                | Command snapshot; preserve Texas wrapper app-locally                                                                 | Pending                                                               | Pending; `narduk-data` gate applies                                                                                          | Pending                                                  | Pending                                | inventory       |
| bluebonnet-status-online  | `narduk-enterprises/bluebonnet-status-online`  | Map/data; analytics, auth, maps, SEO, uploads                  | Command snapshot                                                                                                     | Pending                                                               | Pending                                                                                                                      | Pending                                                  | Pending                                | inventory       |
| borderwaitstat-us         | `narduk-enterprises/borderwaitstat-us`         | Data/PWA; analytics, ingestion, PWA, SEO                       | Command snapshot                                                                                                     | Pending                                                               | `narduk-data` and 144-window gates pending                                                                                   | Two-release PWA cleanup/removal pending                  | Pending                                | inventory       |
| buoys                     | `narduk-enterprises/buoys`                     | Map/data/PWA; analytics, ingestion, maps, PWA, SEO             | Command snapshot                                                                                                     | Pending                                                               | `narduk-data` queue gates pending                                                                                            | Two-release PWA cleanup/removal pending                  | Pending                                | inventory       |
| float-forecast            | `narduk-enterprises/float-forecast`            | Map/data; analytics, maps, SEO, uploads                        | Command snapshot                                                                                                     | Pending                                                               | Pending                                                                                                                      | Pending                                                  | Pending                                | inventory       |
| lakestat-us               | `narduk-enterprises/lakestat-us`               | Map/data; analytics, auth, maps, SEO, uploads                  | Command snapshot                                                                                                     | Pending                                                               | Pending                                                                                                                      | Pending                                                  | Pending                                | inventory       |
| riverstatus               | `narduk-enterprises/riverstatus`               | Map/data; analytics, auth, maps, SEO, uploads; ingestion audit | Command snapshot                                                                                                     | Pending                                                               | `narduk-data` queue gates pending                                                                                            | Pending                                                  | Pending                                | inventory       |
| tx-spends                 | `narduk-enterprises/tx-spends`                 | AI; AI, analytics, auth, SEO                                   | Command snapshot                                                                                                     | Pending                                                               | Pending                                                                                                                      | AI proof pending                                         | Pending                                | inventory       |
| imessage-dictionary       | `narduk-incubator/imessage-dictionary`         | AI/operator; AI, analytics, auth, operator, SEO                | Command snapshot; ownership correction verified                                                                      | Pending                                                               | Pending                                                                                                                      | AI and app-local operator proof pending                  | Pending                                | inventory       |

### Deferred by owner: skip for now, not retired

These 20 repositories are intentionally excluded from the current migration
denominator and execution waves. No shutdown, archive, credential revocation, or
retirement work is authorized by this status. If a deferred repository still
exists when template archival is proposed, it must first be reactivated and
migrated or receive an explicit retirement decision.

| Repository / app         | Original cohort      | Deferred requirement retained for later                       | Status   |
| ------------------------ | -------------------- | ------------------------------------------------------------- | -------- |
| `gulf-fishing-report`    | Registry baseline    | Correct ownership to `narduk-incubator` before any later work | deferred |
| `harmony-hot-sauce`      | Registry baseline    | Canonical repository remains `narduk-enterprises-clients`     | deferred |
| `mindwalker`             | Registry baseline    | Re-audit capabilities when reactivated                        | deferred |
| `namegarden`             | Registry baseline    | Re-audit capabilities when reactivated                        | deferred |
| `nagolnagemluapleira`    | Registry baseline    | Re-audit capabilities when reactivated                        | deferred |
| `napkinbets`             | Registry baseline    | Correct ownership to `narduk-incubator` before any later work | deferred |
| `narduk-devtools`        | Registry baseline    | Re-audit capabilities when reactivated                        | deferred |
| `ogpreview-app-new`      | Registry baseline    | Repository remains `narduk-enterprises/ogpreview-app`         | deferred |
| `papa-everetts-pizza`    | Registry baseline    | Re-audit capabilities when reactivated                        | deferred |
| `boat-search`            | Registry map/data    | Canonical MapKit migration remains required if reactivated    | deferred |
| `coolmaps`               | Registry map/PWA     | Two-release PWA cleanup remains required if reactivated       | deferred |
| `myboat`                 | Registry map/data    | Public repository must use GitHub-hosted CI if reactivated    | deferred |
| `app-builder`            | Registry AI/operator | AI extraction and app-local operator work remain future scope | deferred |
| `circuit-breaker-online` | Additional audit     | Active/deployed status must be refreshed before reactivation  | deferred |
| `ai-media-gen`           | Additional AI audit  | `narduk-ai` migration remains required if retained            | deferred |
| `earthdata-viewer`       | Direct MapKit        | Rescue the Earthdata vendor cache before old-copy removal     | deferred |
| `narduk-earth-data`      | Direct MapKit        | Replace mutable Git dependency if reactivated                 | deferred |
| `rawenc-lab`             | Direct MapKit        | Replace the absolute tarball path if reactivated              | deferred |
| `gonogo-web`             | Direct MapKit        | Replace the Git URL dependency if reactivated                 | deferred |
| `gonogo`                 | Direct MapKit        | Preserve the intentional app-owned `200` token fallback       | deferred |

### Additional retain/audit repositories

| Repository                | Required result                                                               | PR / deploy / zero-reference evidence                                                                                                                                                        | Status            |
| ------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| `narduk-control`          | Read-only inventory and proof with no Command API or D1 dependency            | PR #1 merged at `b4af3a6`; Cloudflare version `bfcf877e-e29c-4827-b951-43e315f276af`; health `200`; protected inventory route `401` without operator login; authenticated body proof pending | production-proved |
| canonical `narduk-charts` | Retain canonical repository; distinguish from old `narduk-enterprises/charts` | Pending                                                                                                                                                                                      | inventory         |

### Discovered deployed surfaces already decoupled

These were not in the Command registry. The 2026-07-14 audit found live
deployment evidence and zero functional template markers or Narduk package
dependencies at current HEAD. They remain in the ledger so the final survivor
scan cannot silently omit them. `passage-map` is distinct from the retired
`sailing-passage-map`; `wheat-data` and `gonogo-api` are data/API services
rather than Nuxt fleet apps.

| Repository                         | Production evidence                                           | Zero-reference evidence     | Status            |
| ---------------------------------- | ------------------------------------------------------------- | --------------------------- | ----------------- |
| `loganrenz/austin-rising-runners`  | Workers Builds success; Workers route returned 200            | Current remote HEAD audited | production-proved |
| `loganrenz/about-me`               | Workers route returned 200                                    | Current remote HEAD audited | production-proved |
| `loganrenz/caminoreal`             | `caminoreal.nard.uk` returned 200                             | Current remote HEAD audited | production-proved |
| `loganrenz/family.nard.uk`         | `family.nard.uk` returned 200                                 | Current remote HEAD audited | production-proved |
| `loganrenz/gonogo-api`             | Deployed JSON handler and four configured crons               | Current remote HEAD audited | production-proved |
| `loganrenz/software-delivery`      | Custom route returned 200                                     | Current remote HEAD audited | production-proved |
| `loganrenz/wheat-data`             | Two Workers and configured routes/crons; catalog returned 200 | Current remote HEAD audited | production-proved |
| `narduk-enterprises/marketing-web` | Two custom domains returned 200                               | Current remote HEAD audited | production-proved |
| `narduk-enterprises/pnl`           | Custom route and Workers route returned 200                   | Current remote HEAD audited | production-proved |
| `narduk-incubator/passage-map`     | D2 API health returned 200 with database connected            | Current remote HEAD audited | production-proved |

### Direct MapKit consumers

The only direct consumer in the current program migrates independently of the
Nuxt fleet. It requires exact package versions, removal of mutable Git coupling,
build/test proof, and map/token/search/geocode runtime proof. The other five
known direct consumers are in the deferred table above.

| Consumer   | Current coupling                                                                                        | Package PR + pins                                                                                                                                                   | Runtime proof                                                                                                                                                                                                                                           | Old-copy removal                                                                                                     | Status               |
| ---------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | -------------------- |
| `hydrogen` | PR #15 used an outdated `main` base and was rolled back; the newer UI/data history is the recovery base | [Recovery PR #16](https://github.com/loganrenz/hydrogen/pull/16); exact `@narduk-geo/narduk-mapkit@1.0.0`, using `/worker` and `/client` with one token-route owner | Pre-cutover Worker versions were restored, `h2.nard.uk` was reassigned to `hydrogen-web`, and production health/home/map/token checks returned 200 with MapKit markers rendered. Exact-head CI and the corrected production deployment remain required. | Local recovery tree has zero old scope, mutable Git, tarball, or copied-source refs; production confirmation remains | recovery in progress |

### Retire and preserve history

For every row: disable deployments/workflows/triggers, preserve unique code and
data, revoke credentials, record backup checksums where applicable, and archive
repository history. Do not unpublish packages or delete tags. Command is not a
current retirement target; its original archive checklist is preserved as the
deferred follow-on in section 9.

| Repository or asset                               | Special requirement                                                                     | Retirement evidence | Status    |
| ------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------- | --------- |
| `narduk-template`                                 | Cannot archive before `narduk-data` and fleet gates                                     | Pending             | frozen    |
| `narduk-template-smoke-app`                       | Replace with `narduk-libs` consumer fixtures                                            | Pending             | inventory |
| old `narduk-enterprises/charts`                   | Preserve canonical `narduk-charts` first                                                | Pending             | inventory |
| `narduk-incubator/control-plane`                  | No replacement control plane                                                            | Pending             | inventory |
| `grib-viewer`                                     | Preserve unique code/data                                                               | Pending             | inventory |
| `fyooru`                                          | Preserve unique code/data                                                               | Pending             | inventory |
| old standalone `narduk-ai`                        | Preserve unique work after `narduk-libs` AI parity                                      | Pending             | inventory |
| `neon-sewer-raid`                                 | Preserve unique code/data                                                               | Pending             | inventory |
| `paul`                                            | Preserve unique code/data                                                               | Pending             | inventory |
| `sailing-passage-map`                             | Preserve unique code/data                                                               | Pending             | inventory |
| `scorchin-tims`                                   | Preserve unique code/data                                                               | Pending             | inventory |
| `stockpick-test`                                  | Preserve unique code/data                                                               | Pending             | inventory |
| `video-grab`                                      | Preserve unique code/data                                                               | Pending             | inventory |
| `wan-video-review`                                | Preserve unique code/data                                                               | Pending             | inventory |
| stale `/Users/narduk/code/narduk-mapkit` checkout | Rescue unique vector-overlay/cache work and wait for all consumers to leave its tarball | Pending             | inventory |
| duplicate `narduk-incubator/harmony-hot-sauce`    | Compare with canonical client repository, preserve unique work, then archive            | Pending             | inventory |
| duplicate `narduk-incubator/myboat`               | Compare with canonical public repository, preserve unique work, then archive            | Pending             | inventory |
| stale `narduk-incubator/narduk-auth` deployment   | Resolve Pages 503 / Worker 1042 resources and archive or explicitly retain              | Pending             | inventory |

Any newly discovered deployed app defaults to migration review; the owner may
explicitly move it to the deferred table. Any newly discovered non-deployed
repository outside the keep list defaults to retirement review after preserving
unique code and data. Neither default authorizes shutdown without a recorded
disposition.

## 5. Execution waves

### Wave 0 — freeze and establish truth

- Land this document and ledger in `narduk-libs`; mark PR #454 superseded.
- Freeze template and Command feature work. Permit only critical security fixes
  and migration unblockers. This freeze does not disable or archive Command.
- For every current-scope app, refresh all evidence fields listed in section 3
  using fresh worktrees from current remotes.
- Export Command registry, operation history, and audit history with checksums.
  Check the redacted artifact into `narduk-control` and prove its GET-only
  inventory route. Never base decisions on a missing, dirty, stale, or unborn
  checkout.

### Wave 1 — independent foundations

- Add frozen-install CI and independent release automation to `narduk-libs`:
  lint, typecheck, tests, `publint`, pack, tarball-only Nuxt/Worker fixtures,
  database compilation, publication proof, and rollback instructions.
- Make `narduk-libs` the sole `narduk-platform` publisher.
- Publish immutable `narduk-app-tools`, `narduk-testkit`, `narduk-ai`, and
  `create-narduk-app` versions.
- Implement the stable migration ledger and physical-schema legacy adoption.
- Neutralize `narduk-platform`; remove core's provision/template dependency and
  core manifest injection.
- Complete and publish both canonical MapKit packages.
- Prove the generator and onboarding skill with a disposable app containing no
  template or Command references.
- Publish the final compatibility CLI release.

### Wave 2 — Been Sober For reference cutover

Start from current `main`. Do not merge the historical
`bsf/narduk-libs-packages` branch.

The reference pilot is complete only when it:

- installs shared packages from immutable registries, never workspaces, Git, or
  local tarballs;
- owns direct scripts, CI, Playwright, Renovate, Worker config, migration source
  config, and runtime config;
- removes `.template-reference`, `.template-version`, `narduk.layout.json`,
  `guardrail-exceptions.json`, `scripts/narduk-toolchain.mjs`, template
  workflows, and `narduk-cli`;
- removes `#layer` and synthetic ORM aliases;
- adopts the stable ledger and proves a second migration run is empty;
- passes quality, unit, integration, browser, auth, local D1, staging Worker,
  and production-route checks; and
- produces the reusable migration PR checklist from actual changes.

### Wave 3 — baseline fleet

Migrate the 11 current-scope baseline apps in small parallel cohorts, one
reviewed PR and one production proof per app. The other nine baseline apps are
deferred in section 4. Before removing template workflows, install meaningful
app-owned PR CI, materialize Playwright config loaded from
`.template-reference`, enable independent Renovate updates for
`@narduk-enterprises/*`, confirm registry auth on the selected runner, and
preserve Workers Builds as the `main` deployment owner.

### Wave 4 — MapKit, AI, and operator consumers

- Move every current-scope fleet MapKit consumer and `hydrogen` to canonical
  immutable releases. The five other direct consumers and three deferred fleet
  map apps remain untouched for now.
- Preserve Austin's Texas-specific wrapper as app-owned code.
- Verify rendering, token generation, Apple search/geocode, origin allowlists,
  rate limiting, and Worker binding hydration.
- Move TX Spends and iMessage Dictionary to `narduk-ai`. App Builder and AI
  Media Gen are deferred for now.
- Keep `system_prompts` migration ownership in core; AI routes use its explicit
  schema export.
- Copy only used operator primitives into surviving apps and remove the operator
  dependency.

### Wave 5 — PWA removal

For BorderWaitStat.us and Buoys:

1. Ship a cleanup release that unregisters only that app's known legacy
   service-worker registration and deletes only its known caches.
2. Prove existing installations adopted the cleanup release.
3. Ship a removal release deleting PWA modules, install/update UI, offline
   routes/pages, manifest injection, and service-worker assets.

No PWA package is created. Coolmaps is deferred; if reactivated, it follows the
same two-release sequence.

### Wave 6 — `narduk-data` and ingestion cutover

The frozen ingestion dependency remains until every section 8 acceptance gate is
green. Only then remove ingestion dependencies and migrations from
BorderWaitStat.us, Austin, Buoys, and Riverstatus.

### Wave 7 — template decommission

Complete the template prerequisites in section 9. Template is tagged and
archived only after the fleet zero-reference and `narduk-data` gates are green.
Command shutdown, its recovery window, resource removal, and repository archive
are explicitly deferred and do not count toward completion of this wave or the
current overall program.

## 6. Per-app migration playbook

1. Create an isolated worktree from current remote `main`; record the baseline
   SHA, live deployment, routes, resources, D1 recovery point, ledgers, and
   schema.
2. Install exact published package versions. Never use a workspace, mutable Git
   ref, or local tarball for migration completion.
3. Materialize app-owned CI, Renovate, Playwright/Vitest, direct scripts,
   `wrangler.jsonc`, `nuxt.config.ts`, `narduk.capabilities`, and
   `migrations.sources.json`.
4. Replace aliases and package surfaces. Remove only capabilities whose
   replacement or retirement gate is green.
5. Run frozen install, format, lint, typecheck, unit, integration, production
   build, and app-specific browser tests.
6. Run local migrations twice and preserve proof that the second run is empty.
   Rehearse on a production copy before remote application.
7. Open one reviewed PR. After merge, let Workers Builds deploy `main`, verify
   the deployed SHA, and test health, public pages, auth, mutations, cron, maps,
   AI, and app-specific critical flows.
8. Update this ledger with the PR, pins, build/deployment ID, route proof,
   migration proof, zero-reference output, rollback pins, and reviewer. Do not
   mark the app complete while any evidence field is pending.

## 7. Package and app verification

### Per-package gates

- clean install from packed or published artifacts outside the monorepo;
- Nuxt production build and Cloudflare Worker build;
- export checks and zero-warning `publint`;
- exact dependency graph with no duplicate core/auth versions;
- migration collision, checksum drift, legacy adoption, ordering, and
  idempotency tests;
- MapKit token/search/geocode and visual fixtures;
- AI route, model selection, prompt resolution, and authorization tests;
- testkit Vitest and Playwright consumer fixtures; and
- generated-app install, quality, test, build, migration, and deploy-dry-run.

### Per-app acceptance and rollback

- Capture production baseline and D1 recovery state before changes.
- Apply remote migrations only after production-copy rehearsal.
- Keep database changes additive and package versions exact.
- Roll back code by reverting the app PR and restoring prior immutable pins.
  Database correction is forward-only; never reset a remote database.
- A rollback does not reintroduce a template layer after the app's cutover.
- Completion requires the canonical ledger evidence described in section 3.

## 8. `narduk-data` acceptance gate

The future service must provide all of the following before any ingestion layer
is removed:

### Current readiness baseline — 2026-07-14

No `narduk-data` repository exists under `narduk-enterprises`, `narduk-geo`, or
`loganrenz`. The intended canonical home is `narduk-enterprises/narduk-data`,
checked out at `/Users/narduk/code/narduk-enterprises/narduk-data`. It should
extract the generic job, identity, lifecycle, queue, and adapter contracts from
`narduk-geo/geo-infrastructure`; Earth-data and raster-specific processing stays
in `narduk-geo`, and application persistence schemas and sinks stay app-owned.

The audit used fresh remote revisions `f4aa330` (BorderWait), `d4af9a2`
(Austin), `372c2ac` (Buoys), `b62daa4` (Riverstatus), `d07d6f4` (template), and
`03c025e` (`geo-infrastructure`) plus read-only production ledgers. It made no
repository, provider, schedule, credential, or database mutation.

| Consumer          | Current production finding                                                                                                                                                                                                                                                                                                                                        | Gate consequence                                                                                             |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| BorderWaitStat.us | The latest 144 expected ten-minute windows contain 143 successes and one upstream CBP `504` at `2026-07-14T04:10:06Z`; the next run recovered. Production has the sequential five-row D1-safe write, while current remote `main` still has unsafe concurrent 60-row writes and [PR #4](https://github.com/narduk-enterprises/borderwaitstat-us/pull/4) conflicts. | The locked 144-window gate fails. Recreate the sequential-write patch on current `main` before shadow proof. |
| Austin            | The shared ledger has 5,752 `queued`, 13 `error`, and only 23 `success` rows, with no success after May 15. Live AQI bypasses the ledger; stored water/lake data is stale.                                                                                                                                                                                        | Scheduler and queue ownership are unhealthy and the backlog must be reconciled before replay.                |
| Buoys             | The shared ledger has 30,976 `queued`, 2,629 `running`, 51 `error`, and 16,406 `success` rows. The separate history queue is healthier but still has failed and stale items, sends before its state update, and has no orphan repair.                                                                                                                             | Split ledgers, nondeterministic backfill IDs, and missing repair prevent cutover.                            |
| Riverstatus       | The shared ledger has 3,258 `queued`, 34 `running`, 124 `error`, 13 legacy `failed`, 7 `skipped`, and 891 `success` rows; the last shared success is May 15. Current observations are also written with `sync_run_id IS NULL` by request-time refreshes.                                                                                                          | There are multiple untracked writers and no single-owner cadence.                                            |

Austin, Buoys' realtime path, and Riverstatus use custom consumers instead of
the template's retry-safe wrapper. Each can mark a run `error`, request
redelivery, then acknowledge that redelivery because the row is no longer
`queued`. The replacement must preserve the generic wrapper's transition back to
`queued` before retry and prove exhausted-DLQ behavior. Stable source evidence:

- [Austin consumer at `d4af9a2`](https://github.com/narduk-enterprises/austin-texas-net/blob/d4af9a2f7262637f9e7c4b6c0f5a5caa220c53d4/apps/web/server/plugins/ingestion.ts#L117)
- [Buoys consumer at `372c2ac`](https://github.com/narduk-enterprises/buoys/blob/372c2aca95b4daf68b77cf8f2c1c53e19e8ec562/apps/web/server/plugins/noaa-ingestion.ts#L82)
- [Riverstatus consumer at `b62daa4`](https://github.com/narduk-enterprises/riverstatus/blob/b62daa41a4793a160935ccb82dff14d209d25fb8/apps/web/server/plugins/riverstatus-ingestion.ts#L80)

`geo-infrastructure` is source material, not a production-ready substitute. It
has Dagster/Postgres orchestration, a public-data registry, first-party
adapters, retry policies, and immutable Earth-data publication. Its non-daily
jobs use a static `bootstrap` partition and Sunday schedules, its public-data
schedules are stopped, it has no app sink or legacy-ledger contract, and its
control host could not reach the builder code server during the audit. See the
[partition/schedule implementation](https://github.com/narduk-geo/geo-infrastructure/blob/03c025e8bca1e5153333e035f91270b6e9fb8482/dagster_code/public_data_jobs.py#L20)
and
[readiness limitations](https://github.com/narduk-geo/geo-infrastructure/blob/03c025e8bca1e5153333e035f91270b6e9fb8482/docs/dagster/public-data-readiness.md#L31).

### Required service contract

- stable job/source IDs and versioned schedules;
- idempotency by job, trigger, cron, and scheduled timestamp;
- stable run IDs available to app persistence;
- authenticated manual and external triggers;
- `queued`, `running`, `success`, `error`, and `skipped` lifecycle states;
- counters, metadata, results, timestamps, errors, run listing, health, and
  staleness;
- a concrete request-scoped binding or signed callback/data-sink contract for
  app-owned persistence;
- explicit import or read-only archival of `narduk_ingestion_runs`;
- Queue messages, `202` enqueue semantics, retries, DLQ, attempt tracking,
  parent/child rollups, concurrency control, and orphan repair for Austin,
  Buoys, and Riverstatus.

Production proof must include:

1. staging or shadow output parity without double writes;
2. duplicate delivery producing one logical run;
3. an injected source failure recorded correctly and a successful next run;
4. BorderWait completing 144 consecutive expected ten-minute windows without
   missed or duplicate product writes;
5. queue consumers passing retry, exhausted-DLQ, rollup, and repair scenarios;
   and
6. cutover disabling the old plugin/cron before enabling the new scheduler and
   proving exactly one owner for a full cadence.

`narduk-data` is a hard predecessor of final template archive. It is not a
reason to delay unrelated package or app migrations.

### Current acceptance matrix

`Partial`, `unproven`, and `fail` are all blocking results.

| Locked gate                                                                 | Current result | Evidence summary                                                                                                |
| --------------------------------------------------------------------------- | -------------- | --------------------------------------------------------------------------------------------------------------- |
| Stable job/source IDs and versioned schedules                               | Partial        | IDs exist; schedules are not versioned and Dagster cadences do not match the apps.                              |
| Idempotency by job, trigger, cron, and scheduled timestamp                  | Partial        | The shared outer ledger provides it; several domain writes and Buoys history do not.                            |
| Stable run IDs available to app persistence                                 | Fail           | BorderWait passes; Austin is inconsistent, Buoys is split, and Riverstatus creates unrelated inner or null IDs. |
| Authenticated manual/external triggers                                      | Partial        | Existing app routes are protected; no cross-service trigger contract exists.                                    |
| Required lifecycle states                                                   | Partial        | The shared ledger has them; app sub-ledgers are incompatible or incomplete.                                     |
| Counters, metadata, results, timestamps, errors, listing, health, staleness | Partial        | Fields exist, but no authoritative service API or uniform freshness behavior exists.                            |
| Request-scoped binding or signed callback/data sink                         | Fail           | No cross-service app persistence contract exists.                                                               |
| Import or read-only archive of `narduk_ingestion_runs`                      | Fail           | No design or implementation exists.                                                                             |
| Queue messages, `202`, retry, DLQ, attempts, rollups, concurrency, repair   | Fail           | Custom consumers bypass safe retry and production backlogs are unresolved.                                      |
| Shadow parity without double writes                                         | Fail           | No replacement shadow environment exists.                                                                       |
| Duplicate delivery produces one logical run                                 | Unproven       | Outer-ledger unit dedupe exists; domain-write production proof does not.                                        |
| Injected failure records and the next run recovers                          | Unproven       | A natural BorderWait failure recovered, but no controlled injection test exists.                                |
| BorderWait 144 consecutive expected windows                                 | Fail           | The audited window is 143 successes plus one upstream `504`.                                                    |
| Retry, exhausted-DLQ, rollup, and repair scenarios                          | Fail           | Generic unit helpers exist; deployed consumers and ledgers fail the gate.                                       |
| Exactly one owner for a full cadence                                        | Fail           | No cutover exists; Riverstatus demonstrably has request-time and scheduler writers.                             |

### Required next actions

1. Create `narduk-enterprises/narduk-data` as the canonical replacement service;
   do not put it in `narduk-geo` or `narduk-libs`.
2. Port the generic identity, lifecycle, queue, health, and repair contracts and
   their tests without creating a transitional Nuxt library.
3. Add versioned schedules, authenticated triggers, concrete app sink contracts,
   and a read-only importer/archive for existing package ledgers.
4. Repair or replace all three custom queue consumers, then reconcile existing
   queued/running rows before resending any message.
5. Recreate the BorderWait D1-safe sequential-write fix from current `main`.
6. Run every matrix gate in shadow, then disable the old owner immediately
   before enabling the new one and prove a single owner for a full cadence.

## 9. Template retirement gate and deferred Command follow-on

### Template archive prerequisites — current program

- Every current-scope migration row is `complete` in section 4 and passes
  section 10; already-decoupled surfaces retain current production and
  zero-reference proof.
- Every repository currently marked `deferred` has either been reactivated and
  completed or received an explicit retirement decision with preservation
  evidence.
- No package is published from the template.
- Old packages have deprecation notices that point to replacements.
- Release dispatches from `narduk-skills`, ESLint config, and other repositories
  no longer notify the template.
- Template workflows and deployments are disabled.
- The final state is tagged and the repository is archived read-only.

### Deferred follow-on — Command archive prerequisites (not a current gate)

Command remains operational for now. Migrated apps still remove all functional
Command coupling, but the actions below are not authorized as part of the
current phase and are excluded from overall program progress. This checklist is
preserved intact for a later explicit shutdown decision:

- Every keeper app has app-owned CI, Renovate, configuration, and deployment
  proof.
- No live workflow or deployment calls Command or either template repository.
- `narduk-control` proves live inventory without Command APIs or D1.
- OAuth callbacks, CORS, Apple/Supabase settings, links, and callers no longer
  reference `command.nard.uk`.
- Command schedules, callbacks, leases, dispatch credentials, mutation
  endpoints, and registry mutation are disabled.
- Command-only credentials are revoked.
- Worker, D1, KV, and R2 data is backed up and checksummed.
- Command routes are disabled and resources are retained for a 30-day recovery
  window, then removed.
- The repository is archived read-only with history retained.

## 10. Final zero-reference gate

For current per-app completion, searches cover each current-scope repository and
workflow. Before template archival, the same search covers every repository that
will remain active, including any repository that was deferred and later
retained. Searches must return no functional references to:

- `narduk-template`
- `narduk-nuxt-template`
- `narduk-fleet`
- `narduk-cli`
- `narduk-starter-toolkit`
- `narduk-nuxt-module`
- `narduk-nuxt-template-layer-*`
- `.template-reference`
- `.template-version`
- `narduk.layout.json`
- `guardrail-exceptions.json`
- `scripts/narduk-toolchain.mjs`
- `provision.json`
- `#layer`
- synthetic `#server/app-orm-tables` or `#server/core-orm-tables`
- Command callbacks, leases, registry mutation endpoints, or workflow dispatches

Archived repository history and this deprecation document may retain textual
references. Archived repositories must have no active deployment, trigger,
workflow, route, or credential. The operational Command repository itself is
excluded while its shutdown remains deferred; migrated apps and their workflows
are not exempt from removing Command coupling.

Example functional scan, excluding this document and Git history:

```sh
git grep -n -E \
  -e 'narduk-template|narduk-nuxt-template|narduk-fleet|narduk-cli|narduk-starter-toolkit|narduk-nuxt-module|narduk-nuxt-template-layer-|\.template-reference|\.template-version|narduk\.layout\.json|guardrail-exceptions\.json|scripts/narduk-toolchain\.mjs|provision\.json|#layer|#server/(app|core)-orm-tables' \
  -- . ':!docs/architecture/narduk-template-decommission.md'
```

Exit status `1` with no output is the passing zero-match result. Any matches or
an exit status other than `1` require review.

Command-specific callbacks, leases, registry mutation endpoints, dispatches,
URLs, and provider settings require semantic inspection in addition to string
search.

## 11. Ledger maintenance and completion rules

- Update a row in the same PR that changes its evidence whenever possible.
- Link immutable GitHub PR/run/deployment evidence; do not paste secret values.
- Record secret names only. Resource IDs are allowed; credentials are not.
- A worker report is not proof. The reviewer reruns the relevant gate on the
  exact commit and deployed SHA.
- If a production proof fails, set the row to `blocked`, preserve the evidence,
  revert code to prior pins, and use a forward database correction if needed.
- Template archival is a separately reviewed operation against sections 8–10. A
  green library build, a merged migration PR, or elapsed time alone is never
  sufficient. Command archival remains a separate deferred decision.
