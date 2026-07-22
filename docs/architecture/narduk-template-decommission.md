---
status: superseded
owner: Logan Renz
decision_date: 2026-07-21
supersedes:
  docs/architecture/narduk-template-decommission.md (this file's own prior
  831-line content)
---

# Narduk template decommission — program ledger moved

The full cross-repo, ~40-repo narduk-template decoupling and decommission
program ledger (fleet scope, per-app migration rows, execution waves, the
`narduk-data` acceptance gate, and the deferred Command shutdown checklist)
moved out of this repository to
[`narduk-enterprises/company-hq/untangle/narduk-template-decommission-ledger.md`](https://github.com/narduk-enterprises/company-hq/blob/main/untangle/narduk-template-decommission-ledger.md),
per the Wave 1a boundary-cut charter
([`PLATFORM-CHARTERS.md` §2, row M10](https://github.com/narduk-enterprises/company-hq/blob/main/untangle/wave1/PLATFORM-CHARTERS.md)):
the ledger is cross-repo, gate-driven governance — the same artifact class as
`TRACKER.yaml` — not package documentation, even though `narduk-libs` remains
the packaging-workstream executor for the program. Use the `company-hq` copy for
fleet scope, per-app status, wave sequencing, and the `narduk-data` readiness
gate; use this file only for the package-extraction scope that stays owned here.

## narduk-libs package-extraction rows

The following is extracted from the moved ledger's own text (source line
references are to the ledger as it stood in this repository before the M10 move)
because it defines `narduk-libs`'s own package-ownership boundary and extraction
work, independent of the fleet's per-app migration program.

### Shared capability disposition (target architecture)

| Existing surface                                     | Final owner and disposition                                                                                                                                                                                                                                                                                             |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Core, auth, analytics, SEO, uploads, runtime helpers | Keep `@narduk-enterprises/narduk-app`, `narduk-core`, `narduk-auth`, `narduk-analytics`, `narduk-seo`, and `narduk-uploads` in `narduk-libs`. Preserve current behavior during migration.                                                                                                                               |
| `narduk-platform`                                    | `narduk-libs` is its sole publisher immediately. Retain only neutral environment, onboarding, and provider contracts. Remove layer manifests, starter composition, Command origins, `CONTROL_PLANE_URL`, and `templateManaged` behavior.                                                                                |
| AI layer                                             | Add `@narduk-enterprises/narduk-ai` in `narduk-libs`, exposing existing xAI helpers, model catalog, prompt resolution, admin composable/component, and optional Nuxt route registration. The already-published `system_prompts` schema and migration remain in `narduk-core`; do not create another baseline migration. |
| Testing layer                                        | Add dev-only `@narduk-enterprises/narduk-testkit` with reusable Vitest factories, Playwright fixtures/contracts, visual-audit helpers, and analyzer. Apps own test configuration and discovery wrappers.                                                                                                                |
| Template testing/smoke app                           | Replace it with packed package-consumer fixtures in `narduk-libs`, then retire the smoke repository.                                                                                                                                                                                                                    |

`narduk-core` remains the v1 compatibility facade during the migration. Further
decomposition is allowed later and cannot block template retirement. Before the
final gate, internal `#layer` imports and broad compatibility aliases must be
gone — see the open `#layer` backlog note below.

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
`apps/web/migrations.sources.json`, `narduk-app db migrate` uses
`_narduk_migrations` with primary key `(source, filename)` and stores checksum,
source version, and application timestamp. Explicit source IDs, not paths,
define identity. Package sources run before app sources; a second run is empty;
checksum drift fails closed.

Alias target:

- Keep Nuxt's native `#server/*` alias for concrete app files.
- Replace synthetic `#server/app-orm-tables` and `#server/core-orm-tables` with
  one app-owned dialect selector, `#narduk-db`.
- Replace app `#layer/server/*` imports with explicit package subpaths.
- Package-private dynamic aliases become `#narduk-core/schema` and
  `#narduk-core/postgres-runtime`.
- Final searches for `#layer` and synthetic ORM aliases return zero in every
  surviving repository.

### New-app contract

Add `@narduk-enterprises/create-narduk-app` in `narduk-libs` with binary
`create-narduk-app` and API
`createNardukApp(options): Promise<CreateNardukAppReport>`. Core is implicit.
`pwa` is rejected as retired. `ingestion` is rejected with guidance to
`narduk-data`; a future `data` capability may be added only after that service
is production-ready.

The generator creates a deterministic pnpm workspace with `apps/web`, exact
package versions, direct scripts, app-owned CI, Renovate, Playwright/Vitest,
Worker config, migrations, docs, and explicit Nuxt modules. It may initialize
local Git but performs no GitHub, Cloudflare, or Doppler mutation. It never
creates template metadata, toolchain wrappers, sync workflows, Command payloads,
service workers, or generic ingestion files.

The `create-narduk-app` skill in `narduk-skills` owns idempotent GitHub,
Proxmox-runner, Cloudflare, Doppler, Workers Builds, migration, deployment, and
live-proof steps. It never calls Command and never creates a continuing registry
relationship.

### Wave 1 — independent foundations (execution wave, narduk-libs scope)

- Add frozen-install CI and independent release automation to `narduk-libs`:
  lint, typecheck, tests, `publint`, pack, tarball-only Nuxt/Worker fixtures,
  database compilation, publication proof, and rollback instructions.
- Make `narduk-libs` the sole `narduk-platform` publisher.
- Publish immutable `narduk-app-tools`, `narduk-testkit`, `narduk-ai`, and
  `create-narduk-app` versions.
- Implement the stable migration ledger and physical-schema legacy adoption.
- Neutralize `narduk-platform`; remove core's provision/template dependency and
  core manifest injection.
- Prove the generator and onboarding skill with a disposable app containing no
  template or Command references.
- Publish the final compatibility CLI release.

(MapKit canonicalization is tracked in the moved ledger — MapKit's canonical
home is `narduk-geo/narduk-mapkit`, not `narduk-libs`.)

### Package evidence (Wave 0/1, narduk-libs rows only)

| Evidence                 | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Independent package PR   | [narduk-libs PR #1](https://github.com/narduk-enterprises/narduk-libs/pull/1) contains independent release automation, app tools, stable migration journals, AI, testkit, deterministic scaffolding, neutralized Platform contracts, and canonical `#narduk-core/*` private database aliases. [CI run 29387638555](https://github.com/narduk-enterprises/narduk-libs/actions/runs/29387638555) passed at `a689507`, including full package quality, manifest and pack checks, and the external packed-consumer fixture with both GitHub Package scopes configured. Immutable internal-package publication remains a draft gate. |
| Generated consumer proof | The automated release gate packs all 11 artifacts, imports both Testkit runner families with native Node, executes the compiled Testkit CLI, runs the packed generator, mounts packed Core's `LayerAppHeader` to exercise color-mode SSR, proves exact pins and zero forbidden references, performs clean and frozen installs, format/lint/typecheck/unit/Knip, warning-free Nuxt/Cloudflare build, eight applied migrations plus an empty rerun, Playwright, performance budget, and Wrangler deploy dry-run; immutable published-registry proof remains pending.                                                              |
| Final CLI compatibility  | [narduk-template PR #458](https://github.com/narduk-enterprises/narduk-template/pull/458) is a blocked draft for `narduk-cli@1.28.74`; it delegates retained operations to exact app-tools/testkit releases and fails retired sync, fleet, Command, layout, path-migration, quality-wrapper, and secret-file commands with migration guidance; real-registry delegate proof remains pending.                                                                                                                                                                                                                                    |

### Per-package gates (package and app verification)

- clean install from packed or published artifacts outside the monorepo;
- Nuxt production build and Cloudflare Worker build;
- export checks and zero-warning `publint`;
- exact dependency graph with no duplicate core/auth versions;
- migration collision, checksum drift, legacy adoption, ordering, and
  idempotency tests;
- AI route, model selection, prompt resolution, and authorization tests;
- testkit Vitest and Playwright consumer fixtures; and
- generated-app install, quality, test, build, migration, and deploy-dry-run.

### Open internal backlog

`narduk-libs` still contains `#layer` aliases inside its own successor packages
(`packages/narduk-auth/server/utils/session-user.ts:1`,
`packages/narduk-core/src/module.ts:356-357,506`). This is internal F6 backlog
gating the decommission ledger's own zero-reference gate (see
[`PLATFORM-CHARTERS.md` §2](https://github.com/narduk-enterprises/company-hq/blob/main/untangle/wave1/PLATFORM-CHARTERS.md),
"Also noted, not moves").
