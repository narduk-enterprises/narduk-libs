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

| Path           | Bound                                                                     |
| -------------- | ------------------------------------------------------------------------- |
| Numeric write  | 6 parameters per row, chunked to the 32768-parameter budget               |
| Track write    | 8 parameters per row, same budget                                         |
| Series resolve | 4 parameters per descriptor, one statement per distinct descriptor set    |
| Rollup read    | **5 parameters, whatever the series cardinality** (`= ANY($2::bigint[])`) |
| Track read     | 4 or 5 parameters; decimated in the database above `maxPoints`            |
| Retention      | one `drop_chunks` plus per-tier deletes chunked at 1000 vessels           |

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
  In-process single-flight handles one runtime; a Postgres advisory lock handles
  two, and the loser returns `coalesced: true` rather than running concurrent
  deletes against the same compressed chunks.

## Retention policy

The library holds **no tier numbers**. The consumer passes them in:

```ts
await store.applyRetention({
  globalRawWindowMs: 7 * 86_400_000,   // round 20: 7-day global raw window
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

`validateRetentionPolicy` refuses three incoherent policies before any DELETE is
built: a tier asking for more raw history than the global window keeps (a
promise the sweep would silently break), a ladder that drops a coarser level
before the finer one it summarizes, and a tier with no vessel list — which would
otherwise sweep every vessel on the instance.

## Migrations

Three files, applied through the narduk-postgres runner:

- `0001_history_core.sql` — extensions, `series`, the `telemetry_numeric`
  hypertable (1-day chunks, compression segmented by `vessel_id, series_id`
  after 3 days), `track_points` (`GEOGRAPHY(POINT, 4326)` + GIST, 7-day chunks).
- `0002_history_rollups.sql` — the 1m → 15m → 1h → 1d continuous-aggregate
  ladder with refresh policies. It begins with `-- narduk:no-transaction`,
  because Timescale refuses to create a continuous aggregate inside a
  transaction block.
- `0003_history_roles.sql` — the three `NOLOGIN` roles, their per-role
  `statement_timeout`, and the grant matrix. No credential appears anywhere.

```ts
import { loadMigrationsFromDirectory } from '@narduk-enterprises/narduk-postgres/node'
import { applyMigrations } from '@narduk-enterprises/narduk-postgres/migrate'
import { timescaleMigrationsUrl } from '@narduk-enterprises/narduk-timeseries/timescale'

await applyMigrations(
  connection,
  await loadMigrationsFromDirectory(timescaleMigrationsUrl),
)
```

### Two deliberate deviations from docs/04

1. **The rollups store `n`, `sum_value`, `min_value`, `max_value` and
   `last_value` — not `avg`.** Chaining an average of averages up the ladder is
   wrong whenever the buckets carry different sample counts; `sum/n` recomputes
   the exact average at every level, and the query builder does that division.
2. **Two composite indexes are added** — `(vessel_id, series_id, ts DESC)` on
   `telemetry_numeric` and `(vessel_id, ts DESC)` on `track_points`. Every read
   this library issues filters on exactly those columns; both are marked as
   additions in the SQL with the reasoning inline.

## Known gap: no de-duplication in 0.1.0

`telemetry_numeric` has **no unique constraint** in docs/04, so the write path
carries no `ON CONFLICT`. With an at-least-once delivery path (a Queue
consumer), a redelivered batch writes duplicate rows, which inflate `n` and
therefore the average in every rollup. Until a uniqueness decision is made,
de-duplication is the consumer's — idempotent batch keys, or a unique index
added by a later migration. Tracked as an open item on the PR that introduced
this package.

## Influx parity reader

For dual-running against the old stack only, and deliberately tiny:

```ts
import { readWindowed } from '@narduk-enterprises/narduk-timeseries/influx'

const rows = await readWindowed({ client, flux, range }) // client is yours
```

It **never holds a credential** — the caller injects an authenticated client —
and it refuses the query shapes that hurt the replica host: windows wider than 4
days, a query with no `aggregateWindow`, a `group()` before that reduction, and
a timeout above 120 s. Windows run sequentially on purpose; firing them
concurrently would restore the load the windowing exists to avoid.

## Testing

The unit suite runs against the narduk-postgres protocol fake, which enforces
wire rules and records statements but understands no SQL. The live suite in
`tests/live-integration.test.ts` is written and **skipped with a named reason**:
no TimescaleDB instance exists on the estate yet. Point
`NARDUK_TIMESERIES_LIVE_DSN` at a throwaway database to run it.

## Licence

UNLICENSED — internal to Narduk Enterprises.
