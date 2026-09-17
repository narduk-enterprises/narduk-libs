# @narduk-enterprises/create-narduk-app

Deterministic, filesystem-only generation of app-owned Narduk Nuxt workspaces.

```ts
import { createNardukApp } from '@narduk-enterprises/create-narduk-app'

await createNardukApp({
  appName: 'harbor-notes',
  capabilities: ['auth', 'seo'],
  targetDir: './harbor-notes',
  noGit: true,
})
```

The CLI is `create-narduk-app`:

```sh
pnpm dlx @narduk-enterprises/create-narduk-app@0.6.3 harbor-notes \
  --display-name='Harbor Notes' \
  --description='A harbor log.' \
  --site-url=https://harbor.example \
  --target-dir=/absolute/path/harbor-notes \
  --capabilities=auth,seo,analytics,uploads,ai,mapkit \
  --visibility=private \
  --local-dev-port=3011 \
  --json
```

## Database backend

Scaffolds carry a D1 database by default: a `DB` binding,
`server/database/schema.ts`, the `#narduk-db` alias, a first migration and the
`db:migrate:*` scripts.

`--no-database` (or `--database=none`) scaffolds an app with no database at all.
The generated `nuxt.config.ts` declares
`nardukCore: { databaseBackend: 'none' }`, so narduk-core's shared `/api/health`
reports `database: "not_applicable"` and stays `ok` instead of degrading a
publication-only app. No D1 binding, no schema, no migrations, no drizzle pins.
App-owned probes register with `registerHealthCheck` from
`@narduk-enterprises/narduk-core`.

The `auth` capability keeps users, sessions and API keys in the app database, so
it is rejected with `--no-database`. The generator scaffolds D1 only; an app
that needs Postgres scaffolds `d1` and declares `databaseBackend: 'postgres'`
with its Hyperdrive binding afterwards.

It supports `--force`, `--no-git`, and `--json`; it never mutates GitHub,
Cloudflare, Doppler, or package registries. The JSON report is returned to the
caller and is not persisted as scaffold metadata. Generated repositories commit
a non-secret `.npmrc` carrying only the `@narduk-enterprises/*` registry route.
Registry credentials are supplied through a temporary process-scoped userconfig.
The onboarding skill owns the first authenticated install and commits the
resulting frozen lockfile before CI is enabled.

Private generated apps use the pinned shared Nuxt CI workflow: lint, typecheck,
build, formatting, knip and unit tests run on `linux-ci`; the initial single
browser smoke runs on `playwright-isolated`, using its immutable toolchain. The
shared `ci / Required` aggregate covers both. Before enabling CI, onboard the
new repository into both selected-repository runner groups through fleet and
grant it access to the shared workflows. Generated route names do not grant
access, and the generator makes no GitHub or fleet API calls.

Public generated apps run every quality check on GitHub-hosted Ubuntu. Action
references are pinned, superseded runs cancel, jobs time out, and temporary
registry auth is removed even if installation fails. Existing generated apps
remain app-owned; generating a new version does not update them.

Generated CI uses three Chromium shards and one worker per shard for both
visibilities. Private apps call the pinned shared workflow with `linux-ci` and
`playwright-isolated`; public apps run every job on GitHub-hosted Ubuntu. The
public required aggregate accepts only successful static checks, all browser
shards and merged evidence. Failure screenshots, retry traces and retained
failure videos are attached to the reports. `quality:static` includes format,
lint, knip, typecheck, build and unit tests; `quality` adds browser tests.

## Keeping an app current: `create-narduk-app upgrade`

The generator scaffolds an app once. `upgrade` re-applies the small set of units
the generator still owns afterwards, as a reviewable diff, so an estate app
converges on the reference shape without anyone hand-copying files. It is
**not** a sync, reconcile or drift-control relationship with the app: nothing
runs on a schedule, nothing calls out to a registry or control plane, and
everything outside the table below is never read and never written.

```sh
# Dry run (the default). Prints a unified diff and exits 1 if anything drifted,
# so CI can run it as a check.
pnpm dlx @narduk-enterprises/create-narduk-app upgrade .

# Apply exactly what the dry run printed.
pnpm dlx @narduk-enterprises/create-narduk-app upgrade . --write

# One unit at a time, for a focused pull request.
pnpm dlx @narduk-enterprises/create-narduk-app upgrade . --only .github/dependabot.yml --write
```

`--json` prints the machine-readable report (`schemaVersion: 1`) instead of the
human summary. `--capabilities`, `--database`, `--local-dev-port` and
`--visibility` override the inferred profile; the profile itself is printed on
every run so a wrong reading is visible before `--write`.

### Ownership

| Path                                        | Owner                                   | What `upgrade` touches                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.github/workflows/ci.yml`                  | app, with one generator-owned pin       | Only the `narduk-enterprises/workflows/.github/workflows/nuxt-cloudflare.yml@<sha>` reference. The caller's inputs — shard count, e2e arguments, build artefact path — are the app's own policy and are never read.                                                                                                                                  |
| `.github/workflows/copilot-setup-steps.yml` | generator                               | The whole file. It is sandbox-prep infrastructure and carries no app-specific content by construction.                                                                                                                                                                                                                                               |
| `.github/dependabot.yml`                    | generator                               | The whole file. See the opt-out below before adopting this one in an app that has added its own `ignore` rules.                                                                                                                                                                                                                                      |
| `AGENTS.md`                                 | app, with one generator-owned region    | Only the text between `<!-- narduk:router:start -->` and `<!-- narduk:router:end -->`. The heading, the app's prose and every app-added section are never read.                                                                                                                                                                                      |
| `docs/e2e-testing.md`                       | app, with one generator-owned region    | Only the text between `<!-- narduk:e2e-policy:start -->` and `<!-- narduk:e2e-policy:end -->` — the flake policy and quarantine convention, which have one right answer for every app. The rest of the document describes the app's own specs and is never read.                                                                                     |
| `package.json` (root)                       | app, with generator-owned script bodies | Only the `scripts` entries `build:ci`, `foundation:check`, `manifests:validate`, and `db:migrate:local` / `db:migrate:remote` on an app with a database. Each is a contract with `narduk-app-tools` or with the Worker build shape. Every other key, every dependency, every version and the manifest's own key order are left exactly as they were. |
| everything else the generator emits         | app                                     | Nothing. `README.md`, `SPEC.md`, `CONTRACT.md`, `docs/`, `playwright.config.ts`, `apps/web/**` and the rest are **seeded**: written once at scaffold time, app-owned from then on, and never read by `upgrade`.                                                                                                                                      |

Two things are deliberately absent from that table, and running the codemod
against the reference app is what settled both. `playwright.config.ts` is not
managed at all: Buoys' own configuration is ahead of this template
(prebuilt-artefact web server, port resolution, list mode), so managing it would
have proposed a downgrade rather than an upgrade. `docs/e2e-testing.md` is
managed only as a region for the same reason — Buoys' copy documents its real
specs, and a whole-file rewrite would have handed it a document about a
different app. Dependency versions are absent too: Dependabot owns estate
package currency (company-hq `D-TOOLCHAIN-1`), and two mechanisms editing the
same lines is exactly the reconcile relationship this generator must not have.

### Opting a file out

Any managed file can be disowned by the app. Put `narduk:unmanaged` in a comment
in the file's first five lines, in that file's own comment syntax:

```yaml
# narduk:unmanaged
version: 2
```

`upgrade` then reports it as `unmanaged`, never rewrites it, and does not count
it as drift. This is the sanctioned home for an app-owned Dependabot rule — a
security exception's `ignore` entry (company-hq `NARDUK-APP-COMPLIANCE.md` §4)
or a documented app-specific pin — and the reason the dry run prints the line
count a whole-file rewrite would add and remove.

The region targets work the other way round: an existing app has no
`narduk:router` or `narduk:e2e-policy` markers, so those blocks are reported
`unmanaged` until someone adds the two marker lines around the paragraph or
section they should own. Apps generated from this version carry them already.

### How a narduk-app stays current

1. **Adopt the check.** Run `create-narduk-app upgrade .` in CI, or locally
   before a release. A non-zero exit means a managed unit has drifted.
2. **Read the diff before applying it.** The dry run is the review; `--write`
   applies exactly what it printed. Use `--only` to keep a pull request to one
   unit.
3. **Decide which side is right.** If the app is right and the template is
   stale, the fix lands _here_, in the generator, and the app adopts the next
   release — company-hq `NARDUK-APP-COMPLIANCE.md` §3.9, "shared behaviour is
   fixed upstream, never worked around in the app". If the app genuinely needs
   to differ, it opts the file out with a marker and records why.
4. **Re-run until clean.** `upgrade` is idempotent: a second `--write` writes
   nothing and a following dry run exits 0.

## Buoys-shape parity

Scaffolds match the reference app shape Buoys is being brought to
(narduk-enterprises/company-hq#745):

- `nuxt.config.ts` registers `@nuxt/icon` explicitly alongside
  `@narduk-enterprises/narduk-core`. Narduk UI nests its own `installModule`
  call for the Nuxt Icon client bundle, but that nested registration does not
  finish before the build step that consumes `#build/nuxt-icon-client-bundle`,
  so an app that omits the explicit module fails to build with
  `[UNLOADABLE_DEPENDENCY] Could not load .nuxt/nuxt-icon-client-bundle`.
- `apps/web/package.json` pins `nitro-cloudflare-dev` alongside the other
  build-critical devDependencies.
- `.github/workflows/copilot-setup-steps.yml` is generated for every visibility,
  with `concurrency` and a job `timeout-minutes`.
- `.github/dependabot.yml` groups npm and `github-actions` updates with a single
  `directory` per ecosystem.
- Root `package.json` carries `build:ci`, `foundation:check`, and
  `manifests:validate` scripts, plus the `@narduk-enterprises/narduk-app-tools`
  devDependency that backs them. `apps/web/scripts/validate-manifests.mjs` runs
  pre-deploy: it no-ops before `Config/cloudflare-app.json` exists
  (pre-onboarding) and otherwise fails the build when `apps/web/wrangler.jsonc`
  bindings disagree with the declared Cloudflare app config.
- `CONTRACT.md` and `docs/workers-builds.md` are generated alongside
  `README.md`/`AGENTS.md`, documenting the app's own health contract and its
  Cloudflare Workers Builds connection settings.
- `playwright.config.ts` splits a `setup` project (global auth/session
  bootstrap) from a `chromium` project that depends on it.
- `docs/e2e-testing.md` and `apps/web/tests/e2e/visual-audit.spec.ts` describe
  and exercise the generated Playwright layout. The visual-audit spec is a
  generic, one-route (`/`) skeleton built on narduk-testkit's
  `playwright/ui-quality` toolkit (`createConsoleTracker`,
  `captureFullPageAudit`, `captureNamedLocator`, `prepareUiQualityRoot`,
  `writeUiQualityManifest`) across mobile/tablet/desktop viewports, and asserts
  a clean console via `consoleTracker.expectClean()`. It intentionally does not
  replicate Buoys' own app-specific routes, selectors, or its
  wrapper-script/analyzer CLI infrastructure — those stay app-owned.

A freshly generated app is pre-onboarding: it has no
`Config/cloudflare-app.json` yet, so `pnpm run foundation:check` fails items 1.1
(nitro preset) and 1.2 (bindings mirrored) until onboarding populates that file.
This is expected and not a generator defect — `pnpm run build`,
`pnpm run build:ci`, and every other foundation:check item still pass or resolve
`N/A`/`UNKNOWN` cleanly.

## Workers Builds and previews

Workers Builds deploys protected `main`; enable non-production branch builds and
GitHub PR comments during onboarding so trusted PR branches receive preview
URLs. The generator emits the commands and explicit `workers_dev` /
`preview_urls` flags but never creates provider connections. Public apps enable
both flags. `--exposure authenticated` closes both for internal or authenticated
apps; selecting the `auth` capability defaults to that exposure and rejects
`--exposure public`. Repository `--visibility` is independent: a private
repository can serve a public app. Version previews share runtime bindings;
isolate private data and write-capable bindings before enabling them. Keep
previews noindex and analytics disabled.
