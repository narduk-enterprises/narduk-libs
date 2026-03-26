import { describe, expect, it } from 'vitest'
import {
  niceScale,
  linearScale,
  segmentLinePoints,
  lineSegmentsToPaths,
  closeAreaUnderLine,
  straightPath,
} from './math'

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
