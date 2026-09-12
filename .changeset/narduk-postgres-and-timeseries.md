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
- `./migrate` runs ordered `NNNN_name.sql` files against a `schema_migrations`
  table under a `pg_try_advisory_lock`, records a sha256 per file so an applied
  migration can never be edited in place, supports a dry run, and honours a
  `-- narduk:no-transaction` first line. The advisory lock is session-scoped, so
  `migrationDriverOptions()` pins `max: 1`.
- Health is `SELECT 1` plus extension presence in two statements, never throws,
  and passes every error through `redactSecrets()`.
- Typed helpers for the `ingest_writer` / `history_reader` / `ops` roles;
  `SET ROLE` only ever takes a member of the frozen role tuple.
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
- The docs/04 schema as three migrations: hypertables with compression, the 1m →
  15m → 1h → 1d continuous-aggregate ladder (non-transactional), and the three
  least-privilege roles. The rollups store `n`/`sum`/`min`/`max`/`last` rather
  than an average, because avg-of-avg is wrong when chained.
- Retention parameterized by tier windows the consumer supplies, guarded by
  in-process single-flight and a Postgres advisory lock; the library holds no
  tier numbers.
- `./influx`, a read-only parity adapter that holds no credential and enforces ≤
  4-day windows, `aggregateWindow` before any `group()`, and a 120 s timeout.

Known gap in 0.1.0: `telemetry_numeric` has no unique constraint, so an
at-least-once delivery path can write duplicate rows; de-duplication is the
consumer's until a uniqueness decision is made.

Refs narduk-libs#112, mybo-at-v2#63.
