import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { sampleRamp as deprecatedSampleRamp } from '../src/core/color.js'
import {
  denormalizePosition,
  normalizeValue,
  normalizeWireStops,
  rampLut,
  roundHalfToEven,
  sampleRamp01,
  sampleRampValue,
  type RampStopWire,
} from '../src/color/index.js'

import type { GridScale, RampStop } from '../src/core/models.js'

/**
 * Byte-exact parity against the server engine.
 *
 * Every expected value in `ramp-parity-v1.json` was produced by running
 * narduk-data's `shared/colorramp.py` — see the generator checked in beside the
 * fixture. Nothing in this file recomputes an expectation; a failure here means
 * the TypeScript engine has drifted from the engine that colored every
 * published tile, which is the entire reason the fixture exists.
 */

interface ParityFixture {
  schema: string
  rampSpecVersion: number
  rounding: string
  ramps: Record<string, RampStop[]>
  cases: {
    name: string
    ramp: string
    valueRange: [number, number]
    scale: GridScale
    samples: { value: number; normalized: number | null; rgba: number[] }[]
  }[]
  positionCases: {
    name: string
    ramp: string
    samples: { position: number; rgba: number[] }[]
  }[]
  wireStopCases: {
    ramp: string
    valueRange: [number, number]
    scale: GridScale
    wire: RampStopWire[]
    expectedPositions: number[]
  }[]
  luts: Record<string, string>
  lutDigests: Record<string, string>
}

/**
 * `NaN` and `Infinity` are not JSON, so the generator writes them as strings
 * and this puts them back. Without it the non-finite sample cases — the ones
 * that pin "missing data renders transparent" — could not be expressed at all.
 */
function revive(node: unknown): unknown {
  if (node === 'NaN') return Number.NaN
  if (node === 'Infinity') return Number.POSITIVE_INFINITY
  if (node === '-Infinity') return Number.NEGATIVE_INFINITY
  if (Array.isArray(node)) return node.map(revive)
  if (node !== null && typeof node === 'object') {
    return Object.fromEntries(
      Object.entries(node as Record<string, unknown>).map(([key, value]) => [key, revive(value)]),
    )
  }
  return node
}

const fixturePath = fileURLToPath(new URL('./fixtures/ramp-parity-v1.json', import.meta.url))
const fixture = revive(JSON.parse(readFileSync(fixturePath, 'utf8'))) as ParityFixture

function stopsFor(name: string): RampStop[] {
  const stops = fixture.ramps[name]
  if (!stops) throw new Error(`fixture has no ramp named ${name}`)
  return stops
}

describe('ramp parity fixture', () => {
  it('is the pinned schema and spec version', () => {
    expect(fixture.schema).toBe('narduk-ramp-parity-v1')
    expect(fixture.rampSpecVersion).toBe(1)
    expect(fixture.rounding).toBe('half-to-even')
  })

  it('carries the full canonical ramp registry in normalized-position form', () => {
    expect(Object.keys(fixture.ramps)).toContain('kd490')
    expect(Object.keys(fixture.ramps)).toContain('sst')
    expect(Object.keys(fixture.ramps)).toContain('front')
    for (const [name, stops] of Object.entries(fixture.ramps)) {
      for (const stop of stops) {
        expect(stop.position, `${name} stop position`).toBeGreaterThanOrEqual(0)
        expect(stop.position, `${name} stop position`).toBeLessThanOrEqual(1)
        expect(stop.rgba, `${name} stop rgba`).toHaveLength(4)
      }
    }
  })
})

describe('sampleRamp01 matches the server byte-for-byte', () => {
  for (const positionCase of fixture.positionCases) {
    it(positionCase.name, () => {
      const stops = stopsFor(positionCase.ramp)
      for (const sample of positionCase.samples) {
        expect(sampleRamp01(stops, sample.position), `position ${sample.position}`).toEqual(
          sample.rgba,
        )
      }
    })
  }
})

describe('sampleRampValue matches the server byte-for-byte', () => {
  for (const valueCase of fixture.cases) {
    it(valueCase.name, () => {
      const stops = stopsFor(valueCase.ramp)
      for (const sample of valueCase.samples) {
        expect(
          sampleRampValue(stops, sample.value, valueCase.valueRange, valueCase.scale),
          `value ${sample.value}`,
        ).toEqual(sample.rgba)
      }
    })
  }
})

describe('normalizeValue matches the server', () => {
  for (const valueCase of fixture.cases) {
    it(valueCase.name, () => {
      for (const sample of valueCase.samples) {
        const actual = normalizeValue(sample.value, valueCase.valueRange, valueCase.scale)
        if (sample.normalized === null) {
          expect(actual, `value ${sample.value}`).toBeNull()
          continue
        }
        expect(actual, `value ${sample.value}`).not.toBeNull()
        // Positions are compared to within a double's noise rather than
        // exactly: log10 may differ by an ULP between CPython's libm and V8's.
        // The rendered bytes above are the contract and are asserted exactly.
        expect(actual as number, `value ${sample.value}`).toBeCloseTo(sample.normalized, 12)
      }
    })
  }

  it('rejects a degenerate value range the way the server does', () => {
    expect(() => normalizeValue(1, [5, 5], 'linear')).toThrow(RangeError)
    expect(() => normalizeValue(1, [10, 1], 'linear')).toThrow(RangeError)
  })

  it('does not throw on a NaN range bound, matching the server', () => {
    // `!(lo < hi)` — the guard this replaced — is `true` for `NaN` bounds (JS
    // and Python both make every comparison against `NaN` false, so `NaN < hi`
    // is `false` and its negation is `true`), so the old guard threw here while
    // the server's `if lo >= hi: raise` does not (`NaN >= hi` is also `false`).
    // Expected value captured by running narduk-data's own
    // `shared/colorramp.py`: `normalize_value(1, (nan, 10.0), 'linear')` is
    // `0.0`, not `NaN` — Python's `min(1.0, max(0.0, raw))` keeps the first
    // argument on a `NaN` comparison, which `normalizeValue` reproduces below.
    expect(() => normalizeValue(1, [Number.NaN, 10], 'linear')).not.toThrow()
    expect(normalizeValue(1, [Number.NaN, 10], 'linear')).toBe(0)
  })

  it('answers null for a non-finite value before it inspects the range', () => {
    expect(normalizeValue(Number.NaN, [5, 5], 'linear')).toBeNull()
  })

  it('answers null for a non-positive range floor on a log scale', () => {
    expect(normalizeValue(1, [0, 10], 'log')).toBeNull()
  })
})

describe('rampLut matches the server-baked LUTs', () => {
  for (const [key, encoded] of Object.entries(fixture.luts)) {
    it(key, () => {
      const [name, rawCount] = key.split('@')
      const count = Number(rawCount)
      const expected = new Uint8Array(Buffer.from(encoded, 'base64'))
      const actual = rampLut(stopsFor(name!), count)

      expect(actual.byteLength).toBe(count * 4)
      expect(actual).toEqual(expected)
      expect(createHash('sha256').update(actual).digest('hex')).toBe(fixture.lutDigests[key])
    })
  }

  it('rejects a non-positive entry count', () => {
    expect(() => rampLut(stopsFor('sst'), 0)).toThrow(RangeError)
    expect(() => rampLut(stopsFor('sst'), 2.5)).toThrow(RangeError)
  })

  it('samples position 0 for a single-entry LUT', () => {
    expect(Array.from(rampLut(stopsFor('kd490'), 1))).toEqual([8, 34, 108, 240])
  })
})

describe('denormalizePosition matches the server round trip', () => {
  // `denormalizePosition`'s own docstring claims coverage from this fixture
  // ("that round trip is pinned by the wireStopCases fixture"), but until now
  // nothing actually called it: every wireStopCases consumer above runs
  // `normalizeWireStops` (the inverse direction) and never calls
  // `denormalizePosition` itself. This asserts the claimed direction directly:
  // each wire case's `expectedPositions` (the server's own ramp stop
  // positions) denormalized back through `denormalizePosition` must reproduce
  // the `value` the server wrote onto the wire for that same stop.
  for (const wireCase of fixture.wireStopCases) {
    it(`${wireCase.ramp} (${wireCase.scale})`, () => {
      wireCase.expectedPositions.forEach((position, index) => {
        const expectedValue = wireCase.wire[index]!.value
        const actual = denormalizePosition(position, wireCase.valueRange, wireCase.scale)
        // Same tolerance as the other cross-language float comparisons in this
        // file: log10 may differ by a ULP between CPython's libm and V8's.
        expect(actual, `stop ${index}`).toBeCloseTo(expectedValue, 9)
      })
    })
  }
})

describe('normalizeWireStops inverts the catalog wire encoding', () => {
  for (const wireCase of fixture.wireStopCases) {
    it(`${wireCase.ramp} (${wireCase.scale})`, () => {
      const stops = normalizeWireStops(wireCase.wire, wireCase.valueRange, wireCase.scale)
      const registry = stopsFor(wireCase.ramp)

      expect(stops).toHaveLength(registry.length)
      stops.forEach((stop, index) => {
        expect(stop.position, `stop ${index}`).toBeCloseTo(wireCase.expectedPositions[index]!, 12)
        expect(stop.rgba, `stop ${index}`).toEqual(registry[index]!.rgba)
      })
    })
  }

  it('preserves alpha, unlike the RGB-only Swift consumer', () => {
    const wire: RampStopWire[] = [
      { value: 0, r: 0, g: 0, b: 0, a: 0 },
      { value: 1, r: 228, g: 26, b: 28, a: 220 },
    ]
    expect(normalizeWireStops(wire, [0, 1], 'linear')).toEqual([
      { position: 0, rgba: [0, 0, 0, 0] },
      { position: 1, rgba: [228, 26, 28, 220] },
    ])
  })

  it('treats a missing alpha as opaque', () => {
    expect(normalizeWireStops([{ value: 0, r: 1, g: 2, b: 3 }], [0, 1], 'linear')).toEqual([
      { position: 0, rgba: [1, 2, 3, 255] },
    ])
  })

  it('maps an out-of-domain stop to position 0, matching GeoGridKit', () => {
    const wire: RampStopWire[] = [{ value: 0, r: 9, g: 9, b: 9, a: 9 }]
    expect(normalizeWireStops(wire, [0.01, 6.6], 'log')[0]!.position).toBe(0)
  })

  it('sorts a malformed producer’s unsorted stops', () => {
    const wire: RampStopWire[] = [
      { value: 1, r: 3, g: 3, b: 3 },
      { value: 0, r: 1, g: 1, b: 1 },
      { value: 0.5, r: 2, g: 2, b: 2 },
    ]
    expect(normalizeWireStops(wire, [0, 1], 'linear').map((stop) => stop.position)).toEqual([
      0, 0.5, 1,
    ])
  })

  describe('domain detection', () => {
    // The failure this guards is silent: a log layer ranged inside 0..1 has
    // every wire stop value below 1.0 while every one of them is a data value.
    // A max<=1 heuristic reads those as positions and squashes the whole ramp.
    const chlorophyll = fixture.wireStopCases.find(
      (entry) => entry.ramp === 'chlorophyll',
    )!

    it('does not mistake a sub-unit log layer’s data values for positions', () => {
      expect(chlorophyll.wire.every((stop) => stop.value <= 1)).toBe(true)

      const auto = normalizeWireStops(chlorophyll.wire, chlorophyll.valueRange, 'log', {
        domain: 'auto',
      })
      const explicit = normalizeWireStops(chlorophyll.wire, chlorophyll.valueRange, 'log')
      expect(auto).toEqual(explicit)
      expect(auto.map((stop) => stop.position)).not.toEqual(
        chlorophyll.wire.map((stop) => stop.value),
      )
    })

    it('reads sub-unit stops as positions when the range cannot contain them', () => {
      const wire: RampStopWire[] = [
        { value: 0, r: 0, g: 0, b: 0 },
        { value: 0.5, r: 128, g: 128, b: 128 },
        { value: 1, r: 255, g: 255, b: 255 },
      ]
      const auto = normalizeWireStops(wire, [0.01, 6.6], 'log', { domain: 'auto' })
      expect(auto.map((stop) => stop.position)).toEqual([0, 0.5, 1])
    })

    it('passes stops through untouched on the explicit normalized domain', () => {
      const wire: RampStopWire[] = [
        { value: 0, r: 0, g: 0, b: 0 },
        { value: 0.25, r: 1, g: 1, b: 1 },
      ]
      expect(
        normalizeWireStops(wire, [0.01, 6.6], 'log', { domain: 'normalized' }).map(
          (stop) => stop.position,
        ),
      ).toEqual([0, 0.25])
    })
  })
})

describe('roundHalfToEven', () => {
  it('rounds an exact tie toward the even neighbour', () => {
    expect(roundHalfToEven(0.5)).toBe(0)
    expect(roundHalfToEven(1.5)).toBe(2)
    expect(roundHalfToEven(2.5)).toBe(2)
    expect(roundHalfToEven(3.5)).toBe(4)
    expect(roundHalfToEven(254.5)).toBe(254)
    expect(roundHalfToEven(253.5)).toBe(254)
  })

  it('disagrees with Math.round exactly on the ties', () => {
    expect(Math.round(2.5)).toBe(3)
    expect(roundHalfToEven(2.5)).toBe(2)
  })

  it('rounds a non-tie normally', () => {
    expect(roundHalfToEven(2.4999999999)).toBe(2)
    expect(roundHalfToEven(2.5000000001)).toBe(3)
    expect(roundHalfToEven(0)).toBe(0)
    expect(roundHalfToEven(255)).toBe(255)
  })

  it('throws on a non-finite input, matching Python round()', () => {
    // Python's round() -- the reference this ports -- raises ValueError on NaN
    // and OverflowError on +/-Infinity; Math.floor/arithmetic on a non-finite
    // double would otherwise quietly answer NaN or Infinity instead of a
    // rounding result.
    expect(() => roundHalfToEven(Number.NaN)).toThrow(RangeError)
    expect(() => roundHalfToEven(Number.POSITIVE_INFINITY)).toThrow(RangeError)
    expect(() => roundHalfToEven(Number.NEGATIVE_INFINITY)).toThrow(RangeError)
  })
})

describe('documented behavior changes from the deprecated core sampler', () => {
  it('drops a non-positive sample on a log layer instead of painting it', () => {
    const stops = stopsFor('kd490')
    // Canonical engine: outside the sampling domain, so no color at all.
    expect(sampleRampValue(stops, 0, [0.01, 6.6], 'log')).toEqual([0, 0, 0, 0])
    expect(sampleRampValue(stops, -1, [0.01, 6.6], 'log')).toEqual([0, 0, 0, 0])

    // Deprecated engine: clamps to the first stop, painting a zero retrieval
    // with the "clearest water" color. That is the change this release makes.
    expect(deprecatedSampleRamp([{ value: 0.01, r: 8, g: 34, b: 108 }], 0)).toEqual([8, 34, 108])
  })

  it('keeps a transparent ramp stop distinguishable from missing data', () => {
    const front = stopsFor('front')
    // FRONT's first stop is transparent by design; both of these are [0,0,0,0],
    // so a consumer that needs to tell them apart branches on normalizeValue.
    expect(sampleRampValue(front, 0, [0, 1], 'linear')).toEqual([0, 0, 0, 0])
    expect(sampleRampValue(front, Number.NaN, [0, 1], 'linear')).toEqual([0, 0, 0, 0])
    expect(normalizeValue(0, [0, 1], 'linear')).toBe(0)
    expect(normalizeValue(Number.NaN, [0, 1], 'linear')).toBeNull()
  })
})
