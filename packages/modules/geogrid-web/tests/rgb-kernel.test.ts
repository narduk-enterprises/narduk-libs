import { describe, expect, it } from 'vitest'

import {
  coastalFeather,
  sampleRgbBilinearSoft,
} from '../src/core/math.js'
import {
  referenceRenderRgbViewport,
  referenceRgbPixel,
  type ReferenceRgbLayer,
} from '../src/core/reference-render.js'
import { rgbFragmentShader } from '../src/render/gl.js'
import { styleSampling } from '../src/render/style.js'
import type { GridStyle } from '../src/render/types.js'

function layer(
  red: number[],
  green: number[],
  blue: number[],
  mask: number[],
  width: number,
  height: number,
): ReferenceRgbLayer {
  return {
    channels: [red, green, blue],
    mask,
    width,
    height,
  }
}

const STYLE: GridStyle = {
  valueRange: { lowerBound: 0, upperBound: 1 },
  scale: 'linear',
}

describe('sampleRgbBilinearSoft', () => {
  const shoreline = layer(
    [204, 0, 204, 0],
    [153, 0, 153, 0],
    [51, 0, 51, 0],
    [1, 0, 1, 0],
    2,
    2,
  )

  it('renormalizes over real colors instead of blending a missing texel as black', () => {
    const sample = sampleRgbBilinearSoft(
      shoreline.channels,
      shoreline.mask,
      shoreline.width,
      shoreline.height,
      0.75,
      0.5,
      'coastal',
    )

    expect(sample.color).toEqual([0.8, 0.6, 0.2])
    expect(sample.weight).toBeCloseTo(0.25, 12)
    expect(sample.coverage).toBeCloseTo(0.25, 12)
  })

  it('keeps soft coverage crisp without treating a zero-weight missing corner as support', () => {
    const partial = sampleRgbBilinearSoft(
      shoreline.channels,
      shoreline.mask,
      shoreline.width,
      shoreline.height,
      0.25,
      0.5,
      'soft',
    )
    const exact = sampleRgbBilinearSoft(
      shoreline.channels,
      shoreline.mask,
      shoreline.width,
      shoreline.height,
      0,
      0.5,
      'soft',
    )

    expect(partial.coverage).toBe(0)
    expect(exact.coverage).toBe(1)
    expect(exact.color).toEqual([0.8, 0.6, 0.2])
  })

  it('reports an honest gap when no real neighbor survives', () => {
    const empty = sampleRgbBilinearSoft(
      shoreline.channels,
      [0, 0, 0, 0],
      2,
      2,
      0.5,
      0.5,
      'coastal',
    )
    expect(empty).toEqual({ color: [0, 0, 0], coverage: 0, weight: 0 })
  })

  it('does not turn an invalid cell center or an interior gap into support', () => {
    const separated = layer(
      [180, 0, 0, 0, 90],
      [120, 0, 0, 0, 60],
      [30, 0, 0, 0, 15],
      [1, 0, 0, 0, 1],
      5,
      1,
    )

    expect(
      sampleRgbBilinearSoft(separated.channels, separated.mask, 5, 1, 1, 0, 'coastal')
        .coverage,
    ).toBe(0)
    expect(
      sampleRgbBilinearSoft(separated.channels, separated.mask, 5, 1, 2.5, 0, 'coastal')
        .coverage,
    ).toBe(0)
  })
})

describe('referenceRgbPixel', () => {
  it('feathers only alpha while preserving the measured edge color', () => {
    const source = layer(
      [204, 0, 204, 0],
      [153, 0, 153, 0],
      [51, 0, 51, 0],
      [1, 0, 1, 0],
      2,
      2,
    )
    const pixel = referenceRgbPixel(source, { sampling: 'coastal' }, 0.75, 0.5)

    expect(pixel.slice(0, 3)).toEqual([204, 153, 51])
    expect(pixel[3]).toBeCloseTo(coastalFeather(0.25) * 255, 10)
  })

  it('falls back to the frame with support instead of fading its color toward black', () => {
    const missing = layer([0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], 2, 2)
    const observed = layer(
      [12, 12, 12, 12],
      [140, 140, 140, 140],
      [220, 220, 220, 220],
      [1, 1, 1, 1],
      2,
      2,
    )
    const pixel = referenceRgbPixel(missing, {}, 0.5, 0.5, {
      upper: observed,
      progress: 0.5,
    })

    expect(pixel).toEqual([12, 140, 220, 255])
  })

  it('blends adjacent real frames without channel overshoot', () => {
    const lower = layer([20, 20, 20, 20], [40, 40, 40, 40], [200, 200, 200, 200], [1, 1, 1, 1], 2, 2)
    const upper = layer([220, 220, 220, 220], [100, 100, 100, 100], [30, 30, 30, 30], [1, 1, 1, 1], 2, 2)
    const pixel = referenceRgbPixel(lower, {}, 0.5, 0.5, { upper, progress: 0.25 })

    expect(pixel).toEqual([70, 55, 157.5, 255])
    expect(pixel[0]).toBeGreaterThanOrEqual(20)
    expect(pixel[0]).toBeLessThanOrEqual(220)
    expect(pixel[2]).toBeGreaterThanOrEqual(30)
    expect(pixel[2]).toBeLessThanOrEqual(200)
  })
})

describe('RGB viewport parity', () => {
  it('is byte-exact when one viewport is split into adjacent halves', () => {
    const width = 5
    const height = 4
    const size = width * height
    const source = layer(
      Array.from({ length: size }, (_, index) => (index * 17) % 256),
      Array.from({ length: size }, (_, index) => (index * 29) % 256),
      Array.from({ length: size }, (_, index) => (index * 43) % 256),
      Array.from({ length: size }, (_, index) => (index === 7 ? 0 : 1)),
      width,
      height,
    )
    const bbox = [-1, -1, 1, 1] as const
    const full = referenceRenderRgbViewport(source, {}, {
      viewport: {
        center: { latitude: 0, longitude: 0 },
        span: { latitudeDelta: 2, longitudeDelta: 2 },
      },
      bbox,
      width: 64,
      height: 24,
    })
    const left = referenceRenderRgbViewport(source, {}, {
      viewport: {
        center: { latitude: 0, longitude: -0.5 },
        span: { latitudeDelta: 2, longitudeDelta: 1 },
      },
      bbox,
      width: 32,
      height: 24,
    })
    const right = referenceRenderRgbViewport(source, {}, {
      viewport: {
        center: { latitude: 0, longitude: 0.5 },
        span: { latitudeDelta: 2, longitudeDelta: 1 },
      },
      bbox,
      width: 32,
      height: 24,
    })

    for (let y = 0; y < full.height; y += 1) {
      const fullRow = full.pixels.slice(y * 64 * 4, (y + 1) * 64 * 4)
      const joined = new Uint8ClampedArray(64 * 4)
      joined.set(left.pixels.slice(y * 32 * 4, (y + 1) * 32 * 4), 0)
      joined.set(right.pixels.slice(y * 32 * 4, (y + 1) * 32 * 4), 32 * 4)
      expect(Array.from(joined)).toEqual(Array.from(fullRow))
    }
  })
})

describe('RGB shader contract', () => {
  it('fetches a 2x2 masked neighborhood instead of combining LINEAR color with a NEAREST mask', () => {
    const shader = rgbFragmentShader()

    expect(shader).toContain('vec4 sampleRgb(')
    expect(shader).toContain('texelFetch(mask, texels[i], 0)')
    expect(shader).toContain('texelFetch(r, texels[i], 0)')
    expect(shader).toContain('colorSum / weightSum')
    expect(shader).toContain('gridPosition(uv, vec2(textureSize(values0, 0)))')
    expect(shader).toContain('smoothstep(0.0, 0.55, coverage)')
    expect(shader).not.toContain('texture(mask0, uv)')
  })

  it('keeps scalar crisp by default while RGB defaults to honest coastal coverage', () => {
    expect(styleSampling(STYLE, 'scalar')).toBe('soft')
    expect(styleSampling(STYLE, 'rgb')).toBe('coastal')
    expect(styleSampling({ ...STYLE, sampling: 'soft' }, 'rgb')).toBe('soft')
  })
})
