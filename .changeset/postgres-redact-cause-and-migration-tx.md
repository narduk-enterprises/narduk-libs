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
