---
'@narduk-enterprises/narduk-app-tools': patch
---

The runner-ledger guard now reads statements, not comments.
`buildMigrationBatchSql` and the migration-bundle check tested the raw SQL for
`_narduk_migration`, so a migration that merely _documented_ the bookkeeping
tables — explaining which ones it deliberately does not drop — was refused with
"Migration SQL may not alter the runner ledger or lock". That blocked every
deploy of an app whose drop migration carried such a comment (riverstatus#182).

Comments are stripped before the test; quoted text is preserved, so
`DELETE FROM "_narduk_migrations"` is still refused, and a `--` inside a string
literal no longer blinds the guard to the rest of the line.
