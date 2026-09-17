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
pnpm dlx @narduk-enterprises/create-narduk-app@0.6.2 harbor-notes \
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
