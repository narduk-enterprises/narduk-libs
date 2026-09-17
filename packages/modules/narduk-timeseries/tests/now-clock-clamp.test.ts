/**
 * A client-supplied `now` must not widen a rollup read or deepen a retention
 * delete. These tests pin both directions of that clamp.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { validateRetentionPolicy } from '../src/policy.js'
import { buildRollupQuery, clipRollupRange } from '../src/timescale/query.js'
import { buildRetentionStatements } from '../src/timescale/retention.js'
import type { RollupQuery } from '../src/types.js'

const DAY = 86_400_000
const VESSEL = '11111111-1111-4111-8111-111111111111'

function query(
  overrides: Partial<RollupQuery> & Pick<RollupQuery, 'range' | 'tierWindowMs'>,
): RollupQuery {
  return {
    bucket: '1h',
    seriesIds: [7],
    vesselId: VESSEL,
    ...overrides,
  }
}

function expectNear(actualMs: number, expectedMs: number, slackMs = 2_000): void {
  expect(actualMs).toBeGreaterThanOrEqual(expectedMs - slackMs)
  expect(actualMs).toBeLessThanOrEqual(expectedMs + slackMs)
}

describe('clipRollupRange clock clamp', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('does not return unclipped data beyond the real-time tier floor when now is in the past', () => {
    const realNowMs = Date.now()
    const pastNow = new Date(realNowMs - 365 * DAY)
    const tierWindowMs = 30 * DAY
    const range = {
      end: new Date(realNowMs),
      start: new Date(realNowMs - 200 * DAY),
    }

    const plan = clipRollupRange(query({ now: pastNow, range, tierWindowMs }))

    expect(plan.clipped).toBe(true)
    expect(plan.empty).toBe(false)
    expect(plan.range.start.getTime()).not.toBe(range.start.getTime())
    expectNear(plan.range.start.getTime(), realNowMs - tierWindowMs)
    // The loosened floor from pastNow would sit about a year further back.
    expect(plan.range.start.getTime()).toBeGreaterThan(pastNow.getTime() - tierWindowMs + 100 * DAY)
  })

  it('leaves a range inside the real-time window unclipped even if now is in the past', () => {
    const realNowMs = Date.now()
    const range = {
      end: new Date(realNowMs),
      start: new Date(realNowMs - 2 * DAY),
    }

    const plan = clipRollupRange(
      query({
        now: new Date(realNowMs - 365 * DAY),
        range,
        tierWindowMs: 30 * DAY,
      }),
    )

    expect(plan.clipped).toBe(false)
    expect(plan.empty).toBe(false)
    expect(plan.range).toEqual(range)
  })

  it('marks a range wholly older than the real-time floor empty and clipped', () => {
    const realNowMs = Date.now()
    const pastNow = new Date(realNowMs - 365 * DAY)
    const tierWindowMs = 30 * DAY
    const range = {
      end: new Date(realNowMs - 200 * DAY),
      start: new Date(realNowMs - 210 * DAY),
    }

    const plan = clipRollupRange(query({ now: pastNow, range, tierWindowMs }))

    expect(plan.clipped).toBe(true)
    expect(plan.empty).toBe(true)
    expectNear(plan.range.start.getTime(), realNowMs - tierWindowMs)
    expect(plan.range.end.getTime()).toBe(plan.range.start.getTime())
  })

  it('lets a future now tighten the floor', () => {
    const realNowMs = Date.now()
    const futureNow = new Date(realNowMs + 10 * DAY)
    const tierWindowMs = 30 * DAY
    const range = {
      end: new Date(realNowMs),
      // Inside the real 30-day window, outside the tightened (real+10-30) floor.
      start: new Date(realNowMs - 25 * DAY),
    }

    const plan = clipRollupRange(query({ now: futureNow, range, tierWindowMs }))

    expect(plan.clipped).toBe(true)
    expect(plan.empty).toBe(false)
    expectNear(plan.range.start.getTime(), futureNow.getTime() - tierWindowMs)
  })

  it('binds the real-time floor on the rollup statement when now is in the past', () => {
    const realNowMs = Date.now()
    const tierWindowMs = 30 * DAY
    const built = buildRollupQuery(
      query({
        now: new Date(realNowMs - 365 * DAY),
        range: { end: new Date(realNowMs), start: new Date(realNowMs - 200 * DAY) },
        tierWindowMs,
      }),
    )

    expect(built.clipped).toBe(true)
    expectNear((built.params[2] as Date).getTime(), realNowMs - tierWindowMs)
    expectNear(built.range.start.getTime(), realNowMs - tierWindowMs)
  })

  it('still pins the floor when Date is frozen to the fixture clock', () => {
    const frozen = new Date('2020-01-15T00:00:00.000Z')
    vi.useFakeTimers()
    vi.setSystemTime(frozen)

    const plan = clipRollupRange(
      query({
        now: frozen,
        range: { end: frozen, start: new Date('2019-10-01T00:00:00.000Z') },
        tierWindowMs: 30 * DAY,
      }),
    )

    expect(plan.clipped).toBe(true)
    expect(plan.empty).toBe(false)
    expect(plan.range.start).toEqual(new Date('2019-12-16T00:00:00.000Z'))
  })
})

describe('retention clock clamp', () => {
  it('does not let a future now move cutoffs later than real time would', () => {
    const windowMs = 7 * DAY
    const before = Date.now()
    const statements = buildRetentionStatements({
      globalRawWindowMs: windowMs,
      globalRollupWindowMs: { '1m': 30 * DAY },
      now: new Date(before + 365 * DAY),
      tiers: {},
    })
    const after = Date.now()

    const rawCutoff = (statements[0]!.params[0] as Date).getTime()
    expect(rawCutoff).toBeGreaterThanOrEqual(before - windowMs)
    expect(rawCutoff).toBeLessThanOrEqual(after - windowMs)

    const rollup = statements.find((statement) => statement.rollup === '1m')
    const rollupCutoff = (rollup!.params[0] as Date).getTime()
    expect(rollupCutoff).toBeGreaterThanOrEqual(before - 30 * DAY)
    expect(rollupCutoff).toBeLessThanOrEqual(after - 30 * DAY)
  })

  it('honors a past now so cutoffs stay earlier (less destructive)', () => {
    const past = new Date('2026-09-12T03:00:00.000Z')
    const windowMs = 7 * DAY
    const statements = buildRetentionStatements({
      globalRawWindowMs: windowMs,
      now: past,
      tiers: {},
    })

    expect(statements[0]!.params[0]).toEqual(new Date(past.getTime() - windowMs))
  })

  it('reports a clamped now from validateRetentionPolicy, not a future clock', () => {
    const before = Date.now()
    const validated = validateRetentionPolicy({
      globalRawWindowMs: 7 * DAY,
      now: new Date(before + 365 * DAY),
      tiers: {},
    })
    const after = Date.now()

    expect(validated.now.getTime()).toBeGreaterThanOrEqual(before)
    expect(validated.now.getTime()).toBeLessThanOrEqual(after)
  })
})
