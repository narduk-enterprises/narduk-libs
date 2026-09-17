import { describe, expect, it } from 'vitest'

import { NardukTimeseriesError } from '../src/errors.js'
import {
  DEFAULT_MAX_ROLLUP_ROWS,
  DEFAULT_MAX_TRACK_POINTS,
  buildRollupQuery,
  planTrackQuery,
} from '../src/timescale/query.js'

const VESSEL = '11111111-1111-4111-8111-111111111111'
const RANGE = {
  end: new Date('2026-09-12T00:00:00.000Z'),
  start: new Date('2026-09-11T00:00:00.000Z'),
}

function rollupQuery(maxRows?: number) {
  return {
    bucket: '1h' as const,
    ...(maxRows === undefined ? {} : { maxRows }),
    range: RANGE,
    seriesIds: [1],
    tierWindowMs: 'unrestricted' as const,
    vesselId: VESSEL,
  }
}

describe('working-set ceilings', () => {
  it('refuses a client maxRows of 1e12 with RANGE_INVALID', () => {
    expect(() => buildRollupQuery(rollupQuery(1e12))).toThrow(NardukTimeseriesError)
    expect(() => buildRollupQuery(rollupQuery(1e12))).toThrow(/RANGE_INVALID/u)
  })

  it('refuses a client maxPoints of 1e12 with RANGE_INVALID', () => {
    expect(() => planTrackQuery({ maxPoints: 1e12, range: RANGE, vesselId: VESSEL })).toThrow(
      /RANGE_INVALID/u,
    )
  })

  it('refuses maxRows and maxPoints above the published defaults', () => {
    expect(() => buildRollupQuery(rollupQuery(DEFAULT_MAX_ROLLUP_ROWS + 1))).toThrow(
      /RANGE_INVALID/u,
    )
    expect(() =>
      planTrackQuery({
        maxPoints: DEFAULT_MAX_TRACK_POINTS + 1,
        range: RANGE,
        vesselId: VESSEL,
      }),
    ).toThrow(/RANGE_INVALID/u)
  })

  it('keeps the published defaults when the caller omits a cap', () => {
    expect(buildRollupQuery(rollupQuery()).params.at(-1)).toBe(DEFAULT_MAX_ROLLUP_ROWS + 1)
    expect(planTrackQuery({ range: RANGE, vesselId: VESSEL }).maxPoints).toBe(
      DEFAULT_MAX_TRACK_POINTS,
    )
  })

  it('lets a server-side ceiling raise the bound', () => {
    const built = buildRollupQuery(rollupQuery(80_000), undefined, { maxRowsCeiling: 100_000 })
    expect(built.params.at(-1)).toBe(80_001)
    const plan = planTrackQuery(
      { maxPoints: 8_000, range: RANGE, vesselId: VESSEL },
      { maxPointsCeiling: 10_000 },
    )
    expect(plan.maxPoints).toBe(8_000)
  })
})
