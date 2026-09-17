import { describe, expect, it } from 'vitest'
import {
  defaultTimeAxisLabel,
  dedupeAdjacentAxisLabelIndices,
  resolveTimeAxisTimeZone,
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
})
