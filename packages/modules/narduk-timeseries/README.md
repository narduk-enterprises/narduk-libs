# @narduk-enterprises/narduk-timeseries

A telemetry history store for Narduk products: one interface, a TimescaleDB +
PostGIS adapter, and a narrow Influx reader for dual-run parity.

Built on [`@narduk-enterprises/narduk-postgres`](../narduk-postgres), which
supplies the connection, the migrations runner and the parameter budgets. Like
that package it ships **no driver**: the caller passes an executor with a
`query(text, params)` method.

## Install

```bash
pnpm add @narduk-enterprises/narduk-timeseries
```

## Exports

| Subpath          | What it holds                                                   |
| ---------------- | --------------------------------------------------------------- |
| `.`              | `TelemetryHistoryStore`, its types, retention policy validation |
| `./timescale`    | The adapter, every SQL builder, the migration set               |
| `./influx`       | The read-only dual-run parity adapter                           |
| `./migrations/*` | The `.sql` files themselves, for a deploy job                   |

The root entry carries **no SQL**, so a route handler, a test double or a second
backend can import the interface without pulling in the adapter.

## The interface

```ts
import type { TelemetryHistoryStore } from '@narduk-enterprises/narduk-timeseries'
import { createTimescaleHistoryStore } from '@narduk-enterprises/narduk-timeseries/timescale'

const store = createTimescaleHistoryStore({ executor })

await store.writeNumeric(points) // resolve + bounded multi-row INSERTs
await store.writeTrack(positions) // ST_MakePoint(lon, lat), lon first
await store.resolveSeries(descriptors) // cached, coalesced, one statement
await store.queryRollup({ vesselId, seriesIds, bucket: '1h', range })
await store.queryTrack({ vesselId, range, maxPoints: 5000 })
await store.applyRetention(policy)
```

Every method returns what it cost: `WriteResult` carries `statements`,
`parameters`, `rows`, `seriesResolved` and `seriesFromCache`, so a consumer can
assert the shape of its own data path rather than trusting this README.

## What is bounded, and by what

| Path           | Bound                                                                               |
| -------------- | ----------------------------------------------------------------------------------- |
| Numeric write  | 6 parameters per row, chunked to the 32768-parameter budget                         |
| Track write    | 8 parameters per row, same budget                                                   |
| Series resolve | 4 parameters per descriptor, one statement per distinct descriptor set              |
| Rollup read    | **5 parameters, whatever the series cardinality** (`= ANY($2::bigint[])`)           |
| Track read     | 4 or 5 parameters; decimated in the database above `maxPoints`                      |
| Retention      | one `drop_chunks` per level plus per-tier track/raw deletes chunked at 1000 vessels |

Nothing scales with retained history: no statement this package issues has a
cost that grows with how much history the database happens to hold. The unit
suite varies points, series cardinality and retained rows on independent axes
and asserts exactly that.

A read never silently truncates. `queryRollup` asks for `maxRows + 1` and
reports `truncated: true`; `queryTrack` decimates with `time_bucket` and reports
the `bucketMs` it used.

## Refresh races

Two operations can plausibly run twice at once, and both are explicit:

- **`resolveSeries`** — a burst of queue messages for the same vessel is the
  common case. Concurrent resolves of an identical descriptor set are coalesced
  onto one in-flight promise, so the burst costs one statement.
- **`applyRetention`** — a cron Workflow and an operator can start it together.
  In-process single-flight — **keyed on the policy's identity**, so two
  schedulers running two different policies are two operations and not one —
  handles one runtime; a Postgres advisory lock handles two, and the loser
  returns `coalesced: true` rather than running concurrent deletes against the
  same columnstore chunks. Every result carries the `policyIdentity` it
  describes.

## Retention policy

The library holds **no tier numbers**. The consumer passes them in:

```ts
await store.applyRetention({
  globalRawWindowMs: 7 * 86_400_000,   // round 20: 7-day global raw window
  globalRollupWindowMs: {              // one window per level, for EVERY vessel
    '1m': 30 * 86_400_000,
    '15m': 90 * 86_400_000,
    '1h': 365 * 86_400_000,
    // '1d' omitted: never swept, and reported as such
  },
  tiers: {
    free: {
      vesselIds: [...],
      rawWindowMs: 24 * 60 * 60 * 1000, // round 20: Free keeps raw 24 h
      rollupWindowMs: { '1m': 7 * 86_400_000, '1h': 30 * 86_400_000 },
      trackWindowMs: 7 * 86_400_000,
    },
  },
})
```

### Rollup retention is global; tier depth is enforced on read

A continuous aggregate is not pruned with a per-vessel `DELETE`. Rollups are
retained **globally at the most generous tier's depth**, one time-based
`drop_chunks` per level, and a narrower tier is enforced where the data leaves
the store:

```ts
const result = await store.queryRollup({
  bucket: '1h',
  range, // what the caller asked for
  tierWindowMs: 30 * 86_400_000, // what this tier may see
  seriesIds,
  vesselId,
})
result.clipped // true when range.start was moved forward
result.range // the range actually read
```

A range entirely older than the tier window returns an empty, `clipped: true`
result and costs **no statement at all**. `tierWindowMs` is the consumer's to
pass: this library does not know what a "Cruiser" is, and tier membership never
enters it.

**`tierWindowMs` is required**, and a caller with no tier boundary passes the
literal `'unrestricted'`:

```ts
tierWindowMs: 'unrestricted' // this caller has no tier boundary, deliberately
```

Optional, the field failed open — a route handler that forgot it served the full
retained range and reported `clipped: false` while doing it, and read-side
clipping is the only tier gate there is. Required, the omission is a type error
and the exemption is a word a reviewer can see.

A level with **no** `globalRollupWindowMs` entry is never swept. That is a real
choice — keep 1d rollups indefinitely — so it is reported rather than guessed
at: `validateRetentionPolicy(...).unsweptRollupLevels` lists them, and every
`RetentionResult.skipped` repeats them.

### Retention runs from Node, never from a Worker

The sweep takes a **session-scoped** advisory lock, so the lock and its unlock
must reach the same backend. Through a pool — and Hyperdrive **is** a pool —
they may not, and a lock left held by a backend nobody is talking to makes every
later sweep stand down with `coalesced: true` and delete nothing until that
backend is recycled. The store therefore refuses to sweep through an executor
nobody has declared pinned:

```ts
const store = createTimescaleHistoryStore({
  executor: pool, // reads and writes
  retention: { executor: connection, maxConnections: 1 }, // one backend
})
```

Without `retention`, `applyRetention` throws `RETENTION_EXECUTOR_UNPINNED`.
`maxConnections` other than 1 is refused at construction. On the way out, an
unlock that returns `false`, or a backend pid that differs from the one that
took the lock, raises `RETENTION_UNLOCK_FAILED` instead of being ignored — and
it never masks a sweep failure that happened first.

`validateRetentionPolicy` refuses an incoherent policy before any statement is
built: a tier asking for more raw history than the global window keeps, a tier
promising more rollup depth than that level's global window retains, a ladder
(global or per tier) that drops a coarser level before the finer one it
summarizes, and a window that is not a positive finite number.

### What each sweep costs

- **raw, global** — `drop_chunks`, which unlinks whole chunks. Cheap.
- **rollups, global** — one `drop_chunks` per level. Cheap, one parameter each,
  and independent of fleet size.
- **track, per tier** — row deletes chunked at `maxVesselsPerStatement`.
- **raw, per tier** — the expensive one, and it exists only because round 20
  chose both a 7-day global raw window and a 24-hour Free window: it deletes
  rows from a hypertable whose older chunks are in the columnstore.

## Migrations

Three files, applied through the narduk-postgres runner. The target is
**TimescaleDB 2.30 on PostgreSQL 17** and the DDL uses that version's APIs:
`by_range()` for the time dimension (the positional `create_hypertable` form is
deprecated since 2.13) and the columnstore API (`enable_columnstore`,
`segmentby`, `add_columnstore_policy`) which superseded `timescaledb.compress`
and `add_compression_policy` in 2.18.

- `0001_history_core.sql` — extensions, `series`, the `telemetry_numeric`
  hypertable (1-day chunks, columnstore segmented by
  `vessel_id, series_id, installation_role` after 3 days — every column of the
  UNIQUE key has to be a segmentby or orderby column or TimescaleDB refuses to
  enable the columnstore) and `track_points` (`GEOGRAPHY(POINT, 4326)` + GIST,
  7-day chunks). Both hypertables carry their natural key:
  `UNIQUE (vessel_id, series_id, ts, installation_role)` and
  `UNIQUE (vessel_id, ts)`.
- `0002_history_rollups.sql` — the 1m → 15m → 1h → 1d continuous-aggregate
  ladder with refresh policies. It begins with `-- narduk:no-transaction`,
  because Timescale refuses to create a continuous aggregate inside a
  transaction block — and the runner therefore sends it one statement per round
  trip, since a multi-statement simple query is an implicit transaction.
- `0003_history_roles.sql` — the grant matrix, and only the grant matrix. It is
  **generated** from `HISTORY_ROLE_PRIVILEGES` in `src/timescale/roles.ts`, and
  a test asserts the file is byte-identical to `historyRoleGrantStatements()`.

```ts
import { loadMigrationsFromDirectory } from '@narduk-enterprises/narduk-postgres/node'
import { applyMigrations } from '@narduk-enterprises/narduk-postgres/migrate'
import { timescaleMigrationsUrl } from '@narduk-enterprises/narduk-timeseries/timescale'

await applyMigrations(
  connection,
  await loadMigrationsFromDirectory(timescaleMigrationsUrl),
)
```

### The deployment owns roles and timeouts

0003 does **not** `CREATE ROLE` and does **not**
`ALTER ROLE ... SET statement_timeout`. The target instance's own initdb
(narduk-infrastructure#155) creates `ingest_writer`, `history_reader` and `ops`
WITH LOGIN and sets each role's `statement_timeout`; both need superuser, and
re-issuing the timeout here would have silently replaced the deployment's 60 s
with a library default. This migration owns privileges; the deployment owns
identity and deadlines.

### What the three roles may do — and what the deployment actually grants

The role names `ingest_writer`, `history_reader` and `ops` are **literals** and
part of this library's contract: `setRoleStatement` accepts nothing else, and
0003 grants to exactly those three. A deployment that names its roles something
else has to alias them.

| Role             | 0003 grants                                                                                                                                   |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `ingest_writer`  | USAGE on the schema; SELECT + INSERT + **UPDATE** on `series`; INSERT on both hypertables. No DELETE, no TRUNCATE, no UPDATE on a hypertable. |
| `history_reader` | USAGE; SELECT on the three tables and the four rollup views. Nothing else.                                                                    |
| `ops`            | USAGE + CREATE; SELECT/INSERT/UPDATE/DELETE on the three base tables; SELECT (never DELETE) on the rollup views.                              |

The writer's UPDATE on `series` is required, not a convenience. `resolveSeries`
upserts the descriptor with
`INSERT ... ON CONFLICT (vessel_id, path) DO UPDATE`, and PostgreSQL checks the
UPDATE privilege when it **parses** that statement, whether or not a row ever
conflicts. Granting only INSERT + SELECT makes every resolve — and therefore
every numeric write — fail with `permission denied for table series`. The
conflict action rewrites one nullable unit string
(`COALESCE(EXCLUDED.unit, series.unit)`), so the privilege buys the writer
nothing beyond that.

**`history_reader` also needs `USAGE ON SCHEMA _timescaledb_internal`** to read
a hypertable at all — a SELECT resolves to the chunk tables in that schema. 0003
does not grant it (the schema is Timescale's, not this library's); the
deployment's initdb does.

**Divergence from the deployed instance, stated rather than assumed.** The
provisioning in `narduk-infrastructure`
(`deploy/mybo-history-postgres/initdb/ 030-grants.sh`, at `ab717ab`) sets
`ALTER DEFAULT PRIVILEGES ... GRANT SELECT, INSERT, UPDATE ON TABLES` to the
writer, so on that instance `ingest_writer` can UPDATE **every** table,
including both hypertables. Until that script narrows to match, the
least-privilege claim above describes what this migration grants, not what the
writer ends up holding there; the two have to be reconciled on the deployment
side.

### Shadow rows live in raw only

The 1m continuous aggregate reads `WHERE installation_role = 0`. A shadow
installation exists to be compared against the primary, so folding both into one
bucket would produce a mean of two instruments and present it as the vessel's
value. Shadow history is readable in `telemetry_numeric`; it is deliberately
absent from every rollup level.

### Rollup lag, per level

`timescaledb.materialized_only = true` is stated explicitly on all four views
(it has been the default since 2.13), so a read sees materialized buckets only.
Each level therefore lags by its `end_offset` plus up to one
`schedule_interval`:

| Level | `end_offset` | `schedule_interval` | Worst-case lag |
| ----- | ------------ | ------------------- | -------------- |
| 1m    | 1 minute     | 1 minute            | ~2 minutes     |
| 15m   | 15 minutes   | 15 minutes          | ~30 minutes    |
| 1h    | 1 hour       | 1 hour              | ~2 hours       |
| 1d    | 1 day        | 1 hour              | ~25 hours      |

A consumer needing the current partial bucket reads raw. The 1d bucket is a
**UTC** day — `time_bucket` with no timezone argument — so a product wanting
local days buckets 1h rows in its own query.

### Backfill older than the refresh window

Every scheduled policy below 1d reconsiders the last **7 days**, which is the
whole global raw window: anything raw still holds can still be materialized. A
store-and-forward consumer that deliberately accepts a batch older than that
must refresh it explicitly, coarsest last, because no policy will look at those
buckets again:

```ts
import { refreshRollupsStatements } from '@narduk-enterprises/narduk-timeseries/timescale'

// Already ordered fine-first (1m → 15m → 1h → 1d) and already split into
// windows no wider than REFRESH_MAX_WINDOW_MS[level].
for (const statement of refreshRollupsStatements({ range: backfilledRange })) {
  await connection.query(statement.text, statement.params) // not in a transaction
}
```

Two properties of that list matter. **Order**: 15m reads 1m, 1h reads 15m, 1d
reads 1h, so every window of a level runs before any window of the level above
it — refresh 1d first and it summarizes buckets that do not exist yet, and
nothing reports the hole. **Bounds**: a refresh materializes every bucket in its
range inside one statement, so the range is split per level — 7 days at 1m, 30
days at 15m, 90 days at 1h, a year at 1d — and a wider `maxWindowMs` is refused
with `REFRESH_WINDOW_TOO_WIDE` rather than accepted and regretted.

### Two deliberate deviations from docs/04

1. **The rollups store `n`, `sum_value`, `min_value`, `max_value` and
   `last_value` — not `avg`.** Chaining an average of averages up the ladder is
   wrong whenever the buckets carry different sample counts; `sum/n` recomputes
   the exact average at every level, and the query builder does that division.
2. **Both hypertables carry a natural key** that docs/04 does not declare, and
   the reads lean on its index. `(vessel_id, series_id, ts, installation_role)`
   has the `(vessel_id, series_id, ts)` prefix every read filters on, and
   PostgreSQL scans it backwards for `ORDER BY ts DESC`, so no second index is
   needed; `track_points` is the same story with `(vessel_id, ts)`.

## Replay safety

`telemetry_numeric` and `track_points` carry natural keys, and both write paths
say `ON CONFLICT DO NOTHING`. A redelivered queue batch — the ordinary
consequence of at-least-once delivery — therefore inserts what is missing and
drops the rest, so a whole batch is safely replayable and a duplicate delivery
cannot inflate `n` (and with it the average) in any rollup.

`WriteResult.rows` is what the batch handed to the database, not what the
database stored; nothing in this path guesses at the difference.

A multi-statement batch is **atomic**: when the injected executor is
transactional, the chunk loop runs inside one `executor.transaction()`, because
the chunking is this library's bookkeeping and not a fact about the data. A
single-statement batch is not wrapped (it is already atomic), and a
non-transactional executor runs the statements in order without atomicity.

## Influx parity reader — temporary, removed after G4-H parity

For dual-running against the old stack only, and deliberately tiny. **It is
temporary**: when G4-H signs parity off, the Influx replica host is retired and
this subpath is deleted with it. It is not a supported second backend, it will
never grow a write path, and nothing in the product should be built to depend on
it.

```ts
import { readWindowed } from '@narduk-enterprises/narduk-timeseries/influx'

const rows = await readWindowed({ client, flux, range }) // client is yours
```

It **never holds a credential** — the caller injects an authenticated client —
and it refuses the query shapes that hurt the replica host: windows wider than 4
days, a query with no `aggregateWindow`, a `group()` before that reduction, and
a timeout above 120 s. Windows run sequentially on purpose; firing them
concurrently would restore the load the windowing exists to avoid — and an
optional `signal` (an `AbortSignal`) stops a long parity run at the next window
boundary instead of at the end of the range.

## Testing

The unit suite runs against the narduk-postgres protocol fake, which enforces
wire rules and records statements but understands no SQL. The live suite in
`tests/live-integration.test.ts` is written and **skipped with a named reason**:
no TimescaleDB instance exists on the estate yet. Point
`NARDUK_TIMESERIES_LIVE_DSN` at a throwaway database to run it.

## Licence

UNLICENSED — internal to Narduk Enterprises.
