/**
 * The live integration suite -- written now, skipped until a route exists.
 *
 * NAMED REASON FOR THE SKIP: no PostgreSQL 17 + TimescaleDB + PostGIS instance
 * exists on the estate yet. A sibling lane is provisioning one on the Linode
 * host (Logan, round 20: "right now put it on the linode host"), and Docker is
 * not running on the machine this lane was written on, so there is no local
 * container fallback either. The suite runs the moment someone exports
 * NARDUK_TIMESERIES_LIVE_DSN pointing at a throwaway database.
 *
 * What it proves that no unit test can: that the migrations actually apply in
 * order against a real Timescale (continuous aggregates, columnstore policies
 * and PostGIS types are all server-side behaviour a fake cannot check), that
 * the builders' SQL parses and means what it says, that a rollup read comes
 * back with the values the raw writes imply, and that a library-emitted
 * refresh CALL for every rollup level is legal against a range narrower than
 * the 1d bucket (narduk-libs#293).
 *
 * It deliberately does NOT run against a shared database: it creates its own
 * schema, and every statement is scoped to a generated vessel id.
 *
 * The driver is resolved through a variable specifier so this file typechecks
 * and lints in a workspace where no Postgres driver is installed. The consumer
 * chooses the driver; this suite only needs one that speaks `query(text,
 * params)`.
 */
import { randomUUID } from 'node:crypto'

import type { SqlExecutor } from '@narduk-enterprises/narduk-postgres'
import { checkHealth } from '@narduk-enterprises/narduk-postgres'
import { applyMigrations } from '@narduk-enterprises/narduk-postgres/migrate'
import { loadMigrationsFromDirectory } from '@narduk-enterprises/narduk-postgres/node'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createTimescaleHistoryStore, timescaleMigrationsUrl } from '../src/timescale/index.js'
import { refreshRollupsStatements } from '../src/timescale/query.js'
import { ROLLUP_BUCKET_MS } from '../src/timescale/tables.js'
import { ROLLUP_BUCKETS } from '../src/types.js'

const dsn = process.env.NARDUK_TIMESERIES_LIVE_DSN
const SKIP_REASON =
  'no live TimescaleDB route yet (Linode provisioning is a sibling lane; Docker is not running here). Set NARDUK_TIMESERIES_LIVE_DSN to run.'

interface LiveClient extends SqlExecutor {
  end(): Promise<void>
}

async function connect(connectionString: string): Promise<LiveClient> {
  // Variable specifier on purpose: no driver is a dependency of this package.
  const driverName = process.env.NARDUK_TIMESERIES_LIVE_DRIVER ?? 'pg'
  const driver = (await import(driverName)) as {
    Client: new (config: { connectionString: string }) => {
      connect(): Promise<void>
      end(): Promise<void>
      query(text: string, params?: readonly unknown[]): Promise<{ rowCount: number; rows: never[] }>
    }
  }
  const client = new driver.Client({ connectionString })
  await client.connect()
  return {
    end: () => client.end(),
    query: async <Row>(text: string, params?: readonly unknown[]) => {
      const result = await client.query(text, params)
      return { rowCount: result.rowCount ?? 0, rows: result.rows as Row[] }
    },
  }
}

describe('the live integration suite is skipped for a named reason', () => {
  it('names why it is not running, so a green suite never reads as live proof', () => {
    if (dsn) {
      expect(dsn.length).toBeGreaterThan(0)
      return
    }
    expect(SKIP_REASON).toContain('NARDUK_TIMESERIES_LIVE_DSN')
  })
})

describe.skipIf(!dsn)(`live TimescaleDB (${SKIP_REASON})`, () => {
  let client: LiveClient
  const vesselId = randomUUID()

  beforeAll(async () => {
    client = await connect(dsn as string)
  }, 60_000)

  afterAll(async () => {
    if (!client) return
    await client.query('DELETE FROM telemetry_numeric WHERE vessel_id = $1::uuid', [vesselId])
    await client.query('DELETE FROM track_points WHERE vessel_id = $1::uuid', [vesselId])
    await client.query('DELETE FROM series WHERE vessel_id = $1::uuid', [vesselId])
    await client.end()
  })

  it('reports healthy with timescaledb and postgis present', async () => {
    const report = await checkHealth(client, { requiredExtensions: ['timescaledb', 'postgis'] })
    expect(report.ok).toBe(true)
    expect(report.missingExtensions).toEqual([])
  })

  it('applies every migration in order, then is a no-op on a second run', async () => {
    const migrations = await loadMigrationsFromDirectory(timescaleMigrationsUrl)
    const first = await applyMigrations(client, migrations)
    expect(first.applied.length).toBeGreaterThanOrEqual(0)
    const second = await applyMigrations(client, migrations)
    expect(second.applied).toEqual([])
  }, 120_000)

  it('enables the columnstore over the natural key, which only a server can prove', async () => {
    // Fix pass 2's blocker: TimescaleDB refuses `enable_columnstore` when a
    // unique-constrained column is neither a segmentby nor an orderby column,
    // so `UNIQUE (vessel_id, series_id, ts, installation_role)` with
    // `segmentby = 'vessel_id, series_id'` fails the ALTER TABLE and takes
    // 0001 down with it. No fake can report that; this assertion is the proof,
    // and it is skipped until the live route exists.
    const settings = await client.query<{ segmentby: string | null }>(
      `SELECT pg_catalog.array_to_string(array_agg(attname ORDER BY attname), ',') AS segmentby
         FROM timescaledb_information.compression_settings
        WHERE hypertable_name = 'telemetry_numeric'
          AND segmentby_column_index IS NOT NULL`,
    )
    expect(settings.rows[0]?.segmentby).toContain('installation_role')
  }, 60_000)

  it('round-trips a numeric batch through a rollup read', async () => {
    const store = createTimescaleHistoryStore({ executor: client })
    const start = new Date(Date.now() - 60 * 60 * 1000)
    await store.writeNumeric(
      Array.from({ length: 600 }, (_, index) => ({
        path: 'navigation.speedOverGround',
        ts: new Date(start.getTime() + index * 1000),
        unit: 'm/s',
        value: 4,
        vesselId,
      })),
    )

    // At-least-once delivery: the same batch, again. 0001's natural key plus
    // the writer's ON CONFLICT DO NOTHING must make this a no-op, and only a
    // real database can prove the constraint is there.
    await store.writeNumeric(
      Array.from({ length: 600 }, (_, index) => ({
        path: 'navigation.speedOverGround',
        ts: new Date(start.getTime() + index * 1000),
        unit: 'm/s',
        value: 4,
        vesselId,
      })),
    )
    const stored = await client.query<{ n: string }>(
      'SELECT count(*) AS n FROM telemetry_numeric WHERE vessel_id = $1::uuid',
      [vesselId],
    )
    expect(Number(stored.rows[0]?.n)).toBe(600)

    // A shadow installation writes to raw and must not reach the rollup.
    await store.writeNumeric([
      {
        installationRole: 1,
        path: 'navigation.speedOverGround',
        ts: new Date(start.getTime() + 1000),
        unit: 'm/s',
        value: 400,
        vesselId,
      },
    ])

    await client.query("CALL refresh_continuous_aggregate('telemetry_numeric_1m', NULL, NULL)")
    const series = await store.resolveSeries([
      {
        path: 'navigation.speedOverGround',
        unit: 'm/s',
        valueKind: 'numeric',
        vesselId,
      },
    ])
    const result = await store.queryRollup({
      bucket: '1m',
      range: { end: new Date(Date.now() + 60_000), start },
      seriesIds: series.map((row) => row.seriesId),
      tierWindowMs: 'unrestricted',
      vesselId,
    })

    expect(result.rows.length).toBeGreaterThan(0)
    // 4, not a mean of 4 and 400: the 1m aggregate is installation_role = 0.
    expect(result.rows[0]?.avg).toBeCloseTo(4, 6)
  }, 120_000)

  it('sweeps retention through a session-pinned connection', async () => {
    const store = createTimescaleHistoryStore({
      executor: client,
      // The live client here IS one connection, which is exactly the
      // requirement: a session advisory lock cannot be released from another
      // backend.
      retention: { executor: client, maxConnections: 1 },
    })

    const result = await store.applyRetention({
      globalRawWindowMs: 7 * 86_400_000,
      globalRollupWindowMs: { '1m': 30 * 86_400_000 },
      // A tier with a vessel, so the per-vessel DELETEs -- the statements that
      // bind a vessel list (narduk-libs#311) -- actually reach the server.
      tiers: {
        free: {
          rawWindowMs: 86_400_000,
          rollupWindowMs: { '1m': 7 * 86_400_000 },
          trackWindowMs: 7 * 86_400_000,
          vesselIds: [vesselId, randomUUID()],
        },
      },
    })

    expect(result.coalesced).toBe(false)
    expect(result.droppedRollupsOlderThan['1m']).toBeInstanceOf(Date)
  }, 120_000)

  it('lists the series a write created, and creates none for a path it is asked about', async () => {
    const store = createTimescaleHistoryStore({ executor: client })
    await store.writeNumeric([
      {
        path: 'environment.depth.belowTransducer',
        ts: new Date(Date.now() - 60_000),
        unit: 'm',
        value: 4.2,
        vesselId,
      },
    ])

    const all = await store.listSeries({ vesselId })
    expect(all.series.map((series) => series.path)).toContain('environment.depth.belowTransducer')
    expect(all.truncated).toBe(false)

    const some = await store.listSeries({
      paths: ['environment.depth.belowTransducer', 'never.recorded'],
      vesselId: vesselId.toUpperCase(),
    })
    expect(some.series.map((series) => series.path)).toEqual(['environment.depth.belowTransducer'])
    const after = await store.listSeries({ vesselId })
    expect(after.series.map((series) => series.path)).not.toContain('never.recorded')
  }, 60_000)

  it('round-trips a track batch through a decimated read', async () => {
    const store = createTimescaleHistoryStore({ executor: client })
    const start = new Date(Date.now() - 60 * 60 * 1000)
    await store.writeTrack(
      Array.from({ length: 500 }, (_, index) => ({
        latitude: 27.9 + index / 100_000,
        longitude: -82.5 + index / 100_000,
        sog: 3.2,
        ts: new Date(start.getTime() + index * 1000),
        vesselId,
      })),
    )

    const result = await store.queryTrack({
      maxPoints: 50,
      range: { end: new Date(Date.now() + 60_000), start },
      vesselId,
    })

    expect(result.decimated).toBe(true)
    expect(result.rows.length).toBeLessThanOrEqual(50)
    // Decimation keeps `last(geom, ts)` per bucket, not the bucket's first
    // point and not a centroid, so row 0 carries the LAST position inside the
    // first bucket -- somewhere inside the track, never below its start.
    const first = result.rows[0]?.latitude ?? 0
    const last = result.rows.at(-1)?.latitude ?? 0
    expect(first).toBeGreaterThanOrEqual(27.9)
    expect(first).toBeLessThanOrEqual(27.9 + 499 / 100_000)
    // The final bucket's last point is the final point written, which is what
    // makes a decimated track end where the real one does.
    expect(last).toBeCloseTo(27.9 + 499 / 100_000, 5)
    for (let index = 1; index < result.rows.length; index += 1) {
      expect(result.rows[index]!.ts.getTime()).toBeGreaterThan(result.rows[index - 1]!.ts.getTime())
    }
  }, 120_000)

  it('keeps the newest bucket of a densely filled decimated range (#939)', async () => {
    // One fix per second across the whole range, so every bucket has data.
    // time_bucket aligns to 2000-01-03 unless told otherwise; a range start
    // off that grid then touches maxPoints + 1 buckets, and the extra row
    // used to read as truncation and cost the vessel's latest position.
    const bucketMs = 12_000
    const start = new Date(
      Math.floor((Date.now() - 2 * 60 * 60 * 1000) / bucketMs) * bucketMs + 5_000,
    )
    const vessel = randomUUID()
    const store = createTimescaleHistoryStore({ executor: client })
    const count = 50 * (bucketMs / 1000)
    await store.writeTrack(
      Array.from({ length: count }, (_, index) => ({
        latitude: 10 + index / 100_000,
        longitude: 20,
        ts: new Date(start.getTime() + index * 1000),
        vesselId: vessel,
      })),
    )
    try {
      const result = await store.queryTrack({
        maxPoints: 50,
        range: { end: new Date(start.getTime() + count * 1000), start },
        vesselId: vessel,
      })

      expect(result.decimated).toBe(true)
      expect(result.bucketMs).toBe(bucketMs)
      expect(result.truncated).toBe(false)
      expect(result.rows).toHaveLength(50)
      expect(result.rows[0]!.ts.toISOString()).toBe(start.toISOString())
      expect(result.rows.at(-1)!.latitude).toBeCloseTo(10 + (count - 1) / 100_000, 7)
    } finally {
      await client.query('DELETE FROM track_points WHERE vessel_id = $1::uuid', [vessel])
    }
  }, 120_000)

  it('executes a library-emitted refresh for every level on a range narrower than 1d', async () => {
    // narduk-libs#293 M1: the unit suite proves alignment; this is the live
    // proof that each emitted CALL is a legal refresh_continuous_aggregate
    // window. Gated on NARDUK_TIMESERIES_LIVE_DSN -- do not invent a pass
    // when the Timescale fixture is absent.
    const migrations = await loadMigrationsFromDirectory(timescaleMigrationsUrl)
    await applyMigrations(client, migrations)

    const range = {
      end: new Date('2026-09-12T12:17:33.000Z'),
      start: new Date('2026-09-12T12:07:33.000Z'),
    }
    const statements = refreshRollupsStatements({ range })
    expect(statements.map((statement) => statement.bucket)).toEqual([...ROLLUP_BUCKETS])
    expect(range.end.getTime() - range.start.getTime()).toBeLessThan(ROLLUP_BUCKET_MS['1d'])
    for (const statement of statements) {
      const width = statement.range.end.getTime() - statement.range.start.getTime()
      expect(width).toBeGreaterThanOrEqual(ROLLUP_BUCKET_MS[statement.bucket])
      await client.query(statement.text, statement.params)
    }
  }, 120_000)
})
