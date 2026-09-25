# Changelog

## 0.3.4

### Patch Changes

- 8a254db: `bucketReadings` now ends a bucket at a spring-forward DST gap where
  the day really changes (narduk-libs#938). A bucket edge that fell on a skipped
  wall time (Chicago's 02:00, or midnight in America/Santiago) resolved backward
  onto the previous edge. That gave zero-width buckets (`start === end`) and a
  bucket whose `end` came before rows it held, overlapping the next one. Skipped
  wall times now resolve forward to the transition instant, and a repeated
  fall-back hour still opens on its first occurrence.
- 757d1f7: A decimated `queryTrack` now anchors its buckets on `range.start`
  (narduk-libs#939). `time_bucket` aligned them to TimescaleDB's 2000-01-03
  origin, so a fully covered range almost always touched `maxPoints + 1`
  buckets, with a partial one at each end. `queryTrack` read the extra row as
  truncation, reported `truncated: true`, and sliced off the newest bucket,
  which holds the vessel's latest position. It now gets at most `maxPoints`
  buckets, and `truncated` means a real cap.
- a374aca: `resolveSeries`, `writeNumeric` and the series cache now match a
  `vesselId` in any spelling Postgres accepts for a uuid (narduk-libs#940). The
  resolve statement's `RETURNING` answers in lowercase canonical form, and the
  descriptor lookup used the caller's string as given. So an uppercase
  `UUID().uuidString` from Swift threw `SERIES_UNRESOLVED` on every batch after
  the upsert had run, and none of its points were written. A batch that spelled
  one vessel two ways also sent two upsert rows for one `(vessel_id, path)`.
  Series keys now use the canonical form.
- Updated dependencies [ca79843]
  - @narduk-enterprises/narduk-postgres@0.2.6

## 0.3.3

### Patch Changes

- Updated dependencies [b59c4a8]
  - @narduk-enterprises/narduk-postgres@0.2.5

## 0.3.2

### Patch Changes

- 5ac629e: The package's `volta.node` pin moves from 22.22.3 to 24.21.0, the
  Node the workspace root and CI run (narduk-libs#647). No runtime change: the
  pin only selects the Node that Volta runs for commands inside the package
  directory. It now matches the ABI of the native modules that the root install
  builds.
- Updated dependencies [5ac629e]
  - @narduk-enterprises/narduk-postgres@0.2.4

## 0.3.1

### Patch Changes

- 8943c9e: `narduk-lint` can now fail a warning in a rule that has no budget
  entry. A `lint-budget.json` carrying `"strict": true` gates every rule: a new
  rule's warnings exit non-zero, naming the rule and its locations, instead of
  being recorded as the rule's budget and passing (#673). Adopt a new rule's
  current count deliberately with `narduk-lint --accept-new-rules`, which
  refuses to run in CI or with `--no-write`. A budget file without `strict`
  keeps the old record-and-pass behaviour and now says so on every run.
  narduk-timeseries fixes the one warning that behaviour had let through.
  - @narduk-enterprises/narduk-postgres@0.2.3

## 0.3.0

### Minor Changes

- c1c8b42: Add the narduk-shell data-table family — `NeDataTable` (UTable preset
  with column groups, units, tabular numerals, the missing dash, day/group rows,
  a pinned first column, the phone column-set switch, the break row, and
  loading), `NeSortHeader`, `NeCsvDownload`, plus `toCsv` / `parseSort` from the
  package root — and extend `NePager` with `pageSizes`, `mode` (`pages` | `more`
  | `auto`), `moreStep`, `maxLimit` and `update:limit`. narduk-timeseries gains
  `bucketReadings` (1h / 3h / 1d min/avg/max; missing is `null`, not `0`).
  create-narduk-app is patched because it pins narduk-shell (narduk-libs#528).

### Patch Changes

- e693c21: Align `refreshRollupsStatements` by snapping the requested range
  outward onto each level's bucket, then walking `maxWindowMs` steps so
  neighbours abut and no CALL exceeds the ceiling. Fold a leftover narrower than
  one bucket into the previous window. Reject an empty `buckets` list or a
  non-positive `maxWindowMs` before the per-level loop (narduk-libs#293).
- Updated dependencies [1f7feee]
  - @narduk-enterprises/narduk-postgres@0.2.3

## 0.2.3

### Patch Changes

- 939927b: Bind no bare JS arrays (narduk-libs#311). `queryRollup`'s series ids
  and `applyRetention`'s per-tier vessel batches now bind as one comma-joined
  text parameter, split server-side with
  `ANY(string_to_array($n::text, ',')::bigint[])` / `::uuid[]`. Under a
  Hyperdrive-shaped postgres.js connection
  (`prepare: false, fetch_types: false`) the old `ANY($n::type[])` bind failed
  with `22P02 malformed array literal`, proven against a real TimescaleDB 17
  before and after. The rollup statement still binds exactly five parameters.
  `applyRetention` now refuses a vessel id that is empty or contains a comma
  (`RETENTION_POLICY_INVALID`), because a comma would split one id into two
  array elements and widen the DELETE.

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
