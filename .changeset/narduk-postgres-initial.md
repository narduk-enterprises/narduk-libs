---
'@narduk-enterprises/narduk-postgres': minor
---

Add `@narduk-enterprises/narduk-postgres` and
`@narduk-enterprises/narduk-timeseries`, the Postgres access surface and the
telemetry history store for the non-Supabase backend.

**narduk-postgres** is one access surface, with no driver dependency of its own:

- `./worker` connects over a Hyperdrive binding
  (`env.HISTORY_DB.connectionString`) with the connection lifetime bound to the
  invocation, `max` capped at 6, and a statement timeout always set through
  startup parameters. `./node` connects directly for migrations and jobs.
- `./migrate` runs ordered `NNNN_name.sql` files against a ledger table
  (`schema_migrations` by default, `{ table }` for a second set) under a
  `pg_try_advisory_lock`, records a sha256 per file so an applied migration can
  never be edited in place, supports a dry run, and honours a
  `-- narduk:no-transaction` first line — splitting such a file into top-level
  statements and sending one per round trip, because a multi-statement simple
  query is an implicit transaction and would reject the very DDL the directive
  exists for. The advisory lock is session-scoped, so `migrationDriverOptions()`
  pins `max: 1`, the unlock result is checked (`MIGRATION_UNLOCK_FAILED`), and
  it can never mask a migration failure that happened first.
- Health is `SELECT 1` plus extension presence in two statements, never throws,
  and passes every error through `redactSecrets()`.
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
- The Supabase backend of narduk-libs#112 stays an interface seam with a single
  `TODO(#112)` marker.

Refs narduk-libs#112, mybo-at-v2#63.
