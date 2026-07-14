# @narduk-enterprises/narduk-app-tools

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
      "source": "@narduk-enterprises/narduk-core",
      "directory": "node_modules/@narduk-enterprises/narduk-core/runtime/drizzle",
      "sourceVersion": "1.0.0"
    },
    {
      "source": "app",
      "directory": "apps/web/drizzle",
      "sourceVersion": "0.1.0"
    }
  ],
  "adoptions": []
}
```

Package sources are applied before `app`. The ledger uses `(source, filename)`
as its primary key and stores the SHA-256 SQL checksum. Existing ambiguous rows
are refused unless an adoption entry names the exact target checksum and proves
the expected schema tables/columns.

The command never writes secret files. Registry auth writes the requested
`.npmrc.auth` path and scopes GitHub Packages only to `@narduk-enterprises`;
`@loganrenz` remains on the public npm registry.
