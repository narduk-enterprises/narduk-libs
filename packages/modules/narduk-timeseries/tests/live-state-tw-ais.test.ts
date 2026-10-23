/**
 * The live suite for migrations 0004-0007: `telemetry_state`, time-weighted
 * rollups, the AIS tables and the "raw never swept" mode, against a real
 * TimescaleDB + PostGIS. Skipped, for the same named reason as
 * live-integration.test.ts, unless NARDUK_TIMESERIES_LIVE_DSN is set.
 *
 * The time-weighted tests are an equivalence proof, not a smoke test: the SQL
 * refresh's every bucket, at every level, is compared with the in-memory
 * reference `timeWeightedBuckets` over the same readings -- the held-value
 * fixture, a seeded random change-only series with outage gaps, and the same
 * series after a late row arrives and only its own range is refreshed.
 *
 * Every statement is scoped to vessel ids generated here, and they are
 * deleted at the end.
 */
import { randomUUID } from 'node:crypto'

import type { SqlExecutor } from '@narduk-enterprises/narduk-postgres'
import { applyMigrations } from '@narduk-enterprises/narduk-postgres/migrate'
import { loadMigrationsFromDirectory } from '@narduk-enterprises/narduk-postgres/node'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { timeWeightedBuckets, type TimeWeightedReading } from '../src/time-weighted.js'
import {
  ROLLUP_BUCKET_MS,
  createTimescaleHistoryStore,
  timescaleMigrationsUrl,
  type TimescaleHistoryStore,
} from '../src/timescale/index.js'
import type { RollupBucket } from '../src/types.js'
import { HELD_VALUE_FIXTURE, HELD_VALUE_T0 } from './fixtures/held-value.js'

const dsn = process.env.NARDUK_TIMESERIES_LIVE_DSN
const SKIP_REASON = 'no live TimescaleDB route in this run. Set NARDUK_TIMESERIES_LIVE_DSN to run.'

interface LiveClient extends SqlExecutor {
  end(): Promise<void>
}

async function connect(connectionString: string): Promise<LiveClient> {
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

/** Deterministic PRNG, so a failing random fixture can be reproduced. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d_2b_79_f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }
}

const LEVELS: readonly RollupBucket[] = ['1m', '15m', '1h', '1d']

describe('the live L3 suite is skipped for a named reason', () => {
  it('names why it is not running', () => {
    expect(dsn ? dsn.length > 0 : SKIP_REASON.includes('NARDUK_TIMESERIES_LIVE_DSN')).toBe(true)
  })
})

describe.skipIf(!dsn)(`live TimescaleDB, migrations 0004-0007 (${SKIP_REASON})`, () => {
  let client: LiveClient
  let store: TimescaleHistoryStore
  const vessels: string[] = []
  const vessel = (): string => {
    const id = randomUUID()
    vessels.push(id)
    return id
  }

  beforeAll(async () => {
    client = await connect(dsn as string)
    store = createTimescaleHistoryStore({
      executor: client,
      retention: { executor: client, maxConnections: 1 },
    })
  }, 60_000)

  afterAll(async () => {
    if (!client) return
    for (const table of [
      'telemetry_numeric',
      'telemetry_state',
      'telemetry_numeric_tw',
      'ais_contact',
      'ais_encounter',
      'ais_encounter_open',
      'series',
    ]) {
      await client.query(
        `DELETE FROM ${table} WHERE vessel_id::text = ANY(string_to_array($1, ','))`,
        [vessels.join(',')],
      )
    }
    await client.end()
  })

  it('applies 0004-0007 on top of an applied 0001-0003, then is a no-op', async () => {
    const migrations = await loadMigrationsFromDirectory(timescaleMigrationsUrl)
    await applyMigrations(client, migrations)
    const second = await applyMigrations(client, migrations)
    expect(second.applied).toEqual([])
    const hypertables = await client.query<{ hypertable_name: string }>(
      `SELECT hypertable_name FROM timescaledb_information.hypertables
        WHERE hypertable_name IN ('telemetry_state', 'telemetry_numeric_tw') ORDER BY 1`,
    )
    expect(hypertables.rows.map((row) => row.hypertable_name)).toEqual([
      'telemetry_numeric_tw',
      'telemetry_state',
    ])
  }, 120_000)

  it('granted what 0007 says and withheld what it omits', async () => {
    const check = async (role: string, table: string, privilege: string): Promise<boolean> => {
      const result = await client.query<{ ok: boolean }>(
        'SELECT has_table_privilege($1, $2, $3) AS ok',
        [role, `public.${table}`, privilege],
      )
      return result.rows[0]?.ok === true
    }
    expect(await check('ingest_writer', 'telemetry_state', 'INSERT')).toBe(true)
    expect(await check('ingest_writer', 'telemetry_state', 'UPDATE')).toBe(false)
    expect(await check('ingest_writer', 'telemetry_state', 'DELETE')).toBe(false)
    expect(await check('ingest_writer', 'telemetry_numeric_tw', 'INSERT')).toBe(false)
    expect(await check('ingest_writer', 'ais_encounter_open', 'DELETE')).toBe(true)
    expect(await check('ingest_writer', 'ais_encounter', 'DELETE')).toBe(false)
    expect(await check('history_reader', 'telemetry_numeric_tw', 'SELECT')).toBe(true)
    expect(await check('history_reader', 'telemetry_state', 'INSERT')).toBe(false)
    expect(await check('ops', 'telemetry_numeric_tw', 'UPDATE')).toBe(true)
  })

  describe('telemetry_state', () => {
    it('round-trips strings, bools, objects and JSON null, and ignores a redelivery', async () => {
      const id = vessel()
      const base = Date.now()
      const t = (minute: number): Date => new Date(base - (60 - minute) * 60_000)
      const batch = [
        { path: 'electrical.venus.acSource', ts: t(0), value: 'shore', vesselId: id },
        { path: 'electrical.venus.acSource', ts: t(10), value: 'inverter', vesselId: id },
        { path: 'steering.autopilot.engaged', ts: t(5), value: true, vesselId: id },
        {
          path: 'notifications.mob',
          ts: t(7),
          value: { message: 'MOB', state: 'alarm' },
          vesselId: id,
        },
        { path: 'notifications.mob', ts: t(20), value: null, vesselId: id },
      ]
      await store.writeState(batch)
      await store.writeState(batch)
      const stored = await client.query<{ n: string }>(
        'SELECT count(*) AS n FROM telemetry_state WHERE vessel_id = $1::uuid',
        [id],
      )
      expect(Number(stored.rows[0]?.n)).toBe(5)

      const series = await store.listSeries({ vesselId: id })
      expect(Object.fromEntries(series.series.map((row) => [row.path, row.valueKind]))).toEqual({
        'electrical.venus.acSource': 'text',
        'notifications.mob': 'json',
        'steering.autopilot.engaged': 'bool',
      })
      const ids = series.series.map((row) => row.seriesId)

      const at = await store.queryStateAt({
        at: t(8),
        seriesIds: ids,
        tierWindowMs: 'unrestricted',
        vesselId: id,
      })
      expect(Object.fromEntries(at.rows.map((row) => [row.seriesId, row.value]))).toEqual(
        Object.fromEntries(
          series.series.map((row) => [
            row.seriesId,
            {
              'electrical.venus.acSource': 'shore',
              'notifications.mob': { message: 'MOB', state: 'alarm' },
              'steering.autopilot.engaged': true,
            }[row.path],
          ]),
        ),
      )

      const changes = await store.queryStateTransitions({
        range: { end: new Date(), start: t(0) },
        seriesIds: ids,
        tierWindowMs: 'unrestricted',
        vesselId: id,
      })
      expect(changes.rows.map((row) => row.value)).toEqual([
        'shore',
        true,
        { message: 'MOB', state: 'alarm' },
        'inverter',
        null,
      ])
      expect(changes.truncated).toBe(false)

      // The tier floor bounds "state at t": a 5-minute tier asking for the
      // state now sees nothing, because every change is older than the floor.
      const clipped = await store.queryStateAt({
        at: new Date(),
        seriesIds: ids,
        tierWindowMs: 5 * 60_000,
        vesselId: id,
      })
      expect(clipped.rows).toEqual([])
    }, 60_000)

    it('refuses a row with both value columns or neither', async () => {
      const id = vessel()
      await expect(
        client.query(
          `INSERT INTO telemetry_state (ts, vessel_id, series_id, value_text, value_json)
           VALUES (now(), $1::uuid, 1, NULL, NULL)`,
          [id],
        ),
      ).rejects.toThrow(/telemetry_state_one_value/u)
      await expect(
        client.query(
          `INSERT INTO telemetry_state (ts, vessel_id, series_id, value_text, value_json)
           VALUES (now(), $1::uuid, 1, 'a', '1'::jsonb)`,
          [id],
        ),
      ).rejects.toThrow(/telemetry_state_one_value/u)
    })
  })

  describe('time-weighted rollups', () => {
    const HOLD = 600_000

    async function writeSeries(
      id: string,
      path: string,
      readings: readonly TimeWeightedReading[],
      role = 0,
    ) {
      await store.writeNumeric(
        readings.map((reading) => ({
          installationRole: role,
          path,
          ts: reading.ts,
          value: reading.value,
          vesselId: id,
        })),
      )
      const [series] = (await store.listSeries({ paths: [path], vesselId: id })).series
      return series!.seriesId
    }

    async function assertLadderEqualsReference(
      id: string,
      seriesId: number,
      readings: readonly TimeWeightedReading[],
      range: { end: Date; start: Date },
    ) {
      for (const bucket of LEVELS) {
        const span = ROLLUP_BUCKET_MS[bucket]
        // The coarse levels are summed over whole UTC days of stored minutes,
        // so the reference covers the same days.
        const readRange = {
          end: new Date(Math.ceil(range.end.getTime() / 86_400_000) * 86_400_000),
          start: new Date(Math.floor(range.start.getTime() / 86_400_000) * 86_400_000),
        }
        const reference = timeWeightedBuckets(readings, {
          bucketMs: span,
          maxHoldMs: HOLD,
          range: { end: range.end, start: readRange.start },
        })
        const result = await store.queryTimeWeightedRollup({
          bucket,
          range: readRange,
          seriesIds: [seriesId],
          tierWindowMs: 'unrestricted',
          vesselId: id,
        })
        expect(result.truncated).toBe(false)
        expect(result.rows.map((row) => row.bucket.getTime())).toEqual(
          reference.map((row) => row.start.getTime()),
        )
        for (const [index, row] of result.rows.entries()) {
          const expected = reference[index]!
          expect(row.heldMs, `${bucket} ${row.bucket.toISOString()} heldMs`).toBe(expected.heldMs)
          expect(row.avg, `${bucket} ${row.bucket.toISOString()} avg`).toBeCloseTo(expected.mean, 9)
          expect(row.n, `${bucket} ${row.bucket.toISOString()} n`).toBe(expected.n)
          expect(row.min).toBe(expected.min)
          expect(row.max).toBe(expected.max)
          expect(row.last).toBe(expected.last)
        }
      }
    }

    it('gives the held-value fixture its time-weighted mean, where the sample rollup says 15', async () => {
      const id = vessel()
      const seriesId = await writeSeries(id, 'environment.wind.speedApparent', HELD_VALUE_FIXTURE)
      // A shadow instrument must not reach the time-weighted ladder either.
      await writeSeries(
        id,
        'environment.wind.speedApparent',
        [{ ts: new Date(HELD_VALUE_T0 + 10_000), value: 999 }],
        1,
      )

      const refresh = await store.refreshTimeWeighted({
        maxHoldMs: HOLD,
        range: { end: new Date(HELD_VALUE_T0 + 210_001), start: new Date(HELD_VALUE_T0) },
        vesselId: id,
      })
      expect(refresh.range).toEqual({
        end: new Date(HELD_VALUE_T0 + 840_000),
        start: new Date(HELD_VALUE_T0),
      })

      const minute = await store.queryTimeWeightedRollup({
        bucket: '1m',
        range: { end: new Date(HELD_VALUE_T0 + 60_000), start: new Date(HELD_VALUE_T0) },
        seriesIds: [seriesId],
        tierWindowMs: 'unrestricted',
        vesselId: id,
      })
      expect(minute.rows[0]!.avg).toBeCloseTo(700 / 60, 9)

      await client.query(
        "CALL refresh_continuous_aggregate('telemetry_numeric_1m', $1::timestamptz, $2::timestamptz)",
        [new Date(HELD_VALUE_T0), new Date(HELD_VALUE_T0 + 600_000)],
      )
      const sample = await store.queryRollup({
        bucket: '1m',
        range: { end: new Date(HELD_VALUE_T0 + 60_000), start: new Date(HELD_VALUE_T0) },
        seriesIds: [seriesId],
        tierWindowMs: 'unrestricted',
        vesselId: id,
      })
      expect(sample.rows[0]!.avg).toBe(15)

      await assertLadderEqualsReference(id, seriesId, HELD_VALUE_FIXTURE, refresh.range!)

      // Idempotent: a second refresh changes nothing.
      await store.refreshTimeWeighted({
        maxHoldMs: HOLD,
        range: { end: new Date(HELD_VALUE_T0 + 210_001), start: new Date(HELD_VALUE_T0) },
        vesselId: id,
      })
      await assertLadderEqualsReference(id, seriesId, HELD_VALUE_FIXTURE, refresh.range!)
    }, 120_000)

    it('equals the reference on a seeded random change-only series, and after a late row', async () => {
      const id = vessel()
      const random = mulberry32(0x13_57_9b_df)
      // Six hours across a UTC midnight, with outages longer than the hold.
      const start = Date.parse('2026-09-20T21:00:00.000Z')
      const readings: TimeWeightedReading[] = []
      for (let ts = start; ts < start + 6 * 3_600_000;) {
        readings.push({ ts: new Date(ts), value: Math.round(random() * 1000) / 10 })
        const r = random()
        ts +=
          r < 0.01
            ? 900_000 + Math.floor(random() * 1_800_000)
            : 1000 + Math.floor(random() * 60_000)
      }
      expect(readings.length).toBeGreaterThan(150)
      const seriesId = await writeSeries(id, 'environment.outside.pressure', readings)
      const range = { end: new Date(start + 6 * 3_600_000), start: new Date(start) }
      const refresh = await store.refreshTimeWeighted({ maxHoldMs: HOLD, range, vesselId: id })
      expect(refresh.statements).toBe(4)
      await assertLadderEqualsReference(id, seriesId, readings, refresh.range!)

      // A late store-and-forward row inside a long hold: refreshing ONLY its
      // own instant must fix the minutes after it (it shortens the previous
      // hold and changes what they carry in).
      const late = { ts: new Date(readings[100]!.ts.getTime() + 500), value: -42 }
      await writeSeries(id, 'environment.outside.pressure', [late])
      await store.refreshTimeWeighted({
        maxHoldMs: HOLD,
        range: { end: new Date(late.ts.getTime() + 1), start: late.ts },
        vesselId: id,
      })
      await assertLadderEqualsReference(id, seriesId, [...readings, late], refresh.range!)
    }, 180_000)
  })

  describe('AIS tables', () => {
    it('stores a contact and an encounter with a time-measured target track', async () => {
      const id = vessel()
      await client.query(
        `INSERT INTO ais_contact (vessel_id, mmsi, first_seen, last_seen, name, ship_type, length_m, static_extra)
         VALUES ($1::uuid, 367000000, now() - INTERVAL '1 hour', now(), 'TEST TARGET', 37, 12.5, '{"aisClass":"B"}'::jsonb)`,
        [id],
      )
      const start = Date.parse('2026-10-01T15:00:00.000Z') / 1000
      const track = `LINESTRING M(-82.5 27.9 ${start}, -82.49 27.91 ${start + 60}, -82.48 27.92 ${start + 120})`
      await client.query(
        `INSERT INTO ais_encounter (vessel_id, mmsi, start_ts, end_ts, cpa_distance_m, cpa_ts, track)
         VALUES ($1::uuid, 367000000, to_timestamp($2), to_timestamp($3), 812.5, to_timestamp($4),
                 ST_GeogFromText($5))
         ON CONFLICT (vessel_id, mmsi, start_ts) DO NOTHING`,
        [id, start, start + 120, start + 60, track],
      )
      const read = await client.query<{ m_end: number; points: number }>(
        `SELECT ST_NPoints(track::geometry) AS points, ST_M(ST_EndPoint(track::geometry)) AS m_end
           FROM ais_encounter WHERE vessel_id = $1::uuid`,
        [id],
      )
      expect(read.rows[0]).toEqual({ m_end: start + 120, points: 3 })

      // A closest approach outside the encounter is refused.
      await expect(
        client.query(
          `INSERT INTO ais_encounter (vessel_id, mmsi, start_ts, end_ts, cpa_distance_m, cpa_ts)
           VALUES ($1::uuid, 367000001, to_timestamp($2), to_timestamp($3), 1, to_timestamp($4))`,
          [id, start, start + 60, start + 600],
        ),
      ).rejects.toThrow(/check constraint/u)

      await client.query(
        `INSERT INTO ais_encounter_open (vessel_id, mmsi, start_ts, last_seen, cpa_distance_m, cpa_ts)
         VALUES ($1::uuid, 367000000, to_timestamp($2), to_timestamp($2), 900, to_timestamp($2))`,
        [id, start],
      )
      await expect(
        client.query(
          `INSERT INTO ais_encounter_open (vessel_id, mmsi, start_ts, last_seen, cpa_distance_m, cpa_ts)
           VALUES ($1::uuid, 367000000, to_timestamp($2), to_timestamp($2), 900, to_timestamp($2))`,
          [id, start],
        ),
      ).rejects.toThrow(/duplicate key/u)
    })
  })

  it("keeps every raw row under globalRawWindowMs: 'never'", async () => {
    const id = vessel()
    const old = new Date(Date.now() - 400 * 86_400_000)
    await store.writeNumeric([
      { path: 'navigation.speedOverGround', ts: old, value: 3, vesselId: id },
    ])
    const result = await store.applyRetention({
      globalRawWindowMs: 'never',
      tiers: { free: { rawWindowMs: 86_400_000, rollupWindowMs: {}, vesselIds: [id] } },
    })
    expect(result.droppedRawOlderThan).toBeNull()
    expect(result.statements).toBe(2)
    const kept = await client.query<{ n: string }>(
      'SELECT count(*) AS n FROM telemetry_numeric WHERE vessel_id = $1::uuid',
      [id],
    )
    expect(Number(kept.rows[0]?.n)).toBe(1)
  }, 60_000)
})
