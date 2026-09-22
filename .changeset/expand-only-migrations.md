---
'@narduk-enterprises/narduk-app-tools': minor
'@narduk-enterprises/create-narduk-app': patch
---

`foundation:check:deployment` enforces the expand-only half of
`deployment.migrations.compatibility: "expand-contract"` (#399). New sub-check
12.9 fails an app-owned D1 migration that drops or renames a table, view or
column, because `narduk-app deploy rollback` restores code, never a schema. A
deliberate contract migration is declared under
`deployment.migrations.contractMigrations` (`path`, `sha256`, `reason`), pinned
to the checksum the migration ledger records, and the failure prints that entry.
An app with such a migration in its history adopts the rule by listing it once.

`deployment.rollback.mode` now defaults to `manual` in new apps. Nothing ever
read `"auto"`, so a generated app was declaring an automatic safety net it did
not have. New sub-check 12.10 fails `"auto"`; the value still parses, so older
manifests do not stop the tools. The generated deployment doc now says what
actually triggers a rollback: only the app's own promote step, after a completed
promotion fails its live proof. A failed migration triggers nothing.
