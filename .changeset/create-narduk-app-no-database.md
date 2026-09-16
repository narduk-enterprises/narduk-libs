---
'@narduk-enterprises/create-narduk-app': minor
---

Scaffold apps with no database.

`--no-database` (or `--database=none`, or `databaseBackend: 'none'` through the
API) generates an app that declares `nardukCore: { databaseBackend: 'none' }`,
so narduk-core's shared `/api/health` reports `database: "not_applicable"` and
stays `ok` rather than degrading a publication-only app.

- No D1 binding in `wrangler.jsonc`, no `server/database/schema.ts`, no
  `#narduk-db` alias, no `drizzle/` migrations and no `migrations.sources.json`.
- No `db:migrate:local` / `db:migrate:remote` scripts, and `cf:deploy` deploys
  without a migration step.
- `drizzle-orm` and `drizzle-kit` are left out of the generated manifests.
- The `auth` capability is rejected with no database, because sign-in stores
  users, sessions and API keys in the app database.
- The JSON report records the resolved `databaseBackend`.

The default stays D1, and a D1 scaffold is byte-identical to the previous
release.
