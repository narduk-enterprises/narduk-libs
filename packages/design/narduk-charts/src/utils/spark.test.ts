import { describe, expect, it } from 'vitest'

import {
  SPARK_WINDOW_MS,
  SPARK_WINDOWS,
  sparkAxis,
  sparkPath,
  sparkWindowMs,
  trailingSparkWindow,
} from './spark'

describe('sparkWindowMs', () => {
  it('exposes the three trailing windows buoys uses', () => {
    expect([...SPARK_WINDOWS]).toEqual(['24h', '7d', '30d'])
    expect(sparkWindowMs('24h')).toBe(24 * 60 * 60 * 1000)
    expect(sparkWindowMs('7d')).toBe(7 * SPARK_WINDOW_MS['24h'])
    expect(sparkWindowMs('30d')).toBe(30 * SPARK_WINDOW_MS['24h'])
  })
})

describe('sparkAxis', () => {
  it('returns a unit domain when nothing is finite', () => {
    expect(sparkAxis([])).toEqual({ max: 1, min: 0, mode: 'linear' })
    expect(sparkAxis([null, Number.NaN])).toEqual({ max: 1, min: 0, mode: 'linear' })
  })

  it('pins wave-height style series to zero', () => {
    const axis = sparkAxis([0.5, 1.2, 2.5, 1.8])
    expect(axis.mode).toBe('fromZero')
    expect(axis.min).toBe(0)
    expect(axis.max).toBeGreaterThan(2.5)
  })

  it('keeps water-temperature style series linear', () => {
    const axis = sparkAxis([18.1, 18.4, 19.0, 18.6])
    expect(axis.mode).toBe('linear')
    expect(axis.min).toBeLessThan(18.1)
    expect(axis.max).toBeGreaterThan(19.0)
  })

  it('pads a flat series so a path still has a domain', () => {
    const axis = sparkAxis([12, 12, 12])
    expect(axis.mode).toBe('linear')
    expect(axis.min).toBeLessThan(12)
    expect(axis.max).toBeGreaterThan(12)
  })

  it('honours an explicit fromZero mode', () => {
    const axis = sparkAxis([18, 22], { mode: 'fromZero' })
    expect(axis).toMatchObject({ min: 0, mode: 'fromZero' })
    expect(axis.max).toBeGreaterThan(22)
  })
})

describe('sparkPath', () => {
  it('returns an empty string when there is no drawable segment', () => {
    expect(sparkPath([], 80, 24)).toBe('')
    expect(sparkPath([3], 80, 24)).toBe('')
    expect(sparkPath([1, 2], 0, 24)).toBe('')
  })

  it('emits a two-point line and breaks on null', () => {
    const d = sparkPath([1, 2, null, 4, 5], 100, 20, {
      axis: { max: 5, min: 1, mode: 'linear' },
      inset: 0,
    })
    expect(d.startsWith('M')).toBe(true)
    expect(d.includes(' M')).toBe(true)
    expect(d.split('M').length - 1).toBe(2)
  })

  it('maps the first sample to the left and the last to the right', () => {
    const d = sparkPath([0, 10], 100, 20, {
      axis: { max: 10, min: 0, mode: 'linear' },
      inset: 0,
    })
    expect(d).toBe('M0,20 L100,0')
  })
})

describe('trailingSparkWindow', () => {
  const hour = 60 * 60 * 1000
  const end = Date.UTC(2026, 8, 24, 12)
  const series = [
    { t: end - 40 * hour, v: 1 },
    { t: end - 10 * hour, v: 2 },
    { t: end - 2 * hour, v: 3 },
    { t: end, v: 4 },
    { t: end + hour, v: 5 },
  ]

  it('keeps the last 24h relative to an explicit now', () => {
    expect(trailingSparkWindow(series, '24h', end).map(point => point.v)).toEqual([2, 3, 4])
  })

  it('uses the latest sample as now when now is omitted', () => {
    const stale = series.slice(0, 3)
    expect(trailingSparkWindow(stale, '24h').map(point => point.v)).toEqual([2, 3])
  })

  it('returns an empty list when nothing falls in the window', () => {
    expect(trailingSparkWindow([{ t: end - 40 * hour }], '24h', end)).toEqual([])
  })
})
