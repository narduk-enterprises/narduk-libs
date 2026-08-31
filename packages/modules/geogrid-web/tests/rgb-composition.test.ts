import { describe, expect, it } from 'vitest'

import {
  frameContentKey,
  linearChannelToSrgb,
  nearestMaskValid,
  observationWeightForZoom,
  srgbChannelToLinear,
  viewportZoom,
} from '../src/core/math.js'
import {
  referenceRenderRgbCompositionTile,
  referenceRgbCompositionPixel,
  type ReferenceRgbCompositionLayer,
} from '../src/core/reference-render.js'
import type { GridRgbComposition, GridViewport } from '../src/core/models.js'
import {
  rgbCompositionFragmentShader,
  rgbFragmentShader,
} from '../src/render/gl.js'
import { RGB_COMPOSITION_TEXTURE_UNIT_COUNT } from '../src/render/webgl2.js'

function solidComposition(
  base: readonly [number, number, number],
  observed: readonly [number, number, number],
  options: {
    baseMask?: number
    observedMask?: number
    confidence?: number
  } = {},
): ReferenceRgbCompositionLayer {
  return {
    baseChannels: [[base[0]], [base[1]], [base[2]]],
    observedChannels: [[observed[0]], [observed[1]], [observed[2]]],
    confidence: [options.confidence ?? 255],
    baseMask: [options.baseMask ?? 1],
    observedMask: [options.observedMask ?? 1],
    width: 1,
    height: 1,
  }
}

function edgeComposition(
  baseMask: readonly number[],
  observedMask: readonly number[],
): ReferenceRgbCompositionLayer {
  return {
    baseChannels: [[40, 250], [80, 17], [120, 239]],
    observedChannels: [[180, 3], [140, 4], [100, 5]],
    confidence: [255, 255],
    baseMask,
    observedMask,
    width: 2,
    height: 1,
  }
}

describe('scale-aware zoom contract', () => {
  it('hits every integer anchor exactly and interpolates continuously between them', () => {
    for (let zoom = 0; zoom <= 7; zoom += 1) {
      expect(observationWeightForZoom(zoom)).toBe(0)
    }
    expect(observationWeightForZoom(8)).toBe(0.25)
    expect(observationWeightForZoom(9)).toBe(0.4)
    expect(observationWeightForZoom(10)).toBe(1)
    expect(observationWeightForZoom(20)).toBe(1)
    expect(observationWeightForZoom(7.5)).toBe(0.125)
    expect(observationWeightForZoom(8.5)).toBe(0.325)
    expect(observationWeightForZoom(9.5)).toBe(0.7)
    expect(observationWeightForZoom(Number.NaN)).toBe(0)
  })

  it('uses explicit zoom, otherwise derives continuous Web-Mercator zoom from CSS width and span', () => {
    const viewport: GridViewport = {
      center: { latitude: 0, longitude: 0 },
      span: { latitudeDelta: 10, longitudeDelta: 360 },
    }
    expect(viewportZoom(viewport, 256)).toBe(0)
    expect(viewportZoom(viewport, 2048)).toBe(3)
    expect(viewportZoom({ ...viewport, zoom: 8.25 }, 1)).toBe(8.25)
    expect(viewportZoom({ ...viewport, zoom: Number.NaN }, 2048)).toBeNull()
    expect(viewportZoom({ ...viewport, zoom: Number.POSITIVE_INFINITY }, 2048)).toBeNull()
    expect(viewportZoom(viewport, 0)).toBeNull()
  })
})

describe('linear-sRGB composition', () => {
  it('composes base and observed in linear light rather than averaging display bytes', () => {
    const pixel = referenceRgbCompositionPixel(
      solidComposition([0, 0, 0], [255, 255, 255]),
      { observationWeight: 0.5, sampling: 'soft' },
      0,
      0,
    )
    const expected = linearChannelToSrgb(0.5) * 255
    expect(pixel[0]).toBeCloseTo(expected, 10)
    expect(pixel[1]).toBeCloseTo(expected, 10)
    expect(pixel[2]).toBeCloseTo(expected, 10)
    expect(pixel[0]).toBeGreaterThan(180)
    expect(pixel[3]).toBe(255)
  })

  it('multiplies the zoom anchor by observed confidence', () => {
    const confidence = 128
    const pixel = referenceRgbCompositionPixel(
      solidComposition([0, 0, 0], [255, 255, 255], { confidence }),
      { observationWeight: 0.6, sampling: 'soft' },
      0,
      0,
    )
    const expected = linearChannelToSrgb(0.6 * (confidence / 255)) * 255
    expect(pixel[0]).toBeCloseTo(expected, 10)
  })

  it('blends lower and upper dates in linear light', () => {
    const lower = solidComposition([0, 0, 0], [0, 0, 0])
    const upper = solidComposition([255, 255, 255], [255, 255, 255])
    const pixel = referenceRgbCompositionPixel(
      lower,
      { observationWeight: 1, sampling: 'soft' },
      0,
      0,
      { upper, progress: 0.5 },
    )
    expect(pixel[0]).toBeCloseTo(linearChannelToSrgb(0.5) * 255, 10)
    expect(pixel[0]).not.toBeCloseTo(127.5, 1)
  })

  it('preserves honest one-sided support and leaves a true two-sided gap transparent', () => {
    const observedOnly = referenceRgbCompositionPixel(
      solidComposition([0, 0, 0], [12, 140, 220], { baseMask: 0, observedMask: 1 }),
      { observationWeight: 0, sampling: 'soft' },
      0,
      0,
    )
    const baseOnly = referenceRgbCompositionPixel(
      solidComposition([50, 90, 130], [0, 0, 0], { baseMask: 1, observedMask: 0 }),
      { observationWeight: 1, sampling: 'soft' },
      0,
      0,
    )
    const gap = referenceRgbCompositionPixel(
      solidComposition([1, 2, 3], [4, 5, 6], { baseMask: 0, observedMask: 0 }),
      { observationWeight: 1, sampling: 'soft' },
      0,
      0,
    )

    expect(observedOnly[0]).toBeCloseTo(12, 12)
    expect(observedOnly.slice(1)).toEqual([140, 220, 255])
    expect(baseOnly[0]).toBeCloseTo(50, 12)
    expect(baseOnly[1]).toBeCloseTo(90, 12)
    expect(baseOnly[2]).toBeCloseTo(130, 12)
    expect(baseOnly[3]).toBe(255)
    expect(gap).toEqual([0, 0, 0, 0])
  })

  it('keeps composed alpha within the union of current base and observed nearest support', () => {
    const source = edgeComposition([1, 0], [1, 0])
    for (let x = -0.5; x <= 1.5; x += 0.01) {
      const legacyVisible =
        nearestMaskValid(source.baseMask, source.width, source.height, x, 0) ||
        nearestMaskValid(source.observedMask, source.width, source.height, x, 0)
      const pixel = referenceRgbCompositionPixel(
        source,
        { observationWeight: 0, sampling: 'coastal' },
        x,
        0,
      )
      expect(pixel[3]).toBeLessThanOrEqual(legacyVisible ? 255 : 0)
      if (!legacyVisible) expect(pixel).toEqual([0, 0, 0, 0])
    }

    const validEdge = referenceRgbCompositionPixel(
      source,
      { observationWeight: 0, sampling: 'coastal' },
      0.49,
      0,
    )
    expect(validEdge[0]).toBeCloseTo(40, 12)
    expect(validEdge[1]).toBeCloseTo(80, 12)
    expect(validEdge[2]).toBeCloseTo(120, 12)
    expect(validEdge[3]).toBeGreaterThan(0)
    expect(
      referenceRgbCompositionPixel(source, { observationWeight: 0, sampling: 'coastal' }, 0.51, 0),
    ).toEqual([0, 0, 0, 0])
  })

  it('applies base and observed gates independently, including the reversed sentinel edge', () => {
    const baseOnly = edgeComposition([1, 0], [0, 0])
    const observedOnly = edgeComposition([0, 0], [1, 0])
    const reversed = edgeComposition([0, 1], [0, 1])

    const basePixel = referenceRgbCompositionPixel(
      baseOnly,
      { observationWeight: 1, sampling: 'coastal' },
      0.49,
      0,
    )
    expect(basePixel[0]).toBeCloseTo(40, 12)
    expect(basePixel[1]).toBeCloseTo(80, 12)
    expect(basePixel[2]).toBeCloseTo(120, 12)
    const observedPixel = referenceRgbCompositionPixel(
      observedOnly,
      { observationWeight: 1, sampling: 'coastal' },
      0.49,
      0,
    )
    expect(observedPixel[0]).toBeCloseTo(180, 12)
    expect(observedPixel[1]).toBeCloseTo(140, 12)
    expect(observedPixel[2]).toBeCloseTo(100, 12)
    expect(
      referenceRgbCompositionPixel(reversed, { observationWeight: 0, sampling: 'coastal' }, 0.49, 0),
    ).toEqual([0, 0, 0, 0])
    expect(
      referenceRgbCompositionPixel(reversed, { observationWeight: 0, sampling: 'coastal' }, 0.51, 0)[3],
    ).toBeGreaterThan(0)
  })

  it('preserves composed temporal 00/10/01/11 nearest-support fallback', () => {
    const frame = (valid: boolean, color: readonly [number, number, number]) =>
      solidComposition(color, color, { baseMask: valid ? 1 : 0, observedMask: valid ? 1 : 0 })
    const zero = frame(false, [1, 2, 3])
    const lower = frame(true, [20, 40, 60])
    const upper = frame(true, [200, 180, 160])
    const style = { observationWeight: 0, sampling: 'coastal' } as const

    expect(referenceRgbCompositionPixel(zero, style, 0, 0, { upper: zero, progress: 0.5 }))
      .toEqual([0, 0, 0, 0])
    expect(referenceRgbCompositionPixel(lower, style, 0, 0, { upper: zero, progress: 0.5 }))
      .toEqual([20, 40, 60, 255])
    expect(referenceRgbCompositionPixel(zero, style, 0, 0, { upper, progress: 0.5 }))
      .toEqual([200, 180, 160, 255])
    const both = referenceRgbCompositionPixel(lower, style, 0, 0, { upper, progress: 0.5 })
    expect(both[0]).toBeCloseTo(linearChannelToSrgb((srgbChannelToLinear(20 / 255) + srgbChannelToLinear(200 / 255)) / 2) * 255, 12)
    expect(both[1]).toBeCloseTo(linearChannelToSrgb((srgbChannelToLinear(40 / 255) + srgbChannelToLinear(180 / 255)) / 2) * 255, 12)
    expect(both[2]).toBeCloseTo(linearChannelToSrgb((srgbChannelToLinear(60 / 255) + srgbChannelToLinear(160 / 255)) / 2) * 255, 12)
    expect(both[3]).toBe(255)
  })

  it('keeps tile output bounded to byte channels', () => {
    const raster = referenceRenderRgbCompositionTile(
      solidComposition([3, 240, 40], [250, 2, 220]),
      { observationWeight: 0.8 },
      { width: 9, height: 7 },
    )
    expect(Array.from(raster.pixels).every((value) => value >= 0 && value <= 255)).toBe(true)
  })

  it('round-trips the transfer function endpoints', () => {
    expect(linearChannelToSrgb(srgbChannelToLinear(0))).toBe(0)
    expect(linearChannelToSrgb(srgbChannelToLinear(1))).toBeCloseTo(1, 12)
    expect(linearChannelToSrgb(srgbChannelToLinear(0.5))).toBeCloseTo(0.5, 12)
  })
})

describe('composition cache identity', () => {
  const base = (): GridRgbComposition => ({
    baseChannels: [new Uint8Array([10]), new Uint8Array([20]), new Uint8Array([30])],
    observedChannels: [new Uint8Array([40]), new Uint8Array([50]), new Uint8Array([60])],
    confidence: new Uint8Array([128]),
    baseMask: new Uint8Array([1]),
    observedMask: new Uint8Array([1]),
  })

  it('changes for base, observed, confidence, or mask-only changes', () => {
    const key = (composition: GridRgbComposition): string =>
      frameContentKey(
        'date',
        1,
        1,
        composition.baseChannels[0],
        composition.baseMask,
        composition.baseChannels,
        composition,
      )
    const original = base()
    const baseColor = base()
    baseColor.baseChannels[2][0] = 31
    const observed = base()
    observed.observedChannels[1][0] = 51
    const confidence = base()
    confidence.confidence[0] = 129
    const mask = base()
    mask.observedMask[0] = 0
    const baseMask = base()
    baseMask.baseMask[0] = 0

    expect(key(baseColor)).not.toBe(key(original))
    expect(key(observed)).not.toBe(key(original))
    expect(key(confidence)).not.toBe(key(original))
    expect(key(mask)).not.toBe(key(original))
    expect(key(baseMask)).not.toBe(key(original))
  })
})

describe('packed WebGL composition contract', () => {
  it('uses two RGBA textures per date plus one stencil, within the WebGL2 minimum', () => {
    const shader = rgbCompositionFragmentShader()
    expect(RGB_COMPOSITION_TEXTURE_UNIT_COUNT).toBe(5)
    expect(RGB_COMPOSITION_TEXTURE_UNIT_COUNT).toBeLessThanOrEqual(16)
    expect(shader.match(/uniform sampler2D/g)).toHaveLength(5)
  })

  it('pins flag bits and never filters the packed validity byte', () => {
    const shader = rgbCompositionFragmentShader()
    expect(shader).toContain('const int BASE_VALID = 1;')
    expect(shader).toContain('const int OBSERVED_VALID = 2;')
    expect(shader).toContain('texelFetch(packedMasks, texels[i], 0).a * 255.0')
    expect(shader).toContain('(flags & maskBit) != 0')
    expect(shader).not.toContain('texture(packedMasks')

    expect(shader).toContain('ivec2 nearest = clamp(ivec2(floor(p + vec2(0.5)))')
    expect(shader).toContain('if ((nearestFlags & maskBit) == 0)')
    const hardGate = shader.indexOf('if ((nearestFlags & maskBit) == 0)')
    const firstColorRead = shader.indexOf('texelFetch(colors, texels[i], 0).rgb')
    expect(hardGate).toBeGreaterThanOrEqual(0)
    expect(hardGate).toBeLessThan(firstColorRead)
  })

  it('composes detail and time between transfer-function calls while legacy RGB stays isolated', () => {
    const shader = rgbCompositionFragmentShader()
    expect(shader).toContain('mix(baseLinear, observedLinear, weight)')
    expect(shader).toContain('linearToSrgb(mix(first, second, progress))')
    expect(shader).toContain('bool validBase = base.nearestValid;')
    expect(shader).toContain('bool validObserved = observed.nearestValid;')
    expect(shader).toContain('if (!validBase) return FrameSample(observedLinear, observed.coverage, true);')
    expect(shader).toContain('if (!validObserved) return FrameSample(baseLinear, base.coverage, true);')
    expect(shader).toContain('smoothstep(0.25, 1.0, coverage)')
    expect(rgbFragmentShader()).not.toContain('observationWeight')
    expect(rgbFragmentShader()).not.toContain('baseConfidence0')
  })
})
