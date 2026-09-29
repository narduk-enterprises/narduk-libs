---
'@narduk-enterprises/narduk-app-tools': patch
---

`narduk-app ship` now refuses a schema change that lands only as new SQL. It used to compare just `migrations.sources.json` itself against the serving commit, so a new file under a listed source directory (e.g. `apps/web/drizzle`) went through unnoticed. Ship now compares every directory the config lists, and it refuses a lockfile change to a package whose migrations the config includes.
