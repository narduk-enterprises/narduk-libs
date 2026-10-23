import { createProtocolFake } from '@narduk-enterprises/narduk-postgres/testing'
import { describe, expect, it } from 'vitest'

import { bucketReadings } from '../src/index.js'
import { validateRetentionPolicy } from '../src/policy.js'
import { createTimescaleHistoryStore } from '../src/timescale/index.js'

const V1 = '11111111-1111-1111-1111-111111111111'
const V2 = '22222222-2222-2222-2222-222222222222'

describe('ponytail-5 s6 timeseries', () => {
  it('#8 a path containing the join character cannot collide with two other series', async () => {
    const resolver = createProtocolFake().respondTo(/INSERT INTO series/u, (params) => {
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
    const store = createTimescaleHistoryStore({ executor: resolver })
    const d = (vesselId: string, path: string) => ({
      path,
      unit: null,
      valueKind: 'numeric' as const,
      vesselId,
    })
    const tricky = d(V1, `navigation.speed|36:${V2}:navigation.heading`)
    const pair = [d(V1, 'navigation.speed'), d(V2, 'navigation.heading')]
    // Concurrent: the second call must not await the first one's differing result.
    const [a, b] = await Promise.all([store.resolveSeries([tricky]), store.resolveSeries(pair)])
    expect(a).toHaveLength(1)
    expect(b).toHaveLength(2)
  })

  it('#9 a Chatham fall-back reading sits inside its bucket interval', () => {
    const at = '2026-04-04T14:00:00.000Z'
    const { buckets } = bucketReadings([{ at }], {
      bucket: '1h',
      fields: { x: () => 1 },
      time: (r: { at: string }) => r.at,
      timeZone: 'Pacific/Chatham',
    })
    const ms = Date.parse(at)
    expect(buckets[0]!.start.getTime()).toBeLessThanOrEqual(ms)
    expect(buckets[0]!.end.getTime()).toBeGreaterThan(ms)
  })

  it('#15 a time string with no offset is skipped, not read in the process zone', () => {
    const { buckets, skipped } = bucketReadings(
      [{ at: '2026-09-18T20:30:00' }, { at: '2026-09-18T20:30:00Z' }, { at: '2026-09-18' }],
      { bucket: '1d', fields: { x: () => 1 }, time: (r) => r.at },
    )
    expect(skipped).toBe(1)
    expect(buckets[0]!.rows).toBe(2)
  })

  it('#18 one vessel on two track tiers is refused, in either spelling', () => {
    const policy = (second: string) => ({
      globalRawWindowMs: 86_400_000,
      tiers: {
        free: {
          rollupWindowMs: {},
          trackWindowMs: 7 * 86_400_000,
          vesselIds: [V1.toUpperCase()],
        },
        paid: { rollupWindowMs: {}, trackWindowMs: 365 * 86_400_000, vesselIds: [second] },
      },
    })
    expect(() => validateRetentionPolicy(policy(V1))).toThrow(/two track tiers/)
    expect(() => validateRetentionPolicy(policy(V2))).not.toThrow()
  })
})
