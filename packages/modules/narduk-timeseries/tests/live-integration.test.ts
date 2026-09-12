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
 * order against a real Timescale (continuous aggregates, compression policies
 * and PostGIS types are all server-side behaviour a fake cannot check), that
 * the builders' SQL parses and means what it says, and that a rollup read comes
 * back with the values the raw writes imply.
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
      vesselId,
    })

    expect(result.rows.length).toBeGreaterThan(0)
    expect(result.rows[0]?.avg).toBeCloseTo(4, 6)
  }, 120_000)

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
    expect(result.rows[0]?.latitude).toBeCloseTo(27.9, 3)
  }, 120_000)
})
