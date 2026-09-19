# Changelog

## 0.2.3

### Patch Changes

- 1f7feee: The ./worker example spreads postgres.js `RowList` into a plain
  `Row[]` so `SqlExecutor` does not leak the driver type.

## 0.2.2

### Patch Changes

- 8186003: Redact driver `cause` chains on connection failure, and never apply a
  transactional migration outside a transaction.

  `withHyperdriveConnection` / `withNodeConnection` now attach a redacted copy
  of the driver error (message and nested `cause`, bounded depth) so a
  postgres.js / `pg` DSN password cannot reach logs or error trackers.
  `applyMigrations` wraps transactional files in `BEGIN` / `COMMIT` (with
  `ROLLBACK` on failure) when the executor has no `.transaction`, instead of
  silently autocommitting statement-by-statement.

  This is a patch: exported function signatures are unchanged. The behavior
  changes are security and correctness fixes, not a new API.

  Enumerable extras on a driver error (`parameters.connectionString`, `address`,
  `hostname`) and `AggregateError.errors` are copied onto the attached cause
  after redaction, so `JSON.stringify` of that copy cannot carry a DSN. A value
  held under a secret-named key (`password`, `token`, `secret`, and similar) is
  replaced outright rather than pattern-matched, because a driver stores the
  password as a bare value that carries no DSN or `password=` shape. The
  original driver object is not mutated and is available for server-side logging
  via `getUnredactedCause`; do not serialize that value.

  ## Operator action

  Transactional migration files now run in a transaction on `withNodeConnection`
  / `withHyperdriveConnection`. Any statement Postgres refuses inside a
  transaction block must move to a file whose line 1 is
  `-- narduk:no-transaction`, or `applyMigrations` starts failing where it used
  to silently autocommit. In-repo Timescale `0002_history_rollups.sql` already
  has the directive.

  `applyMigrations` names the problem itself —
  `MIGRATION_TRANSACTION_FORBIDDEN`, citing the file and the directive — for
  `CREATE INDEX CONCURRENTLY`, `DROP INDEX CONCURRENTLY`,
  `REINDEX … CONCURRENTLY`, and `VACUUM`. That list is the common set, not a
  complete one: `CREATE DATABASE`, `ALTER SYSTEM`, and a TimescaleDB continuous
  aggregate are also non-transactional and are **not** detected, so they surface
  as the raw Postgres `cannot run inside a transaction block` error instead.
  Audit your migration files for those forms before upgrading rather than
  relying on the named error.

  `ALTER TYPE … ADD VALUE` is **not** rejected: Postgres 12 and later permit it
  inside a transaction block (only _using_ the new value in the same transaction
  is barred).

## 0.2.1

### Patch Changes

- d95acff: Fix health extension lookups through postgres.js unprepared
  connections by binding scalar names, and preserve successful connectivity when
  a later statement fails. Add an opt-in unprepared text-parameter fake guard
  and a read-only real PostgreSQL regression suite.

## 0.2.0

### Minor Changes

- 80a03ba: Add `@narduk-enterprises/narduk-postgres` and
  `@narduk-enterprises/narduk-timeseries`, the Postgres access surface and the
  telemetry history store for the non-Supabase backend.

  **narduk-postgres** is one access surface, with no driver dependency of its
  own:

  - `./worker` connects over a Hyperdrive binding
    (`env.HISTORY_DB.connectionString`) with the connection lifetime bound to
    the invocation, `max` capped at 6, and a statement timeout always set
    through startup parameters. `./node` connects directly for migrations and
    jobs.
  - `./migrate` runs ordered `NNNN_name.sql` files against a ledger table
    (`schema_migrations` by default, `{ table }` for a second set) under a
    `pg_try_advisory_lock`, records a sha256 per file so an applied migration
    can never be edited in place, supports a dry run, and honours a
    `-- narduk:no-transaction` first line — splitting such a file into top-level
    statements and sending one per round trip, because a multi-statement simple
    query is an implicit transaction and would reject the very DDL the directive
    exists for. The advisory lock is session-scoped, so
    `migrationDriverOptions()` pins `max: 1`, the unlock result is checked
    (`MIGRATION_UNLOCK_FAILED`), and it can never mask a migration failure that
    happened first.
  - Health is `SELECT 1` plus extension presence in two statements, never
    throws, and passes every error through `redactSecrets()`.
  - Typed helpers for the `ingest_writer` / `history_reader` / `ops` roles;
    `SET ROLE` only ever takes a member of the frozen role tuple. Role creation
    and role-level `statement_timeout` belong to the deployment
    (narduk-infrastructure#155), not to this library; what it owns is the GRANT
    matrix, which generates narduk-timeseries' 0003.
  - `POSTGRES_MAX_BIND_PARAMETERS` (65535, the protocol's 16-bit Bind field) and
    `DEFAULT_PARAMETER_BUDGET` (32768) with chunking helpers.
  - `./testing` exports a protocol fake that enforces the wire rules — the
    parameter ceiling, dense placeholders, encodable values — and records
    statements. It emulates no SQL semantics, and says so.
  - The Supabase backend of narduk-libs#112 stays an interface seam with a
    single `TODO(#112)` marker.

  Refs narduk-libs#112, mybo-at-v2#63.
