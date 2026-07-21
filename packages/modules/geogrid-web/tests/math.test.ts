import { describe, expect, it } from 'vitest'

import { displayValueFromEncoded, normalizeValue } from '../src/core/math.js'
import { sampleRamp } from '../src/core/color.js'

describe('normalizeValue (GeoGridKit-compatible)', () => {
  it('maps linear endpoints', () => {
    const range = { lowerBound: 0, upperBound: 100 }
    expect(normalizeValue(0, range, 'linear')).toBe(0)
    expect(normalizeValue(100, range, 'linear')).toBe(1)
    expect(normalizeValue(50, range, 'linear')).toBeCloseTo(0.5)
  })

  it('maps log scale', () => {
    const range = { lowerBound: 0.01, upperBound: 1 }
    expect(normalizeValue(0.01, range, 'log')).toBeCloseTo(0)
    expect(normalizeValue(1, range, 'log')).toBeCloseTo(1)
    expect(normalizeValue(0.1, range, 'log')).toBeCloseTo(0.5)
  })

  it('rejects non-positive log inputs', () => {
    expect(normalizeValue(0, { lowerBound: 0.01, upperBound: 1 }, 'log')).toBeNull()
    expect(normalizeValue(-1, { lowerBound: 0.01, upperBound: 1 }, 'log')).toBeNull()
  })

  it('rejects empty ranges', () => {
    expect(normalizeValue(1, { lowerBound: 5, upperBound: 5 }, 'linear')).toBeNull()
  })
})

describe('displayValueFromEncoded + ramp', () => {
  it('round-trips linear encode endpoints through color ramp', () => {
    const range = { lowerBound: 0, upperBound: 10 }
    const ramp = [
      { value: 0, r: 0, g: 0, b: 0 },
      { value: 10, r: 255, g: 0, b: 0 },
    ]
    const low = displayValueFromEncoded(0, range, 'linear')
    const high = displayValueFromEncoded(65535, range, 'linear')
    expect(sampleRamp(ramp, low)).toEqual([0, 0, 0])
    expect(sampleRamp(ramp, high)).toEqual([255, 0, 0])
  })
})
