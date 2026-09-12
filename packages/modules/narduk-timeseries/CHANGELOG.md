# Changelog

## 0.1.0

- Initial release: the `TelemetryHistoryStore` boundary and its TimescaleDB +
  PostGIS adapter.
- Drizzle-free SQL builders with stated, tested parameter ceilings; a batched
  write path; rollup and track reads with row bounds and truncation reporting.
- The docs/04 history schema as three versioned migrations against TimescaleDB
  2.30: `by_range` hypertables in the columnstore — segmented by
  `vessel_id, series_id, installation_role`, because every column of a unique
  key must be a segmentby or orderby column or the columnstore cannot be enabled
  at all — both carrying their natural key; the 1m → 15m → 1h → 1d continuous-aggregate ladder, with the 1m level
  aggregating `installation_role = 0` only, so shadow rows live in raw; and a
  grant matrix generated from the library's own role specification, in which
  `ingest_writer` holds UPDATE on `series` alone — `ON CONFLICT ... DO UPDATE`
  is checked at parse time, so without it every resolve fails `permission denied
  for table series` — and DELETE nowhere. Roles and role-level timeouts belong
  to the deployment (narduk-infrastructure#155).
- `ON CONFLICT DO NOTHING` on both write paths, so a redelivered at-least-once
  batch is a no-op rather than duplicate rows that inflate every rollup average.
  A multi-statement batch is atomic when the executor is transactional.
- Retention: raw and each rollup level swept globally with `drop_chunks`, tier
  depth enforced on read (`queryRollup` clips to the required `tierWindowMs`,
  which is `number | 'unrestricted'` so the tier gate cannot be skipped by
  omission, and reports the clip),
  unswept levels reported rather than guessed at, in-process single-flight keyed
  on the policy identity, and a session-pinned executor required — retention
  runs from Node, not from a Hyperdrive Worker.
- `refreshRollupsStatements({ range })` for a backfill older than the 7-day
  window the scheduled refresh policies reconsider: the ladder in order,
  coarsest last, split into windows no wider than `REFRESH_MAX_WINDOW_MS` for
  the level.
- `RollupRow.min`, `.max` and `.last` are `number | null`: a bucket with no
  extreme reports null rather than a zero the instrument never produced.
- `add_columnstore_policy` is invoked with `CALL`: it is a procedure in 2.30,
  and `SELECT` on it fails the migration. Proven by applying all three
  migrations to a real PostgreSQL 17.11 + TimescaleDB 2.30.0 + PostGIS 3.6.4
  (`tests/live-integration.test.ts`, 7/7 from an empty database).
- A narrow read-only Influx adapter for dual-run parity, holding no credential,
  cancellable with an `AbortSignal` — temporary, removed after G4-H parity.
