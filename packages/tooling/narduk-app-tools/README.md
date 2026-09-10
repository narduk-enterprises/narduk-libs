# @narduk-enterprises/narduk-app-tools

## Social preview checks

`narduk-app og:generate` renders an app-owned default share image.
`narduk-app og:check` validates the default and route inventory; add `--live` to
verify actual server-rendered metadata and downloaded images as crawlers. New
app scaffolds wire these into builds and browser CI. Existing apps adopt them
using the [social preview guide](docs/social-previews.md).

Focused app-local tooling exposed as `narduk-app`. It operates on the current
application only: local development, source-owned D1 migrations, guarded
Wrangler deployment, registry authentication, diagnostics, performance budgets,
and favicon assets.

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
