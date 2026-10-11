import { describe, expect, it } from 'vitest'
import {
  defaultTimeAxisLabel,
  dedupeAdjacentAxisLabelIndices,
  resolveTimeAxisTimeZone,
  selectEvenAxisLabelIndices,
  thinOverlappingTicks,
} from './xAxis'

describe('xAxis helpers', () => {
  it('selects readable ticks for a dense hourly time series', () => {
    const indices = selectEvenAxisLabelIndices({
      i0: 0,
      i1: 71,
      plotWidth: 640,
      minPxPerLabel: 112,
    })

    expect(indices.length).toBeLessThan(72)
    expect(indices.length).toBeGreaterThanOrEqual(2)
    expect(indices[0]).toBe(0)
    expect(indices[indices.length - 1]).toBe(71)
  })

  it('dedupes adjacent formatted labels while preserving endpoints', () => {
    const indices = dedupeAdjacentAxisLabelIndices([0, 1, 2, 3], i => (i < 3 ? 'May 15' : 'May 16'))

    expect(indices).toEqual([0, 3])
  })

  it('supports compact category fallback spacing when no label formatter is provided', () => {
    const indices = selectEvenAxisLabelIndices({
      i0: 0,
      i1: 5,
      plotWidth: 300,
      minPxPerLabel: 50,
    })

    expect(indices).toEqual([0, 1, 2, 3, 4, 5])
  })

  it('formats valid and invalid timestamps in pinned en-US / UTC', () => {
    const t = Date.UTC(2026, 4, 15, 2, 0)
    const label = defaultTimeAxisLabel(t)
    expect(label).toMatch(/May 15/)
    expect(label).not.toMatch(/May 14/)
    expect(defaultTimeAxisLabel(t, undefined)).toBe(label)
    expect(defaultTimeAxisLabel(t, '')).toBe(label)
    expect(defaultTimeAxisLabel(t, 'America/Chicago')).toMatch(/May 14/)
    expect(defaultTimeAxisLabel(Number.NaN)).toBe('NaN')
  })

  it('treats an omitted or undefined timeZone as UTC, never the host zone', () => {
    expect(resolveTimeAxisTimeZone()).toBe('UTC')
    expect(resolveTimeAxisTimeZone(undefined)).toBe('UTC')
    expect(resolveTimeAxisTimeZone('America/Chicago')).toBe('America/Chicago')
  })

  describe('thinOverlappingTicks', () => {
    const labelAt = (i: number) => ['Jun 26', 'Jul 26', 'Aug 26', 'Sep 26', 'Oct 26'][i] ?? `T${i}`

    it('keeps the last label and drops its neighbour when they would overlap', () => {
      /* 375px: Sep 26 sits 20px from Oct 26, which is closer than either label is wide. */
      const xs = [0, 60, 120, 200, 220]
      const kept = thinOverlappingTicks([0, 1, 2, 3, 4], { xAt: i => xs[i]!, labelAt })
      expect(kept).toEqual([0, 1, 2, 4])
    })

    it('leaves a clear run untouched', () => {
      const kept = thinOverlappingTicks([0, 1, 2, 3, 4], { xAt: i => i * 80, labelAt })
      expect(kept).toEqual([0, 1, 2, 3, 4])
    })

    it('never returns two labels whose boxes touch', () => {
      const xs = Array.from({ length: 30 }, (_, i) => i * 11)
      const kept = thinOverlappingTicks(
        xs.map((_, i) => i),
        { xAt: i => xs[i]!, labelAt: () => 'Sep 26' },
      )
      expect(kept.at(-1)).toBe(29)
      expect(kept[0]).toBe(0)
      for (let k = 1; k < kept.length; k++) {
        expect(xs[kept[k]!]! - xs[kept[k - 1]!]!).toBeGreaterThanOrEqual(6 * 6.2 + 4)
      }
    })

    it('passes through empty and single-tick input', () => {
      expect(thinOverlappingTicks([], { xAt: i => i, labelAt })).toEqual([])
      expect(thinOverlappingTicks([2], { xAt: i => i, labelAt })).toEqual([2])
    })
  })
})
