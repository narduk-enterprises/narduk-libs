---
'@narduk-enterprises/narduk-postgres': minor
'@narduk-enterprises/narduk-timeseries': minor
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

**narduk-timeseries** depends on it and adds the history store:

- `TelemetryHistoryStore` with `writeNumeric`, `writeTrack`, `resolveSeries`,
  `queryRollup`, `queryTrack` and `applyRetention`, plus Drizzle-free SQL
  builders whose parameter counts are stated and tested: 6 per numeric row, 8
  per track row, 4 per series descriptor, and a fixed 5 for a rollup read
  whatever the series cardinality.
- The docs/04 schema as three migrations against TimescaleDB 2.30: hypertables
  created with `by_range` and stored in the columnstore (`enable_columnstore`,
  `add_columnstore_policy`), the 1m → 15m → 1h → 1d continuous-aggregate ladder
  (non-transactional, `materialized_only` stated, 1m aggregating
  `installation_role = 0` so shadow rows live in raw only), and a grant matrix
  generated from the library's own role specification. The rollups store
  `n`/`sum`/`min`/`max`/`last` rather than an average, because avg-of-avg is
  wrong when chained.
- Both hypertables carry a natural key —
  `(vessel_id, series_id, ts, installation_role)` and `(vessel_id, ts)` — and
  both write paths say `ON CONFLICT DO NOTHING`, so a redelivered at-least-once
  batch cannot inflate `n` and with it every rollup average. A multi-statement
  batch is atomic when the injected executor is transactional.
- Retention: raw and each rollup level are swept globally with `drop_chunks`
  (rollups at the most generous tier's depth, since a continuous aggregate is
  not pruned per vessel), and a narrower tier is enforced on read, where
  `queryRollup` clips the requested range to the `tierWindowMs` the consumer
  passes and reports the clip. That field is required and typed
  `number | 'unrestricted'`: read-side clipping is the only tier gate there is,
  so a handler that omits it must fail to compile rather than fail open. A level
  with no global window is never swept and is reported as such. The sweep
  requires a session-pinned executor, checks its unlock, and runs from Node —
  not from a Hyperdrive Worker.
- `refreshRollupsStatements({ range })` for a store-and-forward batch older than
  the 7-day refresh window the scheduled policies reconsider: the whole ladder
  in order, coarsest last (15m reads 1m, 1h reads 15m, 1d reads 1h), each level
  split into windows no wider than `REFRESH_MAX_WINDOW_MS` for that level.
- The writer's grant set is `INSERT` everywhere it writes plus `UPDATE` on
  `series` alone, and DELETE nowhere: `INSERT ... ON CONFLICT ... DO UPDATE` is
  checked for UPDATE at parse time, so a writer without it fails every resolve
  with `permission denied for table series`. `RolePrivilegeSpec` gained an
  `update` list separate from `mutate` to express exactly that.
- `RollupRow.min`, `.max` and `.last` are `number | null`. A bucket with no
  extreme reports null; 0 is a plausible depth, speed or temperature, so
  coercing the absence to 0 puts a reading on the chart that no instrument
  produced.
- The migrations are proven against a real PostgreSQL 17.11 + TimescaleDB
  2.30.0 + PostGIS 3.6.4, not only against the protocol fake: that run is what
  caught `SELECT add_columnstore_policy(...)`, which fails because the policy
  API is a procedure in 2.30, and it is now a `CALL`.
- `./influx`, a read-only parity adapter that holds no credential and enforces ≤
  4-day windows, `aggregateWindow` before any `group()`, a 120 s timeout, and an
  optional `AbortSignal`. It is **temporary** and is removed after G4-H parity.

Refs narduk-libs#112, mybo-at-v2#63.
