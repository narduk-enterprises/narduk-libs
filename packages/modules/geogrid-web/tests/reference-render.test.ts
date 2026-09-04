import { describe, expect, it } from 'vitest'

import { rampLut } from '../src/color/ramp.js'
import { frameContentKey } from '../src/core/math.js'
import {
  gridFrameFromScalarDataset,
  gridFrameFromTemporal,
  isGridFrame,
  toGridFrame,
  defaultBBoxAnchor,
} from '../src/core/frame.js'
import {
  referenceRenderScalarTile,
  referenceRenderScalarViewport,
  referenceScalarPixel,
  referenceLut,
  sampleLutLinear,
  type ReferenceScalarLayer,
  type ReferenceScalarStyle,
} from '../src/core/reference-render.js'
import { resolveRampStops } from '../src/render/style.js'
import type { GridScalarDataset } from '../src/core/decode/grid.js'
import type { RampStop } from '../src/core/models.js'

const BLACK_TO_WHITE: RampStop[] = [
  { position: 0, rgba: [0, 0, 0, 255] },
  { position: 1, rgba: [255, 255, 255, 255] },
]

const HALF_ALPHA: RampStop[] = [
  { position: 0, rgba: [10, 20, 30, 128] },
  { position: 1, rgba: [10, 20, 30, 128] },
]

function layer(
  values: number[],
  mask: number[],
  width: number,
  height: number,
): ReferenceScalarLayer {
  return { values, mask, width, height, valueKind: 'float32' }
}

describe('sampleLutLinear', () => {
  const lut = rampLut(BLACK_TO_WHITE, 256)

  it('clamps to the first entry at and below position 0', () => {
    expect(sampleLutLinear(lut, 0)).toEqual([0, 0, 0, 255])
    expect(sampleLutLinear(lut, -1)).toEqual([0, 0, 0, 255])
  })

  it('clamps to the last entry at and above position 1', () => {
    expect(sampleLutLinear(lut, 1)).toEqual([255, 255, 255, 255])
    expect(sampleLutLinear(lut, 2)).toEqual([255, 255, 255, 255])
  })

  it('interpolates between baked entries the way a LINEAR sampler does', () => {
    const [r] = sampleLutLinear(lut, 0.5)
    expect(r).toBeGreaterThan(126)
    expect(r).toBeLessThan(129)
  })

  it('reads the half-texel offset a normalized coordinate carries', () => {
    // Position 1/256 sits half a texel past entry 0's center, so the result is
    // the midpoint of entries 0 and 1 rather than entry 1 itself.
    const exact = lut[4]!
    const [r] = sampleLutLinear(lut, 1 / 256)
    expect(r).toBeCloseTo(exact / 2, 6)
  })

  it('carries alpha through', () => {
    expect(sampleLutLinear(rampLut(HALF_ALPHA, 256), 0.42)[3]).toBe(128)
  })

  it('answers transparent for an empty ramp rather than throwing', () => {
    expect(sampleLutLinear(new Uint8Array(0), 0.5)).toEqual([0, 0, 0, 0])
  })
})

describe('referenceScalarPixel', () => {
  const style: ReferenceScalarStyle = {
    stops: BLACK_TO_WHITE,
    valueRange: [0, 100],
    scale: 'linear',
  }
  const lut = referenceLut(style)

  it('colors a whole neighborhood through the ramp', () => {
    const source = layer([0, 100, 0, 100], [1, 1, 1, 1], 2, 2)
    const [r, , , a] = referenceScalarPixel(source, lut, style, 0.5, 0)
    expect(r).toBeGreaterThan(126)
    expect(r).toBeLessThan(129)
    expect(a).toBe(255)
  })

  it('draws nothing where the neighborhood is entirely missing', () => {
    const source = layer([1, 2, 3, 4], [0, 0, 0, 0], 2, 2)
    expect(referenceScalarPixel(source, lut, style, 0.5, 0.5)).toEqual([0, 0, 0, 0])
  })

  it('soft drops a pixel whose neighborhood is only partly present', () => {
    const source = layer([50, 50, 50, 50], [1, 1, 1, 0], 2, 2)
    expect(referenceScalarPixel(source, lut, style, 0.5, 0.5)[3]).toBe(0)
  })

  it('coastal feathers that same pixel instead of dropping it', () => {
    const source = layer([50, 50, 50, 50], [1, 1, 1, 0], 2, 2)
    const coastal: ReferenceScalarStyle = { ...style, sampling: 'coastal' }
    // Leaning hard toward the missing corner leaves a surviving weight of 0.19,
    // inside the 0…0.55 band the feather actually ramps across; at the cell
    // center the weight is 0.75 and the smoothstep has already saturated.
    const alpha = referenceScalarPixel(source, referenceLut(coastal), coastal, 0.9, 0.9)[3]
    expect(alpha).toBeGreaterThan(0)
    expect(alpha).toBeLessThan(255)
  })

  it('coastal saturates to opaque once enough weight survives', () => {
    const source = layer([50, 50, 50, 50], [1, 1, 1, 0], 2, 2)
    const coastal: ReferenceScalarStyle = { ...style, sampling: 'coastal' }
    expect(referenceScalarPixel(source, referenceLut(coastal), coastal, 0.5, 0.5)[3]).toBe(255)
  })

  it('composes per-stop alpha into the output', () => {
    const alphaStyle: ReferenceScalarStyle = { ...style, stops: HALF_ALPHA }
    const source = layer([50, 50, 50, 50], [1, 1, 1, 1], 2, 2)
    const pixel = referenceScalarPixel(source, referenceLut(alphaStyle), alphaStyle, 0.5, 0.5)
    expect(pixel[3]).toBe(128)
  })

  // normalizeValue throws on a degenerate range — correct for a pure function
  // porting the server's `raise`, fatal inside a render loop, where the
  // exception escapes through requestAnimationFrame and takes the frame down.
  for (const [name, range] of [
    ['degenerate', [5, 5]],
    ['inverted', [100, 0]],
    ['NaN lower bound', [Number.NaN, 100]],
    ['NaN upper bound', [0, Number.NaN]],
  ] as const) {
    it(`draws nothing, without throwing, for a ${name} range`, () => {
      const bad: ReferenceScalarStyle = { ...style, valueRange: range }
      const source = layer([50, 50, 50, 50], [1, 1, 1, 1], 2, 2)
      let pixel: [number, number, number, number] | undefined
      expect(() => {
        pixel = referenceScalarPixel(source, referenceLut(bad), bad, 0.5, 0.5)
      }).not.toThrow()
      // An inverted range in particular used to slip past the GPU's `x == y`
      // test and render the ramp backwards.
      expect(pixel).toEqual([0, 0, 0, 0])
    })
  }

  it('applies the flat opacity multiplier on top of that', () => {
    const dim: ReferenceScalarStyle = { ...style, opacity: 0.5 }
    const source = layer([50, 50, 50, 50], [1, 1, 1, 1], 2, 2)
    expect(referenceScalarPixel(source, referenceLut(dim), dim, 0.5, 0.5)[3]).toBeCloseTo(127.5, 6)
  })
})

describe('referenceScalarPixel — log-scale layers', () => {
  const style: ReferenceScalarStyle = {
    stops: BLACK_TO_WHITE,
    valueRange: [0.01, 1],
    scale: 'log',
  }
  const lut = referenceLut(style)

  it('puts the geometric midpoint at the ramp midpoint', () => {
    const source = layer([0.1, 0.1, 0.1, 0.1], [1, 1, 1, 1], 2, 2)
    const [r] = referenceScalarPixel(source, lut, style, 0.5, 0.5)
    expect(r).toBeGreaterThan(126)
    expect(r).toBeLessThan(129)
  })

  it('does not put the arithmetic midpoint there', () => {
    // 0.505 is halfway up the range linearly and near the top logarithmically.
    const source = layer([0.505, 0.505, 0.505, 0.505], [1, 1, 1, 1], 2, 2)
    expect(referenceScalarPixel(source, lut, style, 0.5, 0.5)[0]).toBeGreaterThan(200)
  })

  it('drops a non-positive sample rather than painting it the floor color', () => {
    const source = layer([0, 0, 0, 0], [1, 1, 1, 1], 2, 2)
    expect(referenceScalarPixel(source, lut, style, 0.5, 0.5)).toEqual([0, 0, 0, 0])
  })

  it('averages in value space before normalizing, not after', () => {
    // Neighbors 0.01 and 1: the value-space mean is 0.505 (near the ramp top),
    // while normalizing first and then averaging would land at the midpoint.
    const source = layer([0.01, 1, 0.01, 1], [1, 1, 1, 1], 2, 2)
    expect(referenceScalarPixel(source, lut, style, 0.5, 0)[0]).toBeGreaterThan(200)
  })
})

describe('referenceScalarPixel — temporal blend', () => {
  const style: ReferenceScalarStyle = {
    stops: BLACK_TO_WHITE,
    valueRange: [0, 100],
    scale: 'linear',
    sampling: 'coastal',
  }
  const lut = referenceLut(style)

  it('mixes the two frames at the given progress', () => {
    const lower = layer([0, 0, 0, 0], [1, 1, 1, 1], 2, 2)
    const upper = layer([100, 100, 100, 100], [1, 1, 1, 1], 2, 2)
    const [r] = referenceScalarPixel(lower, lut, style, 0.5, 0.5, { upper, progress: 0.5 })
    expect(r).toBeGreaterThan(126)
    expect(r).toBeLessThan(129)
  })

  it('falls back to the frame that has data where the other does not', () => {
    const lower = layer([80, 80, 80, 80], [1, 1, 1, 1], 2, 2)
    const upper = layer([0, 0, 0, 0], [0, 0, 0, 0], 2, 2)
    const [r, , , a] = referenceScalarPixel(lower, lut, style, 0.5, 0.5, { upper, progress: 1 })
    expect(a).toBeGreaterThan(0)
    expect(r).toBeGreaterThan(190)
  })
})

describe('referenceRenderScalarTile', () => {
  const style: ReferenceScalarStyle = {
    stops: BLACK_TO_WHITE,
    valueRange: [0, 100],
    scale: 'linear',
  }

  it('renders the layer geometry by default', () => {
    const raster = referenceRenderScalarTile(layer([0, 100, 0, 100], [1, 1, 1, 1], 2, 2), style)
    expect(raster.width).toBe(2)
    expect(raster.height).toBe(2)
    expect(raster.pixels.length).toBe(16)
  })

  it('supersamples without inventing data outside the mask', () => {
    const raster = referenceRenderScalarTile(layer([0, 100, 0, 100], [1, 1, 0, 0], 2, 2), style, {
      width: 8,
      height: 8,
    })
    // Every pixel is either painted or fully transparent, never partly colored
    // from a missing neighbor under the default soft rule.
    for (let i = 3; i < raster.pixels.length; i += 4) {
      expect([0, 255]).toContain(raster.pixels[i])
    }
  })

  it('registers a cell-center anchor half a cell off a cell-edge one', () => {
    const source = layer([0, 100, 0, 100], [1, 1, 1, 1], 2, 2)
    const center = referenceRenderScalarTile(source, style, { width: 4, height: 1 })
    const edge = referenceRenderScalarTile(source, style, {
      width: 4,
      height: 1,
      anchor: 'cell-edge',
    })
    expect(Array.from(center.pixels)).not.toEqual(Array.from(edge.pixels))
  })
})

describe('referenceRenderScalarViewport', () => {
  const style: ReferenceScalarStyle = {
    stops: BLACK_TO_WHITE,
    valueRange: [0, 100],
    scale: 'linear',
  }

  it('leaves everything outside the data bbox transparent', () => {
    const raster = referenceRenderScalarViewport(layer([50, 50, 50, 50], [1, 1, 1, 1], 2, 2), style, {
      viewport: {
        center: { latitude: 0, longitude: 0 },
        span: { latitudeDelta: 4, longitudeDelta: 4 },
      },
      bbox: [-1, -1, 1, 1],
      width: 16,
      height: 16,
    })
    // The data covers the middle half of the viewport, so the corners are empty.
    expect(raster.pixels[3]).toBe(0)
    expect(raster.pixels[raster.pixels.length - 1]).toBe(0)
    expect(Array.from(raster.pixels).some((byte) => byte > 0)).toBe(true)
  })
})

describe('resolveRampStops', () => {
  const legacy = [
    { value: 0, r: 0, g: 0, b: 0 },
    { value: 100, r: 255, g: 255, b: 255 },
  ]

  it('prefers canonical stops when both are supplied', () => {
    const resolved = resolveRampStops({
      ramp: legacy,
      rampStops: BLACK_TO_WHITE,
      valueRange: { lowerBound: 0, upperBound: 100 },
      scale: 'linear',
    })
    expect(resolved).toBe(BLACK_TO_WHITE)
  })

  it('converts legacy value-domain stops into position space', () => {
    const resolved = resolveRampStops({
      ramp: [
        { value: 0.01, r: 0, g: 0, b: 0 },
        { value: 0.1, r: 128, g: 128, b: 128 },
        { value: 1, r: 255, g: 255, b: 255 },
      ],
      valueRange: { lowerBound: 0.01, upperBound: 1 },
      scale: 'log',
    })
    // The middle stop is the geometric midpoint, so it lands at position 0.5 —
    // sampling it in value space would have pinned it near 0.09 instead.
    expect(resolved[1]!.position).toBeCloseTo(0.5, 12)
  })

  it('supplies a default alpha for legacy stops that carry none', () => {
    const resolved = resolveRampStops({
      ramp: legacy,
      valueRange: { lowerBound: 0, upperBound: 100 },
      scale: 'linear',
    })
    expect(resolved.every((stop) => stop.rgba[3] === 255)).toBe(true)
  })

  it('draws nothing for a genuinely degenerate range', () => {
    expect(
      resolveRampStops({
        ramp: legacy,
        valueRange: { lowerBound: 5, upperBound: 5 },
        scale: 'linear',
      }),
    ).toEqual([])
  })

  it('does not blank a NaN-bounded range, because the server does not', () => {
    // 0.2.1 corrected normalizeValue's guard to `lo >= hi`, which is false for
    // NaN — the server clamps such a range to position 0 rather than raising.
    // Guarding here with `!(lo < hi)` instead would blank a layer that the
    // canonical engine, GeoGridKit, and the published tiles all still color.
    const resolved = resolveRampStops({
      ramp: legacy,
      valueRange: { lowerBound: Number.NaN, upperBound: 100 },
      scale: 'linear',
    })
    expect(resolved).toHaveLength(2)
    expect(resolved.every((stop) => stop.position === 0)).toBe(true)
  })
})

describe('frame adapters', () => {
  it('views a temporal frame as a GridFrame without copying planes', () => {
    const values = new Uint16Array([1, 2, 3, 4])
    const mask = new Uint8Array([1, 1, 1, 1])
    const frame = gridFrameFromTemporal({
      date: '2026-08-01',
      width: 2,
      height: 2,
      renderMode: 'scalar',
      values,
      mask,
    })
    expect(frame.key).toBe('2026-08-01')
    expect(frame.valueKind).toBe('encoded-u16')
    expect(frame.values).toBe(values)
    expect(frame.mask).toBe(mask)
    expect(isGridFrame(frame)).toBe(true)
    expect(toGridFrame(frame)).toBe(frame)
  })

  it('defaults each dialect to its own bbox anchor', () => {
    expect(defaultBBoxAnchor('float32')).toBe('cell-center')
    expect(defaultBBoxAnchor('encoded-u16')).toBe('cell-edge')
  })

  it('builds a float32 frame from a decoded /grid plane', () => {
    const dataset = fakeDataset()
    const frame = gridFrameFromScalarDataset(dataset, 1)
    expect(frame.valueKind).toBe('float32')
    expect(frame.renderMode).toBe('scalar')
    expect(frame.values).toBe(dataset.planes[1])
    expect(frame.mask).toBe(dataset.masks[1])
    expect(frame.key).toContain('kd490')
    expect(frame.key).toContain('b')
  })

  it('honors an explicit key', () => {
    expect(gridFrameFromScalarDataset(fakeDataset(), 0, { key: 'pinned' }).key).toBe('pinned')
  })

  it('refuses a plane the dataset does not carry', () => {
    expect(() => gridFrameFromScalarDataset(fakeDataset(), 7)).toThrow(/no plane 7/)
  })
})

describe('frameContentKey — float32 planes', () => {
  const mask = new Uint8Array([1, 1, 1, 1])

  it('separates planes that differ only below the decimal point', () => {
    // The integer mixer truncates, so both of these used to fingerprint the
    // same and a refetched grid could reuse a stale GPU texture.
    const first = frameContentKey('', 2, 2, new Float32Array([0.1, 0.2, 0.3, 0.4]), mask)
    const second = frameContentKey('', 2, 2, new Float32Array([0.5, 0.6, 0.7, 0.8]), mask)
    expect(first).not.toBe(second)
  })

  it('separates mostly-NaN planes by their real samples', () => {
    const nan = Number.NaN
    const holes = new Uint8Array([0, 1, 0, 0])
    const first = frameContentKey('', 2, 2, new Float32Array([nan, 1.5, nan, nan]), holes)
    const second = frameContentKey('', 2, 2, new Float32Array([nan, 2.5, nan, nan]), holes)
    expect(first).not.toBe(second)
  })

  it('is stable for identical float content', () => {
    const values = () => new Float32Array([0.1, 0.2, Number.NaN, 0.4])
    expect(frameContentKey('k', 2, 2, values(), mask)).toBe(frameContentKey('k', 2, 2, values(), mask))
  })

  it('separates two large planes differing well away from the sampled stride', () => {
    // The old hash walked a stride of n/64 — about 65 of 262,144 cells on a
    // 512x512 grid — so two grids could differ in tens of thousands of cells
    // and still fingerprint identically. For a /grid frame that hash *is* the
    // cache identity (no date to fall back on), so a collision means the GPU
    // keeps drawing the previous dataset.
    const size = 512 * 512
    const first = new Float32Array(size)
    const second = new Float32Array(size)
    for (let i = 0; i < size; i += 1) {
      first[i] = i % 97
      second[i] = i % 97
    }
    // Perturb tens of thousands of cells, deliberately skipping every index the
    // old n/64 stride would have visited, so the change is invisible to it.
    const oldStride = Math.max(1, Math.floor(size / 64))
    let changed = 0
    for (let i = 1; i < size; i += 5) {
      if (i % oldStride === 0 || i === size - 1) continue
      second[i] = (second[i] ?? 0) + 1
      changed += 1
    }
    expect(changed).toBeGreaterThan(40_000)
    const mask = new Uint8Array(size).fill(1)
    expect(frameContentKey('', 512, 512, first, mask)).not.toBe(
      frameContentKey('', 512, 512, second, mask),
    )
  })

  it('separates two planes that differ only in their masks', () => {
    const values = new Float32Array([1.5, 2.5, 3.5, 4.5])
    expect(frameContentKey('', 2, 2, values, new Uint8Array([1, 1, 1, 1]))).not.toBe(
      frameContentKey('', 2, 2, values, new Uint8Array([1, 1, 0, 1])),
    )
  })

  it('still fingerprints integer planes exactly as it always did', () => {
    // Pinned literally: the temporal dialect's cache keys must not move.
    expect(frameContentKey('2026-08-01', 2, 2, new Uint16Array([1, 2, 3, 4]), mask)).toBe(
      '2026-08-01|2x2|4|4|4011250699',
    )
  })
})

function fakeDataset(): GridScalarDataset {
  return {
    header: {
      layer: 'kd490',
      variables: ['a', 'b'],
      planeCount: 2,
      bbox: [-1, -1, 1, 1],
      width: 2,
      height: 2,
      lon0: -1,
      lat0: 1,
      dx: 2,
      dy: -2,
      units: null,
      scale: 'log',
      valueRange: { lowerBound: 0.01, upperBound: 6.6 },
      renderMode: 'scalar',
      validTime: null,
      missing: 'NaN',
      releaseId: null,
      generationId: null,
      provenanceCounts: null,
      extra: {},
    },
    planes: [new Float32Array([1, 2, 3, 4]), new Float32Array([5, 6, 7, 8])],
    masks: [new Uint8Array([1, 1, 1, 1]), new Uint8Array([1, 1, 1, 1])],
    stride: null,
  }
}
