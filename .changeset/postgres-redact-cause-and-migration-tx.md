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
redaction, so `JSON.stringify` of that copy cannot carry a DSN. The original
driver object is not mutated and is available for server-side logging via
`getUnredactedCause`; do not serialize that value.

## Operator action

Transactional migration files now run in a transaction on `withNodeConnection` /
`withHyperdriveConnection`. If a file contains `CREATE INDEX CONCURRENTLY`,
`VACUUM`, or `ALTER TYPE … ADD VALUE` and does not start with
`-- narduk:no-transaction`, `applyMigrations` starts failing with
`MIGRATION_TRANSACTION_FORBIDDEN` instead of applying the file. Add the
directive as line 1 of those files before upgrading. In-repo Timescale
`0002_history_rollups.sql` already has it.
