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
pnpm dlx @narduk-enterprises/create-narduk-app@0.6.1 harbor-notes \
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
