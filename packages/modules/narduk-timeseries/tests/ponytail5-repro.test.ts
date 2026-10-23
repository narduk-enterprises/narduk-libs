import { createProtocolFake } from '@narduk-enterprises/narduk-postgres/testing'
import { describe, expect, it } from 'vitest'

import { createTimescaleHistoryStore } from '../src/timescale/index.js'

const VESSEL = '11111111-1111-4111-8111-111111111111'
const resolver = () =>
  createProtocolFake().respondTo(/INSERT INTO series/u, (params) => {
    const rows: unknown[] = []
    for (let i = 0; i < params.length; i += 4) {
      rows.push({
        path: params[i + 1],
        series_id: 1 + i / 4,
        unit: params[i + 2],
        value_kind: params[i + 3],
        vessel_id: params[i],
      })
    }
    return rows
  })

describe('ponytail-5 #1 series unit', () => {
  it('a later non-null unit reaches the database across batches', async () => {
    const db = resolver()
    const store = createTimescaleHistoryStore({ executor: db })
    const d = (unit: string | null) => ({
      path: 'navigation.speed',
      unit,
      valueKind: 'numeric' as const,
      vesselId: VESSEL,
    })
    await store.resolveSeries([d(null)])
    await store.resolveSeries([d('m/s')])
    expect(db.countMatching(/INSERT INTO series/u)).toBe(2)
  })

  it('a later non-null unit in the same batch is bound', async () => {
    const db = resolver()
    const store = createTimescaleHistoryStore({ executor: db })
    await store.resolveSeries([
      { path: 'a', unit: null, valueKind: 'numeric', vesselId: VESSEL },
      { path: 'a', unit: 'm/s', valueKind: 'numeric', vesselId: VESSEL },
    ])
    const stmt = db.statements.find((s) => /INSERT INTO series/u.test(s.text))
    expect(stmt?.params[2]).toBe('m/s')
  })
})
