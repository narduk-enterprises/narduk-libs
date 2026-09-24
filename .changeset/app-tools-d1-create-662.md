---
'@narduk-enterprises/narduk-app-tools': minor
'@narduk-enterprises/create-narduk-app': patch
---

Add `narduk-app db create` and fail `foundation:check` on the placeholder D1 id (narduk-libs#662).

`foundation:check` sub-check 1.5 fails any `d1_databases[].database_id` (top level or any `env.<name>`) that is still the scaffold placeholder `00000000-0000-0000-0000-000000000000`, naming `narduk-app db create` and the raw `wrangler d1 create <name>` step. The placeholder builds, dry-runs and tests clean, so this is the first gate that notices the database does not exist. A fresh `create-narduk-app` scaffold with a database now fails 1.5, and only 1.5, until it is provisioned; a `--no-database` scaffold is unaffected.

`narduk-app db create [--checkout <dir>] [--binding <NAME>] [--dry-run] [--json]` creates the one database a placeholder binding stands for: it refuses when the id is already real, takes the name from `Config/cloudflare-app.json` (never an argument), requires an explicit account (`account_id` or `CLOUDFLARE_ACCOUNT_ID`), writes the returned id into the wrangler config the manifest names with comments and formatting intact, prints the id and account, and never deletes.

The generated `apps/web/wrangler.jsonc`, `README.md` and `docs/workers-builds.md` now say how to create the database.
