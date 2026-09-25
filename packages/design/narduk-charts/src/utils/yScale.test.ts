import { describe, expect, it } from 'vitest'
import { symlogForward, symlogInverse, createYAxisMap, dataValueFromBottomPx } from './yScale'

describe('symlogForward / symlogInverse', () => {
  it('round-trips small values through linear region', () => {
    const c = 1
    expect(symlogInverse(symlogForward(0.5, c), c)).toBeCloseTo(0.5, 5)
    expect(symlogInverse(symlogForward(-0.3, c), c)).toBeCloseTo(-0.3, 5)
  })

  it('round-trips larger magnitudes', () => {
    const c = 1
    for (const y of [12, -50, 2000]) {
      expect(symlogInverse(symlogForward(y, c), c)).toBeCloseTo(y, 4)
    }
  })
})

describe('createYAxisMap', () => {
  it('maps linear domain to plot height', () => {
    const m = createYAxisMap('linear', [0, 100], [], 200)
    expect(m.yFromBottom(0)).toBe(0)
    expect(m.yFromBottom(100)).toBe(200)
    expect(m.ticks.length).toBeGreaterThan(0)
  })

  it('linear without zero anchor fits high-only prices (OHLC)', () => {
    const m = createYAxisMap('linear', [21_050, 21_180], [], 100, { linearFromZero: false })
    expect(m.domain.min).toBeGreaterThan(20_000)
    expect(m.domain.max).toBeGreaterThanOrEqual(21_180)
    expect(m.yFromBottom(21_050)).toBeLessThan(m.yFromBottom(21_180))
  })

  it('pads relative linear domains so extrema do not touch the plot bounds', () => {
    const m = createYAxisMap('linear', [11, 15], [], 100, {
      linearFromZero: false,
      linearPaddingRatio: 0.1,
    })
    expect(m.domain.min).toBeLessThan(11)
    expect(m.domain.max).toBeGreaterThan(15)
  })

  it('builds positive log domain', () => {
    const m = createYAxisMap('log', [1, 1000], [], 100)
    expect(m.domain.min).toBeGreaterThan(0)
    expect(m.yFromBottom(10)).toBeGreaterThan(m.yFromBottom(1))
  })
})

describe('dataValueFromBottomPx', () => {
  it('inverts linear axis', () => {
    const m = createYAxisMap('linear', [10, 20], [], 100, { linearFromZero: false })
    expect(dataValueFromBottomPx('linear', 0, 100, m.domain)).toBeCloseTo(m.domain.min, 5)
    expect(dataValueFromBottomPx('linear', 100, 100, m.domain)).toBeCloseTo(m.domain.max, 5)
    const mid = dataValueFromBottomPx('linear', 50, 100, m.domain)
    expect(mid).toBeGreaterThan(m.domain.min)
    expect(mid).toBeLessThan(m.domain.max)
  })

  it('inverts log axis', () => {
    const m = createYAxisMap('log', [1, 100], [], 100)
    const mid = dataValueFromBottomPx('log', 50, 100, m.domain)
    expect(mid).toBeGreaterThan(1)
    expect(mid).toBeLessThan(100)
  })
})

describe('createYAxisMap pinned domains', () => {
  it('uses a pinned linear ceiling exactly, without rounding it out to a nice tick', () => {
    // 4_237 is deliberately not a round number: the derived path runs it
    // through niceScale and reports a rounder ceiling, which is the defect —
    // an axis label beside a table of the same figure shows a second number.
    const m = createYAxisMap('linear', [120, 4_237], [], 200, { domainMin: 0, domainMax: 4_237 })
    expect(m.domain.min).toBe(0)
    expect(m.domain.max).toBe(4_237)
    expect(m.yFromBottom(4_237)).toBe(200)
    expect(m.yFromBottom(0)).toBe(0)
  })

  it('gives two charts with different data the same scale when handed the same bound', () => {
    const quiet = createYAxisMap('linear', [1, 2, 4], [], 100, { domainMin: 0, domainMax: 4_000 })
    const busy = createYAxisMap('linear', [3_100, 4_000], [], 100, {
      domainMin: 0,
      domainMax: 4_000,
    })
    expect(quiet.domain).toEqual(busy.domain)
    // The quiet series must draw near the floor, not fill its own plot.
    expect(quiet.yFromBottom(4)).toBeLessThan(1)
    expect(busy.yFromBottom(4_000)).toBe(100)
  })

  it('honours one pinned end while still deriving the other', () => {
    const m = createYAxisMap('linear', [40, 90], [], 100, { domainMax: 100 })
    expect(m.domain.max).toBe(100)
    // linearFromZero defaults on, so the derived floor is still 0.
    expect(m.domain.min).toBe(0)
  })

  it('spreads ticks evenly across a pinned domain and honours maxTicks', () => {
    const m = createYAxisMap('linear', [0, 900], [], 100, {
      domainMin: 0,
      domainMax: 900,
      maxTicks: 3,
    })
    expect(m.ticks.map(t => t.value)).toEqual([0, 450, 900])
  })

  it('guards a degenerate pinned domain rather than dividing by zero', () => {
    const m = createYAxisMap('linear', [0], [], 100, { domainMin: 5, domainMax: 5 })
    expect(m.domain.max).toBeGreaterThan(m.domain.min)
    expect(Number.isFinite(m.yFromBottom(5))).toBe(true)
  })

  it('pins a domain even when the chart was handed no values at all', () => {
    const m = createYAxisMap('linear', [], [], 100, { domainMin: 0, domainMax: 50 })
    expect(m.domain).toEqual({ min: 0, max: 50 })
  })

  it('pins a log domain, ignoring a non-positive floor a log axis cannot take', () => {
    const m = createYAxisMap('log', [5, 500], [], 100, { domainMin: 0, domainMax: 1_000 })
    expect(m.domain.max).toBeCloseTo(1_000, 6)
    expect(m.domain.min).toBeGreaterThan(0)
    expect(m.yFromBottom(1_000)).toBeCloseTo(100, 6)
  })

  it('pins a symlog domain in data space, spacing ticks evenly in transformed space', () => {
    const m = createYAxisMap('symlog', [-40, 80], [], 100, { domainMin: -100, domainMax: 100 })
    expect(m.domain.min).toBeCloseTo(-100, 4)
    expect(m.domain.max).toBeCloseTo(100, 4)
    expect(m.yFromBottom(-100)).toBeCloseTo(0, 6)
    expect(m.yFromBottom(100)).toBeCloseTo(100, 6)
  })

  it('leaves the derived path untouched when no bound is given', () => {
    const derived = createYAxisMap('linear', [0, 4_237], [], 200)
    expect(derived.domain.max).toBeGreaterThan(4_237)
  })
})

// #929: every-mode domain math used to spread all values into Math.min/max.
describe('createYAxisMap with large inputs', () => {
  const values = Array.from({ length: 160_000 }, (_, index) => (index % 1000) + 1)
  it.each(['linear', 'log', 'symlog'] as const)('does not throw in %s mode', mode => {
    expect(() => createYAxisMap(mode, values, [], 200)).not.toThrow()
  })
})
