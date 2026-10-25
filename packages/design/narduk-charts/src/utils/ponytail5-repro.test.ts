// ponytail-5 audit regression tests
import { describe, expect, it } from 'vitest'
import { aggregateCandlesDetailed, computeHistogramBins } from './math'
import type { CandleBar } from '../types'

function bar(i: number, h = 1): CandleBar {
  return { t: i * 1000, o: 1, h, l: 0.5, c: 1, v: 10 }
}

describe('maps-charts #2: aggregateCandlesDetailed buckets must partition bars', () => {
  it('puts the spike in exactly one bucket (5 bars -> 2 buckets)', () => {
    const bars = [bar(0), bar(1), bar(2, 100), bar(3), bar(4)]
    const out = aggregateCandlesDetailed(bars, 2)
    expect(out.filter(b => b.bar.h === 100).length).toBe(1)
  })
  it('assigns every index to exactly one bucket (1000 bars -> 512)', () => {
    const bars = Array.from({ length: 1000 }, (_, i) => bar(i))
    const out = aggregateCandlesDetailed(bars, 512)
    const counts = new Array(1000).fill(0)
    for (const b of out) for (let i = b.i0; i <= b.i1; i++) counts[i]++
    expect(counts.filter(c => c !== 1).length).toBe(0)
  })
})

describe('maps-charts #4: computeHistogramBins non-finite samples', () => {
  it('does not throw on NaN', () => {
    expect(() => computeHistogramBins([1, 2, NaN, 4], 4)).not.toThrow()
  })
  it('does not throw on Infinity', () => {
    expect(() => computeHistogramBins([1, 2, Infinity], 4)).not.toThrow()
  })
})
