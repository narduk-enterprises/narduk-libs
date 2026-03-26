import { describe, expect, it } from 'vitest'
import {
  niceScale,
  linearScale,
  segmentLinePoints,
  lineSegmentsToPaths,
  closeAreaUnderLine,
  straightPath,
  decimateCategoryData,
  largestTriangleThreeBuckets,
  aggregateCandles,
  aggregateCandlesDetailed,
  candleTimeAtIndex,
  candleIndexAtTime,
} from './math'
import type { CandleBar } from '../types'

describe('niceScale', () => {
  it('expands equal min/max', () => {
    const s = niceScale(5, 5)
    expect(s.min).toBeLessThan(5)
    expect(s.max).toBeGreaterThan(5)
    expect(s.ticks.length).toBeGreaterThan(1)
  })

  it('includes clean ticks for 0–100', () => {
    const s = niceScale(0, 100)
    expect(s.min).toBeLessThanOrEqual(0)
    expect(s.max).toBeGreaterThanOrEqual(100)
    expect(s.ticks[s.ticks.length - 1]).toBeGreaterThanOrEqual(100)
  })
})

describe('linearScale', () => {
  it('maps domain to range', () => {
    expect(linearScale(0, 0, 10, 0, 100)).toBe(0)
    expect(linearScale(10, 0, 10, 0, 100)).toBe(100)
    expect(linearScale(5, 0, 10, 0, 100)).toBe(50)
  })

  it('returns midpoint when domain collapsed', () => {
    expect(linearScale(3, 7, 7, 0, 100)).toBe(50)
  })
})

describe('segmentLinePoints', () => {
  it('splits on null', () => {
    const segs = segmentLinePoints([1, 2, null, 4, 5], (i, v) => [i, v])
    expect(segs.length).toBe(2)
    expect(segs[0]).toEqual([[0, 1], [1, 2]])
    expect(segs[1]).toEqual([[3, 4], [4, 5]])
  })

  it('splits on NaN', () => {
    const segs = segmentLinePoints([1, Number.NaN, 3], (i, v) => [i, v])
    expect(segs.length).toBe(2)
    expect(segs[0]).toEqual([[0, 1]])
    expect(segs[1]).toEqual([[2, 3]])
  })
})

describe('lineSegmentsToPaths', () => {
  it('returns empty for short segments', () => {
    const paths = lineSegmentsToPaths([[[0, 0]]], false)
    expect(paths[0]).toBe('')
  })

  it('builds straight paths', () => {
    const paths = lineSegmentsToPaths([[[0, 0], [1, 1]]], false)
    expect(paths[0]).toBe(straightPath([[0, 0], [1, 1]]))
  })
})

describe('closeAreaUnderLine', () => {
  it('closes to baseline', () => {
    const d = straightPath([[0, 10], [10, 5]])
    const closed = closeAreaUnderLine(d, [[0, 10], [10, 5]], 40)
    expect(closed).toContain('L 10 40')
    expect(closed).toContain('L 0 40')
    expect(closed.endsWith('Z')).toBe(true)
  })

  it('returns empty for degenerate input', () => {
    expect(closeAreaUnderLine('', [[0, 0]], 40)).toBe('')
  })
})

describe('decimateCategoryData', () => {
  it('returns original when within cap', () => {
    const labels = ['a', 'b', 'c']
    const series = [{ name: 'S', data: [1, 2, 3] }]
    const d = decimateCategoryData(labels, series, 10)
    expect(d.labels).toEqual(labels)
    expect(d.series[0].data).toEqual([1, 2, 3])
  })

  it('subsamples along shared indices', () => {
    const labels = ['a', 'b', 'c', 'd', 'e', 'f']
    const series = [{ name: 'S', data: [1, 2, 3, 4, 5, 6] }]
    const d = decimateCategoryData(labels, series, 3)
    expect(d.labels.length).toBe(3)
    expect(d.series[0].data.length).toBe(3)
  })
})

describe('largestTriangleThreeBuckets', () => {
  it('returns original when under threshold', () => {
    const pts = [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 0 }]
    expect(largestTriangleThreeBuckets(pts, 10)).toEqual(pts)
  })

  it('reduces length', () => {
    const pts = Array.from({ length: 50 }, (_, i) => ({ x: i, y: Math.sin(i / 5) }))
    const s = largestTriangleThreeBuckets(pts, 12)
    expect(s.length).toBe(12)
    expect(s[0]).toEqual(pts[0])
    expect(s[s.length - 1]).toEqual(pts[pts.length - 1])
  })
})

describe('aggregateCandles', () => {
  const bars: CandleBar[] = [
    { t: 1, o: 1, h: 2, l: 0.5, c: 1.5 },
    { t: 2, o: 1.5, h: 3, l: 1, c: 2 },
    { t: 3, o: 2, h: 2.5, l: 1.5, c: 2.2 },
    { t: 4, o: 2.2, h: 3, l: 2, c: 2.8 },
  ]

  it('returns copy when within cap', () => {
    const a = aggregateCandles(bars, 10)
    expect(a.length).toBe(bars.length)
    expect(a[0]).toEqual(bars[0])
  })

  it('merges OHLC', () => {
    const a = aggregateCandles(bars, 2)
    expect(a.length).toBe(2)
    expect(a[0].o).toBe(1)
    expect(a[0].h).toBe(3)
    expect(a[1].c).toBe(2.8)
  })
})

describe('aggregateCandlesDetailed', () => {
  it('includes index ranges', () => {
    const bars: CandleBar[] = [
      { t: 1, o: 1, h: 1, l: 1, c: 1 },
      { t: 2, o: 2, h: 2, l: 2, c: 2 },
    ]
    const d = aggregateCandlesDetailed(bars, 10)
    expect(d.length).toBe(2)
    expect(d[0]).toMatchObject({ i0: 0, i1: 0 })
    expect(d[1]).toMatchObject({ i0: 1, i1: 1 })
  })
})

describe('candle time / index mapping', () => {
  const bars: CandleBar[] = [
    { t: 1000, o: 1, h: 1, l: 1, c: 1 },
    { t: 2000, o: 1, h: 1, l: 1, c: 1 },
    { t: 4000, o: 1, h: 1, l: 1, c: 1 },
  ]

  it('interpolates time at fractional index', () => {
    expect(candleTimeAtIndex(bars, 0)).toBe(1000)
    expect(candleTimeAtIndex(bars, 2)).toBe(4000)
    expect(candleTimeAtIndex(bars, 1)).toBe(2000)
    expect(candleTimeAtIndex(bars, 0.5)).toBe(1500)
  })

  it('round-trips index near knots', () => {
    expect(candleIndexAtTime(bars, 1000)).toBe(0)
    expect(candleIndexAtTime(bars, 4000)).toBe(2)
    const i = candleIndexAtTime(bars, 2500)
    expect(i).toBeGreaterThan(0)
    expect(i).toBeLessThan(2)
  })
})
