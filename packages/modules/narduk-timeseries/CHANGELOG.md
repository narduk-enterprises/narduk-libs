# Changelog

## 0.1.0

- Initial release: the `TelemetryHistoryStore` boundary and its TimescaleDB +
  PostGIS adapter.
- Drizzle-free SQL builders with stated, tested parameter ceilings; a batched
  write path; rollup and track reads with row bounds and truncation reporting.
- The docs/04 history schema as three versioned migrations against TimescaleDB
  2.30: `by_range` hypertables in the columnstore, both carrying their natural
  key; the 1m → 15m → 1h → 1d continuous-aggregate ladder, with the 1m level
  aggregating `installation_role = 0` only, so shadow rows live in raw; and a
  grant matrix generated from the library's own role specification. Roles and
  role-level timeouts belong to the deployment (narduk-infrastructure#155).
- `ON CONFLICT DO NOTHING` on both write paths, so a redelivered at-least-once
  batch is a no-op rather than duplicate rows that inflate every rollup average.
  A multi-statement batch is atomic when the executor is transactional.
- Retention: raw and each rollup level swept globally with `drop_chunks`, tier
  depth enforced on read (`queryRollup` clips to `tierWindowMs` and reports it),
  unswept levels reported rather than guessed at, in-process single-flight keyed
  on the policy identity, and a session-pinned executor required — retention
  runs from Node, not from a Hyperdrive Worker.
- `refreshRollupsStatement(level, range)` for a backfill older than the 7-day
  window the scheduled refresh policies reconsider.
- A narrow read-only Influx adapter for dual-run parity, holding no credential,
  cancellable with an `AbortSignal` — temporary, removed after G4-H parity.
