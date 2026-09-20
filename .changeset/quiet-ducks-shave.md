---
'@narduk-enterprises/narduk-app-tools': minor
'@narduk-enterprises/create-narduk-app': patch
---

Declare who owns each D1 schema: `deployment.databaseOwnership`

`deployment.migrations` had to cover **every** D1 binding exactly once, which is
right for a database whose schema is its migration history and wrong for one
whose schema is owned by a contract and applied by a refresh job. The only way
such an app could declare migrations for the rest of its estate was to
manufacture a migration baseline for a database nobody migrates -- a false claim
that the ledger describes that schema.

`Config/cloudflare-app.json`'s deployment block now accepts an optional
`databaseOwnership` array giving every binding exactly one owner: `migrations`
(resolving to an entry in `deployment.migrations.databases`) or `contract`
(naming the schema contract file and the package script that proves it). Absent,
nothing changes -- an app that migrates everything keeps working with no config
edit.

The load-bearing part is at the runner, not the validator: `migrationDatabase()`
is the single function every migration path uses to reach D1, and it refuses a
contract-owned binding before any provider call.
`db migrate --database READ_MODEL`, `db status`, `db migrate-deployment`,
baseline capture and baseline registration are all refused, as is a wrangler
config pointing another binding name at the contract-owned database id. The
contract-owned database is also absent from the minimal wrangler config the
deployment runner is handed.

`foundation:check:deployment` sub-check 12.8 now applies the same coverage rule
from the same implementation -- a contract-owned binding passes without a source
manifest, while an uncovered or doubly-owned binding still fails -- and
`doctor --adoption` requirement 6 reads that sub-check.
