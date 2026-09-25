---
'@narduk-enterprises/narduk-postgres': patch
---

`createMigrationSet` now sorts migrations in code-unit order, not with
`localeCompare`. That is the lexical order the README documents and the order
`assertOrder` enforces. ICU collation used to put `0002_users_email_idx.sql`
before `0002_users.sql`, so on a fresh database the index ran before its table
existed.
