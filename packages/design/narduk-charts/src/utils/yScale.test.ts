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
