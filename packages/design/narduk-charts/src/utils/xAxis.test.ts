import { describe, expect, it } from 'vitest'
import {
  defaultTimeAxisLabel,
  dedupeAdjacentAxisLabelIndices,
  selectEvenAxisLabelIndices,
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
    const indices = dedupeAdjacentAxisLabelIndices(
      [0, 1, 2, 3],
      i => (i < 3 ? 'May 15' : 'May 16'),
    )

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

  it('formats valid and invalid timestamps', () => {
    expect(defaultTimeAxisLabel(Date.UTC(2026, 4, 15, 2))).toContain('May')
    expect(defaultTimeAxisLabel(Number.NaN)).toBe('NaN')
  })
})
