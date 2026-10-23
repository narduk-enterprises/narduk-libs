/**
 * The "raw never swept" retention mode (mybo-at-v2 D-140: "roll up, never
 * delete"). `globalRawWindowMs: 'never'` must plan no raw statement at all,
 * and a policy that also omits rollup and track windows must plan nothing.
 */
import { createProtocolFake } from '@narduk-enterprises/narduk-postgres/testing'
import { describe, expect, it } from 'vitest'

import { NardukTimeseriesError } from '../src/errors.js'
import { retentionPolicyIdentity, validateRetentionPolicy } from '../src/policy.js'
import { buildRetentionStatements, createTimescaleHistoryStore } from '../src/timescale/index.js'
import type { RetentionPolicyInput } from '../src/types.js'

const VESSEL = '11111111-1111-4111-8111-111111111111'
const DAY = 86_400_000

const lossless: RetentionPolicyInput = {
  globalRawWindowMs: 'never',
  tiers: {
    // A read depth only: Free sees 24 h of raw, and nothing is deleted.
    free: { rawWindowMs: DAY, rollupWindowMs: { '1m': 30 * DAY }, vesselIds: [VESSEL] },
  },
}

describe("globalRawWindowMs: 'never'", () => {
  it('plans zero statements when nothing else has a window', () => {
    expect(buildRetentionStatements(lossless)).toEqual([])
    expect(validateRetentionPolicy(lossless).rawNeverSwept).toBe(true)
  })

  it('still sweeps the windows the caller did give, and never raw', () => {
    const statements = buildRetentionStatements({
      ...lossless,
      globalRollupWindowMs: { '1m': 90 * DAY },
    })
    expect(statements.map((statement) => statement.target)).toEqual(['telemetry_numeric_1m'])
    expect(statements.some((statement) => statement.target === 'telemetry_numeric')).toBe(false)
  })

  it('accepts any positive tier raw read depth, since there is no global ceiling', () => {
    expect(() =>
      validateRetentionPolicy({
        globalRawWindowMs: 'never',
        tiers: { paid: { rawWindowMs: 3650 * DAY, rollupWindowMs: {}, vesselIds: [VESSEL] } },
      }),
    ).not.toThrow()
    expect(() =>
      validateRetentionPolicy({
        globalRawWindowMs: 'never',
        tiers: { paid: { rawWindowMs: 0, rollupWindowMs: {}, vesselIds: [VESSEL] } },
      }),
    ).toThrow(NardukTimeseriesError)
  })

  it('refuses any other string, so a typo is never read as "keep forever"', () => {
    for (const value of ['Never', 'forever', '', 'infinity']) {
      expect(() =>
        validateRetentionPolicy({ ...lossless, globalRawWindowMs: value as 'never' }),
      ).toThrow(NardukTimeseriesError)
    }
  })

  it('has its own policy identity, distinct from any window', () => {
    const never = retentionPolicyIdentity(validateRetentionPolicy(lossless))
    const week = retentionPolicyIdentity(
      validateRetentionPolicy({ ...lossless, globalRawWindowMs: 7 * DAY }),
    )
    expect(never).not.toBe(week)
  })

  it('runs as lock and unlock only, and says raw was not swept', async () => {
    const database = createProtocolFake()
      .respondTo(/pg_try_advisory_lock/u, [{ locked: true, pid: 41 }])
      .respondTo(/pg_advisory_unlock/u, [{ pid: 41, unlocked: true }])
    const store = createTimescaleHistoryStore({
      executor: database,
      retention: { executor: database, maxConnections: 1 },
    })
    const result = await store.applyRetention(lossless)
    expect(result.droppedRawOlderThan).toBeNull()
    expect(result.deletedRowsByTarget).toEqual({})
    expect(result.statements).toBe(2)
    expect(result.skipped[0]).toBe("raw is never swept (globalRawWindowMs: 'never')")
    expect(database.countMatching(/drop_chunks|DELETE/u)).toBe(0)
  })
})
