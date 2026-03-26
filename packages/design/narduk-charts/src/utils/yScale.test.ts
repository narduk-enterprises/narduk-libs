import { describe, expect, it } from 'vitest'
import { symlogForward, symlogInverse, createYAxisMap } from './yScale'

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

  it('builds positive log domain', () => {
    const m = createYAxisMap('log', [1, 1000], [], 100)
    expect(m.domain.min).toBeGreaterThan(0)
    expect(m.yFromBottom(10)).toBeGreaterThan(m.yFromBottom(1))
  })
})
