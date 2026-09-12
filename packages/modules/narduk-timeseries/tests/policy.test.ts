/**
 * Retention policy validation.
 *
 * The library holds no tier numbers -- round 20 put those in the consumer -- so
 * the only thing it can enforce is that a policy is internally coherent before
 * it turns into DELETE statements against a hypertable.
 */
import { describe, expect, it } from 'vitest'

import { NardukTimeseriesError } from '../src/errors.js'
import {
  DEFAULT_MAX_VESSELS_PER_STATEMENT,
  retentionPolicyIdentity,
  validateRetentionPolicy,
} from '../src/policy.js'

const VESSEL = '11111111-1111-4111-8111-111111111111'

/** The mybo-at-v2 round-20 shape, as the consumer will pass it. */
const round20 = {
  globalRawWindowMs: 7 * 86_400_000,
  tiers: {
    free: {
      rawWindowMs: 86_400_000,
      rollupWindowMs: { '1m': 7 * 86_400_000, '1h': 30 * 86_400_000 },
      trackWindowMs: 7 * 86_400_000,
      vesselIds: [VESSEL],
    },
  },
}

describe('validateRetentionPolicy', () => {
  it('accepts the round-20 shape and fills in the statement ceiling', () => {
    const validated = validateRetentionPolicy(round20)
    expect(validated.maxVesselsPerStatement).toBe(DEFAULT_MAX_VESSELS_PER_STATEMENT)
    expect(validated.now).toBeInstanceOf(Date)
  })

  it('refuses a tier asking for more raw history than the global window keeps', () => {
    // The trap: a tier promises 30 days of raw while drop_chunks removes it at
    // 7. Without this check the promise is silently broken in production.
    expect(() =>
      validateRetentionPolicy({
        ...round20,
        tiers: { pro: { rawWindowMs: 30 * 86_400_000, rollupWindowMs: {}, vesselIds: [] } },
      }),
    ).toThrow(NardukTimeseriesError)
  })

  it('refuses a ladder that drops a coarser level before the finer one', () => {
    expect(() =>
      validateRetentionPolicy({
        ...round20,
        tiers: {
          pro: {
            rollupWindowMs: { '1m': 365 * 86_400_000, '1h': 30 * 86_400_000 },
            vesselIds: [],
          },
        },
      }),
    ).toThrow(/coarser|summarizes/iu)
  })

  it.each([
    ['zero', 0],
    ['negative', -1],
    ['not a number', 'seven days'],
    ['infinite', Number.POSITIVE_INFINITY],
  ])('refuses a %s global window', (_label, value) => {
    expect(() =>
      validateRetentionPolicy({ ...round20, globalRawWindowMs: value as number }),
    ).toThrow(NardukTimeseriesError)
  })

  it('refuses a tier with no vessel list rather than sweeping every vessel', () => {
    expect(() =>
      validateRetentionPolicy({
        ...round20,
        tiers: { pro: { rollupWindowMs: {}, vesselIds: undefined as unknown as string[] } },
      }),
    ).toThrow(/vesselIds/u)
  })

  it('refuses a fractional statement ceiling', () => {
    expect(() => validateRetentionPolicy({ ...round20, maxVesselsPerStatement: 10.5 })).toThrow(
      /maxVesselsPerStatement/u,
    )
  })
})

describe('unswept rollup levels', () => {
  it('reports the levels no global window sweeps instead of guessing one', () => {
    // "1d is missing from the policy" and "1d is kept forever" looked identical
    // from the outside; round 23 (R23-2) keeps the behaviour and adds the
    // report.
    const validated = validateRetentionPolicy({
      ...round20,
      globalRollupWindowMs: { '1m': 30 * 86_400_000 },
    })
    expect(validated.unsweptRollupLevels).toEqual(['15m', '1h', '1d'])
  })

  it('reports every level when the policy declares no rollup windows at all', () => {
    expect(validateRetentionPolicy(round20).unsweptRollupLevels).toEqual(['1m', '15m', '1h', '1d'])
  })

  it('refuses a tier promising more rollup depth than the store retains', () => {
    expect(() =>
      validateRetentionPolicy({
        ...round20,
        globalRollupWindowMs: { '1h': 7 * 86_400_000 },
      }),
    ).toThrow(/global 1h window/u)
  })

  it('refuses a global ladder that narrows as it coarsens', () => {
    expect(() =>
      validateRetentionPolicy({
        ...round20,
        globalRollupWindowMs: { '1h': 30 * 86_400_000, '1m': 365 * 86_400_000 },
      }),
    ).toThrow(NardukTimeseriesError)
  })
})

describe('retentionPolicyIdentity', () => {
  it('is stable across equal policies and independent of now', () => {
    const first = retentionPolicyIdentity(validateRetentionPolicy({ ...round20, now: new Date(0) }))
    const second = retentionPolicyIdentity(
      validateRetentionPolicy({ ...round20, now: new Date('2026-09-12T00:00:00Z') }),
    )
    expect(first).toBe(second)
  })

  it('changes when the policy would delete something different', () => {
    const base = retentionPolicyIdentity(validateRetentionPolicy(round20))
    const wider = retentionPolicyIdentity(
      validateRetentionPolicy({ ...round20, globalRawWindowMs: 14 * 86_400_000 }),
    )
    const moreVessels = retentionPolicyIdentity(
      validateRetentionPolicy({
        ...round20,
        tiers: {
          free: {
            ...round20.tiers.free,
            vesselIds: [VESSEL, '22222222-2222-4222-8222-222222222222'],
          },
        },
      }),
    )
    expect(wider).not.toBe(base)
    expect(moreVessels).not.toBe(base)
  })
})
