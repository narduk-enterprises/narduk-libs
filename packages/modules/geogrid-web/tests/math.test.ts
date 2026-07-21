import { describe, expect, it } from 'vitest'

import { sampleRamp } from '../src/core/color.js'
import {
  blendEncoded,
  blendedDisplayValue,
  dataUvTransform,
  displayValueFromEncoded,
  frameContentKey,
  normalizeValue,
} from '../src/core/math.js'

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

describe('encoded-space temporal blend (WebGL/Canvas parity)', () => {
  it('mid-blend on log range is not the average of display values', () => {
    const range = { lowerBound: 0.01, upperBound: 1 }
    const low = 0
    const high = 65535
    const midEncoded = blendEncoded(low, high, 0.5)
    expect(midEncoded).toBe(32767.5)

    const displayMid = displayValueFromEncoded(midEncoded, range, 'log')
    const wrongDisplayAvg =
      (displayValueFromEncoded(low, range, 'log') + displayValueFromEncoded(high, range, 'log')) / 2

    // Encoded mid on log scale is geometric mean of endpoints (~0.1), not arithmetic mean (~0.505).
    expect(displayMid).toBeCloseTo(0.1, 5)
    expect(wrongDisplayAvg).toBeCloseTo(0.505, 2)
    expect(Math.abs(displayMid - wrongDisplayAvg)).toBeGreaterThan(0.3)

    const viaHelper = blendedDisplayValue(low, high, 0.5, range, 'log')
    expect(viaHelper).toBeCloseTo(displayMid, 10)

    const ramp = [
      { value: 0.01, r: 0, g: 0, b: 255 },
      { value: 0.1, r: 0, g: 255, b: 0 },
      { value: 1, r: 255, g: 0, b: 0 },
    ]
    // Ship the same path Canvas uses: color after encoded blend + displayValue.
    expect(sampleRamp(ramp, viaHelper)).toEqual([0, 255, 0])
  })

  it('linear mid-blend equals display-space average', () => {
    const range = { lowerBound: 0, upperBound: 10 }
    const viaEncoded = blendedDisplayValue(0, 65535, 0.5, range, 'linear')
    expect(viaEncoded).toBeCloseTo(5, 5)
  })
})

describe('dataUvTransform', () => {
  it('maps viewport covering data bbox to identity UV', () => {
    const uv = dataUvTransform(
      {
        center: { latitude: 25, longitude: -95 },
        span: { latitudeDelta: 10, longitudeDelta: 10 },
      },
      [-100, 20, -90, 30],
    )
    expect(uv.uvOffsetX).toBeCloseTo(0)
    expect(uv.uvOffsetY).toBeCloseTo(0)
    expect(uv.uvScaleX).toBeCloseTo(1)
    expect(uv.uvScaleY).toBeCloseTo(1)
  })

  it('zooms UV when viewport is smaller than data bbox', () => {
    const uv = dataUvTransform(
      {
        center: { latitude: 25, longitude: -95 },
        span: { latitudeDelta: 5, longitudeDelta: 5 },
      },
      [-100, 20, -90, 30],
    )
    expect(uv.uvScaleX).toBeCloseTo(0.5)
    expect(uv.uvScaleY).toBeCloseTo(0.5)
  })
})

describe('frameContentKey', () => {
  it('changes when sample bytes change for the same date', () => {
    const a = new Uint16Array([1, 2, 3, 4])
    const b = new Uint16Array([1, 2, 3, 5])
    const mask = new Uint8Array([1, 1, 1, 1])
    expect(frameContentKey('2020-01-01', 2, 2, a, mask)).not.toBe(
      frameContentKey('2020-01-01', 2, 2, b, mask),
    )
  })

  it('is stable for identical payloads', () => {
    const values = new Uint16Array([10, 20, 30])
    const mask = new Uint8Array([1, 0, 1])
    expect(frameContentKey('d', 3, 1, values, mask)).toBe(frameContentKey('d', 3, 1, values, mask))
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
