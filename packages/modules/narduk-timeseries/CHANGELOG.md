# Changelog

## 0.2.2

### Patch Changes

- 8186003: Stop a client-supplied `now` from widening rollup reads or deepening
  retention deletes.

  `RollupQuery.now` may only raise the tier floor (`max(real now, now)`).
  `RetentionPolicyInput.now` may only move delete cutoffs earlier
  (`min(real now, now)`). Exported signatures are unchanged.

  Client-supplied `maxRows` / `maxPoints` are hard-capped at the published
  defaults (50_000 / 5_000). Values above the ceiling, including `1e12`, throw
  `RANGE_INVALID`. Raise the ceiling only via
  `TimescaleStoreOptions.maxRollupRows` / `maxTrackPoints` on the server-side
  store.

  ## Operator action

  The ceiling **is** the default, so there is no headroom above it: a caller
  that previously passed `maxRows` or `maxPoints` above `50_000` / `5_000` was
  accepted and is now rejected with `RANGE_INVALID`. Raise
  `TimescaleStoreOptions.maxRollupRows` / `maxTrackPoints` on the server-side
  store if you need the larger working set.

  A test or handler that passed a **past** `RollupQuery.now` as a deterministic
  clock no longer widens the window — the tier floor is computed from the real
  clock. Freeze time instead (`vi.setSystemTime`); in-repo `store.test.ts` shows
  the pattern.

- Updated dependencies [8186003]
  - @narduk-enterprises/narduk-postgres@0.2.2

## 0.2.1

### Patch Changes

- Updated dependencies [d95acff]
  - @narduk-enterprises/narduk-postgres@0.2.1

## 0.2.0

### Minor Changes

- 80a03ba: Add `@narduk-enterprises/narduk-postgres` and
  `@narduk-enterprises/narduk-timeseries`, the Postgres access surface and the
  telemetry history store for the non-Supabase backend.

  **narduk-timeseries** depends on it and adds the history store:

  - `TelemetryHistoryStore` with `writeNumeric`, `writeTrack`, `resolveSeries`,
    `queryRollup`, `queryTrack` and `applyRetention`, plus Drizzle-free SQL
    builders whose parameter counts are stated and tested: 6 per numeric row, 8
    per track row, 4 per series descriptor, and a fixed 5 for a rollup read
    whatever the series cardinality.
  - The docs/04 schema as three migrations against TimescaleDB 2.30: hypertables
    created with `by_range` and stored in the columnstore (`enable_columnstore`,
    `add_columnstore_policy`), the 1m → 15m → 1h → 1d continuous-aggregate
    ladder (non-transactional, `materialized_only` stated, 1m aggregating
    `installation_role = 0` so shadow rows live in raw only), and a grant matrix
    generated from the library's own role specification. The rollups store
    `n`/`sum`/`min`/`max`/`last` rather than an average, because avg-of-avg is
    wrong when chained.
  - Both hypertables carry a natural key —
    `(vessel_id, series_id, ts, installation_role)` and `(vessel_id, ts)` — and
    both write paths say `ON CONFLICT DO NOTHING`, so a redelivered
    at-least-once batch cannot inflate `n` and with it every rollup average. A
    multi-statement batch is atomic when the injected executor is transactional.
  - Retention: raw and each rollup level are swept globally with `drop_chunks`
    (rollups at the most generous tier's depth, since a continuous aggregate is
    not pruned per vessel), and a narrower tier is enforced on read, where
    `queryRollup` clips the requested range to the `tierWindowMs` the consumer
    passes and reports the clip. That field is required and typed
    `number | 'unrestricted'`: read-side clipping is the only tier gate there
    is, so a handler that omits it must fail to compile rather than fail open. A
    level with no global window is never swept and is reported as such. The
    sweep requires a session-pinned executor, checks its unlock, and runs from
    Node — not from a Hyperdrive Worker.
  - `refreshRollupsStatements({ range })` for a store-and-forward batch older
    than the 7-day refresh window the scheduled policies reconsider: the whole
    ladder in order, coarsest last (15m reads 1m, 1h reads 15m, 1d reads 1h),
    each level split into windows no wider than `REFRESH_MAX_WINDOW_MS` for that
    level.
  - The writer's grant set is `INSERT` everywhere it writes plus `UPDATE` on
    `series` alone, and DELETE nowhere: `INSERT ... ON CONFLICT ... DO UPDATE`
    is checked for UPDATE at parse time, so a writer without it fails every
    resolve with `permission denied for table series`. `RolePrivilegeSpec`
    gained an `update` list separate from `mutate` to express exactly that.
  - `RollupRow.min`, `.max` and `.last` are `number | null`. A bucket with no
    extreme reports null; 0 is a plausible depth, speed or temperature, so
    coercing the absence to 0 puts a reading on the chart that no instrument
    produced.
  - The migrations are proven against a real PostgreSQL 17.11 + TimescaleDB
    2.30.0 + PostGIS 3.6.4, not only against the protocol fake: that run is what
    caught `SELECT add_columnstore_policy(...)`, which fails because the policy
    API is a procedure in 2.30, and it is now a `CALL`.
  - `./influx`, a read-only parity adapter that holds no credential and enforces
    ≤ 4-day windows, `aggregateWindow` before any `group()`, a 120 s timeout,
    and an optional `AbortSignal`. It is **temporary** and is removed after G4-H
    parity.

  Refs narduk-libs#112, mybo-at-v2#63.

### Patch Changes

- Updated dependencies [80a03ba]
  - @narduk-enterprises/narduk-postgres@0.2.0
