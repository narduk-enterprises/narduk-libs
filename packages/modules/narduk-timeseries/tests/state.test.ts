/**
 * `telemetry_state` (migration 0004): encoding, the batched write, and the two
 * bounded reads, against the protocol fake. The live suite proves the SQL.
 */
import { createProtocolFake, type ProtocolFake } from '@narduk-enterprises/narduk-postgres/testing'
import { describe, expect, it } from 'vitest'

import { NardukTimeseriesError } from '../src/errors.js'
import {
  STATE_PARAMETERS_PER_ROW,
  buildStateWriteStatements,
  createTimescaleHistoryStore,
  decodeStateValue,
  encodeStateValue,
  planStateAtQuery,
  planStateTransitionsQuery,
  toStateRow,
} from '../src/timescale/index.js'
import type { StatePoint, StateValue } from '../src/types.js'

const VESSEL = '11111111-1111-4111-8111-111111111111'

function withSeriesResolution(fake: ProtocolFake): ProtocolFake {
  return fake.respondTo(/INSERT INTO series/u, (params) => {
    const rows: unknown[] = []
    for (let index = 0; index < params.length; index += 4) {
      rows.push({
        path: params[index + 1],
        series_id: 2000 + index / 4,
        unit: params[index + 2],
        value_kind: params[index + 3],
        vessel_id: params[index],
      })
    }
    return rows
  })
}

describe('state encoding', () => {
  it('stores a string as text, a bool as text and anything else as JSON', () => {
    expect(encodeStateValue('shore')).toEqual({ json: null, kind: 'text', text: 'shore' })
    expect(encodeStateValue(true)).toEqual({ json: null, kind: 'bool', text: 'true' })
    expect(encodeStateValue(false)).toEqual({ json: null, kind: 'bool', text: 'false' })
    expect(encodeStateValue({ state: 'alarm', method: ['sound'] })).toEqual({
      json: '{"state":"alarm","method":["sound"]}',
      kind: 'json',
      text: null,
    })
    // A SignalK value that went null is a state, and is storable: JSON null
    // is not SQL NULL, so the one-value CHECK holds.
    expect(encodeStateValue(null)).toEqual({ json: 'null', kind: 'json', text: null })
  })

  it('refuses a number, which is a numeric reading, and unserializable values', () => {
    expect(() => encodeStateValue(3 as unknown as StateValue)).toThrow(/writeNumeric/u)
    expect(() => encodeStateValue(undefined as unknown as StateValue)).toThrow(
      NardukTimeseriesError,
    )
    const cycle: Record<string, unknown> = {}
    cycle.self = cycle
    expect(() => encodeStateValue(cycle)).toThrow(NardukTimeseriesError)
    expect(() => encodeStateValue((() => 1) as unknown as StateValue)).toThrow(
      NardukTimeseriesError,
    )
  })

  it('round-trips through decode, by column first and series kind second', () => {
    for (const value of ['shore', true, false, { a: [1, 'b'] }, null, [1, 2]] as StateValue[]) {
      const encoded = encodeStateValue(value)
      expect(decodeStateValue(encoded.kind, encoded.text, encoded.json)).toEqual(value)
    }
    // A bool series that later sent a string reads the string back, not false.
    expect(decodeStateValue('bool', 'shore', null)).toBe('shore')
    expect(
      toStateRow({
        installation_role: '0',
        series_id: '7',
        ts: '2026-10-01T12:00:00.000Z',
        value_json: null,
        value_kind: 'bool',
        value_text: 'true',
      }),
    ).toEqual({
      installationRole: 0,
      seriesId: 7,
      ts: new Date('2026-10-01T12:00:00.000Z'),
      value: true,
      valueKind: 'bool',
    })
  })
})

describe('the state write', () => {
  it('binds six parameters a row, casts json from text, and chunks by the budget', () => {
    const batch = Array.from({ length: 10 }, (_, index) => ({
      path: 'electrical.venus.acSource',
      seriesId: 5,
      ts: new Date(Date.UTC(2026, 9, 1, 12, 0, index)),
      value: index % 2 === 0 ? 'shore' : { state: 'normal' },
      vesselId: VESSEL,
    }))
    const statements = buildStateWriteStatements(batch, 4 * STATE_PARAMETERS_PER_ROW)
    expect(statements.map((statement) => statement.rows)).toEqual([4, 4, 2])
    for (const statement of statements) {
      expect(statement.params).toHaveLength(statement.rows * STATE_PARAMETERS_PER_ROW)
      expect(statement.text).toContain('::text::jsonb')
      expect(statement.text).toMatch(/ON CONFLICT DO NOTHING$/u)
    }
    expect(statements[0]!.params.slice(0, 6)).toEqual([batch[0]!.ts, VESSEL, 5, 0, 'shore', null])
    expect(statements[0]!.params.slice(6, 12)).toEqual([
      batch[1]!.ts,
      VESSEL,
      5,
      0,
      null,
      '{"state":"normal"}',
    ])
  })

  it('names the caller index of a bad point, not its offset in a chunk', () => {
    const batch = Array.from({ length: 6 }, (_, index) => ({
      path: 'p',
      seriesId: 1,
      ts: new Date(Date.UTC(2026, 9, 1, 12, 0, index)),
      value: (index === 5 ? 1 : 'x') as StateValue,
      vesselId: VESSEL,
    }))
    expect(() => buildStateWriteStatements(batch, 2 * STATE_PARAMETERS_PER_ROW)).toThrow(/Point 5/u)
  })

  it('resolves once with the value kind, then inserts, through the store', async () => {
    const database = withSeriesResolution(createProtocolFake())
    const store = createTimescaleHistoryStore({ executor: database })
    const points: StatePoint[] = [
      {
        path: 'electrical.venus.acSource',
        ts: new Date(Date.UTC(2026, 9, 1, 12)),
        value: 'shore',
        vesselId: VESSEL,
      },
      {
        path: 'steering.autopilot.engaged',
        ts: new Date(Date.UTC(2026, 9, 1, 12)),
        value: true,
        vesselId: VESSEL,
      },
      {
        path: 'notifications.mob',
        ts: new Date(Date.UTC(2026, 9, 1, 12)),
        value: { state: 'alarm' },
        vesselId: VESSEL,
      },
    ]
    const first = await store.writeState(points)
    expect(first).toMatchObject({ rows: 3, seriesResolved: 3, statements: 2 })
    expect(database.statements[0]!.params.filter((_, index) => index % 4 === 3)).toEqual([
      'text',
      'bool',
      'json',
    ])
    const second = await store.writeState(points)
    // The series set is cached: one statement, the insert.
    expect(second).toMatchObject({ seriesFromCache: 3, statements: 1 })
  })

  it('fails a batch with a number in it before sending anything', async () => {
    const database = withSeriesResolution(createProtocolFake())
    const store = createTimescaleHistoryStore({ executor: database })
    await expect(
      store.writeState([
        { path: 'p', ts: new Date(), value: 4 as unknown as StateValue, vesselId: VESSEL },
      ]),
    ).rejects.toThrow(/writeNumeric/u)
    expect(database.statements).toHaveLength(0)
    expect(await store.writeState([])).toMatchObject({ rows: 0, statements: 0 })
  })
})

describe('state reads', () => {
  it('looks up the state at t one row per series, never below the tier floor', () => {
    const at = new Date()
    const plan = planStateAtQuery({
      at,
      seriesIds: [3, 3, 4],
      tierWindowMs: 86_400_000,
      vesselId: VESSEL,
    })
    expect(plan.clipped).toBe(true)
    expect(plan.query!.params[1]).toBe('3,4')
    expect(plan.query!.params[3]).toBeInstanceOf(Date)
    expect(plan.query!.text).toContain('LIMIT 1')
    expect(plan.query!.text).toContain('ts >= $4::timestamptz')

    const open = planStateAtQuery({
      at,
      seriesIds: [3],
      tierWindowMs: 'unrestricted',
      vesselId: VESSEL,
    })
    expect(open.clipped).toBe(false)
    expect(open.query!.params[3]).toBeNull()

    const old = planStateAtQuery({
      at: new Date(Date.now() - 3 * 86_400_000),
      seriesIds: [3],
      tierWindowMs: 86_400_000,
      vesselId: VESSEL,
    })
    expect(old).toEqual({ clipped: true, empty: true, query: null })
  })

  it('refuses a missing tier gate, a bad at, bad series ids and a bad role', () => {
    const base = {
      at: new Date(),
      seriesIds: [1],
      tierWindowMs: 'unrestricted' as const,
      vesselId: VESSEL,
    }
    expect(() =>
      planStateAtQuery({ ...base, tierWindowMs: undefined as unknown as number }),
    ).toThrow(NardukTimeseriesError)
    expect(() => planStateAtQuery({ ...base, at: new Date(Number.NaN) })).toThrow(
      NardukTimeseriesError,
    )
    expect(() => planStateAtQuery({ ...base, seriesIds: [] })).toThrow(NardukTimeseriesError)
    expect(() => planStateAtQuery({ ...base, seriesIds: [0] })).toThrow(NardukTimeseriesError)
    expect(() => planStateAtQuery({ ...base, installationRole: -1 })).toThrow(NardukTimeseriesError)
  })

  it('clips a transitions range to the tier floor and bounds its rows', () => {
    const now = Date.now()
    const plan = planStateTransitionsQuery({
      maxRows: 10,
      range: { end: new Date(now), start: new Date(now - 5 * 86_400_000) },
      seriesIds: [1],
      tierWindowMs: 86_400_000,
      vesselId: VESSEL,
    })
    expect(plan.clipped).toBe(true)
    expect(plan.range.start.getTime()).toBeGreaterThanOrEqual(now - 86_400_000)
    expect(plan.query!.params.at(-1)).toBe(11)
    expect(() =>
      planStateTransitionsQuery({
        maxRows: 10_001,
        range: { end: new Date(now), start: new Date(now - 1000) },
        seriesIds: [1],
        tierWindowMs: 'unrestricted',
        vesselId: VESSEL,
      }),
    ).toThrow(NardukTimeseriesError)
  })

  it('reports truncation and decodes rows through the store', async () => {
    const ts = new Date('2026-10-01T12:00:00.000Z')
    const database = createProtocolFake().respondTo(/FROM telemetry_state st/u, [
      {
        installation_role: 0,
        series_id: 1,
        ts,
        value_json: null,
        value_kind: 'text',
        value_text: 'shore',
      },
      {
        installation_role: 0,
        series_id: 1,
        ts,
        value_json: '{"a":1}',
        value_kind: 'json',
        value_text: null,
      },
    ])
    const store = createTimescaleHistoryStore({ executor: database })
    const result = await store.queryStateTransitions({
      maxRows: 1,
      range: { end: new Date(ts.getTime() + 1000), start: ts },
      seriesIds: [1],
      tierWindowMs: 'unrestricted',
      vesselId: VESSEL,
    })
    expect(result.truncated).toBe(true)
    expect(result.rows.map((row) => row.value)).toEqual(['shore'])
  })

  it('answers an at older than the tier window with no statement', async () => {
    const database = createProtocolFake()
    const store = createTimescaleHistoryStore({ executor: database })
    const at = new Date(Date.now() - 10 * 86_400_000)
    expect(
      await store.queryStateAt({ at, seriesIds: [1], tierWindowMs: 86_400_000, vesselId: VESSEL }),
    ).toEqual({ at, clipped: true, rows: [] })
    const old = await store.queryStateTransitions({
      range: { end: at, start: new Date(at.getTime() - 1000) },
      seriesIds: [1],
      tierWindowMs: 86_400_000,
      vesselId: VESSEL,
    })
    expect(old).toMatchObject({ clipped: true, rows: [], truncated: false })
    expect(database.statements).toHaveLength(0)
  })
})
