---
'@narduk-enterprises/narduk-postgres': patch
---

Redact driver `cause` chains on connection failure, and never apply a
transactional migration outside a transaction.

`withHyperdriveConnection` / `withNodeConnection` now attach a redacted copy of
the driver error (message and nested `cause`, bounded depth) so a postgres.js /
`pg` DSN password cannot reach logs or error trackers. `applyMigrations` wraps
transactional files in `BEGIN` / `COMMIT` (with `ROLLBACK` on failure) when the
executor has no `.transaction`, instead of silently autocommitting
statement-by-statement.

This is a patch: exported function signatures are unchanged. The behavior
changes are security and correctness fixes, not a new API.

Enumerable extras on a driver error (`parameters.connectionString`, `address`,
`hostname`) and `AggregateError.errors` are copied onto the attached cause after
redaction, so `JSON.stringify` of that copy cannot carry a DSN. A value held
under a secret-named key (`password`, `token`, `secret`, and similar) is
replaced outright rather than pattern-matched, because a driver stores the
password as a bare value that carries no DSN or `password=` shape. The original
driver object is not mutated and is available for server-side logging via
`getUnredactedCause`; do not serialize that value.

## Operator action

Transactional migration files now run in a transaction on `withNodeConnection` /
`withHyperdriveConnection`. Any statement Postgres refuses inside a transaction
block must move to a file whose line 1 is `-- narduk:no-transaction`, or
`applyMigrations` starts failing where it used to silently autocommit. In-repo
Timescale `0002_history_rollups.sql` already has the directive.

`applyMigrations` names the problem itself — `MIGRATION_TRANSACTION_FORBIDDEN`,
citing the file and the directive — for `CREATE INDEX CONCURRENTLY`,
`DROP INDEX CONCURRENTLY`, `REINDEX … CONCURRENTLY`, and `VACUUM`. That list is
the common set, not a complete one: `CREATE DATABASE`, `ALTER SYSTEM`, and a
TimescaleDB continuous aggregate are also non-transactional and are **not**
detected, so they surface as the raw Postgres
`cannot run inside a transaction block` error instead. Audit your migration
files for those forms before upgrading rather than relying on the named error.

`ALTER TYPE … ADD VALUE` is **not** rejected: Postgres 12 and later permit it
inside a transaction block (only _using_ the new value in the same transaction
is barred).
