---
'@narduk-enterprises/narduk-postgres': minor
---

The migration runner can apply a set into a schema (`applyMigrations(..., { schema })`, also `planMigrations` and `createMigrationsTableSql`) and accept Supabase-CLI 14-digit migration names (`allowTimestampNames: true` on `loadMigrationsFromDirectory`, `createMigration` and `createMigrationSet`). With a schema the ledger lives in it and every file runs with `search_path` set to it alone, so an unqualified `CREATE TABLE` cannot land in, or no-op against, an app-owned `public` table. Both are opt-in; with neither option nothing changes.
