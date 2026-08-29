import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { texelPositionFromUv } from '../src/core/math.js'
import { referenceScalarPixel } from '../src/core/reference-render.js'
import type { GridBBox, GridBBoxAnchor, GridFrame, RampStop } from '../src/core/models.js'
import type { GridBinaryHeader, GridScalarDataset } from '../src/core/decode/grid.js'
import { resolveRampStops, styleLut } from '../src/render/style.js'
import type { GridStyle } from '../src/render/types.js'
import {
  referenceRenderGridTile,
  renderGridTile,
  toGridTileLayer,
  type GridTileLayer,
} from '../src/tile/baker.js'
import { lonLatForTilePixel, tileColumnU, tileProjection } from '../src/tile/mercator.js'
import { canvasPixels, canvasSize, installOffscreenCanvas } from './support/offscreen-canvas.js'

let uninstall: () => void
beforeAll(() => {
  uninstall = installOffscreenCanvas()
})
afterAll(() => {
  uninstall()
})

/** A basin-shaped extent, so most of the world's tiles miss it. */
const GULF: GridBBox = [-92, 28, -88, 32]

const GRAY: RampStop[] = [
  { position: 0, rgba: [0, 0, 0, 255] },
  { position: 1, rgba: [255, 255, 255, 255] },
]

function frame(
  width: number,
  height: number,
  fill: (column: number, row: number) => number | null,
): GridFrame {
  const values = new Float32Array(width * height)
  const mask = new Uint8Array(width * height)
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const value = fill(column, row)
      const index = row * width + column
      values[index] = value ?? Number.NaN
      mask[index] = value === null ? 0 : 1
    }
  }
  return { key: `${width}x${height}`, width, height, renderMode: 'scalar', valueKind: 'float32', values, mask }
}

function layer(
  width: number,
  height: number,
  fill: (column: number, row: number) => number | null,
  anchor?: GridBBoxAnchor,
  bbox: GridBBox = GULF,
): GridTileLayer {
  return { frame: frame(width, height, fill), bbox, ...(anchor ? { bboxAnchor: anchor } : {}) }
}

function style(upperBound: number, overrides: Partial<GridStyle> = {}): GridStyle {
  return {
    rampStops: GRAY,
    valueRange: { lowerBound: 0, upperBound },
    scale: 'linear',
    ...overrides,
  }
}

function alphas(pixels: Uint8ClampedArray): number[] {
  const out: number[] = []
  for (let index = 3; index < pixels.length; index += 4) out.push(pixels[index]!)
  return out
}

function row(pixels: Uint8ClampedArray, side: number, rowIndex: number, channel = 0): number[] {
  const out: number[] = []
  for (let column = 0; column < side; column += 1) {
    out.push(pixels[(rowIndex * side + column) * 4 + channel]!)
  }
  return out
}

describe('renderGridTile canvas contract', () => {
  it('sizes the canvas to the requested pixel side', () => {
    for (const side of [64, 256, 512]) {
      const canvas = renderGridTile(layer(8, 8, (column) => column), style(7), {
        z: 12,
        x: 1024,
        y: 1690,
        side,
      })
      expect(canvasSize(canvas)).toEqual({ width: side, height: side })
    }
  })

  it('returns a transparent canvas — never null — for an all-nodata grid', () => {
    const canvas = renderGridTile(layer(8, 8, () => null), style(7), {
      z: 12,
      x: 1024,
      y: 1690,
      side: 32,
    })
    expect(canvas).not.toBeNull()
    expect(canvasSize(canvas)).toEqual({ width: 32, height: 32 })
    expect(alphas(canvasPixels(canvas)).every((alpha) => alpha === 0)).toBe(true)
  })

  it('returns a transparent canvas for a tile that misses the grid entirely', () => {
    // z6/50/26 is on the far side of the planet from the Gulf.
    const canvas = renderGridTile(layer(8, 8, (column) => column), style(7), {
      z: 6,
      x: 50,
      y: 26,
      side: 32,
    })
    expect(alphas(canvasPixels(canvas)).every((alpha) => alpha === 0)).toBe(true)
  })

  it('draws something for a tile that does hit the grid', () => {
    const canvas = renderGridTile(layer(8, 8, (column) => column), style(7), {
      z: 6,
      x: 16,
      y: 26,
      side: 32,
    })
    expect(alphas(canvasPixels(canvas)).some((alpha) => alpha > 0)).toBe(true)
  })

  it('refuses a degenerate side and a precolored frame', () => {
    const scalar = layer(8, 8, (column) => column)
    expect(() => renderGridTile(scalar, style(7), { z: 6, x: 16, y: 26, side: 0 })).toThrow(
      RangeError,
    )
    const rgb: GridTileLayer = { ...scalar, frame: { ...scalar.frame, renderMode: 'rgb' } }
    expect(() => renderGridTile(rgb, style(7), { z: 6, x: 16, y: 26, side: 8 })).toThrow(TypeError)
  })

  it('bakes the CPU path byte-for-byte into the canvas', () => {
    const source = layer(8, 8, (column) => column)
    const tile = { z: 6, x: 16, y: 26, side: 16 }
    const canvas = renderGridTile(source, style(7), { ...tile, backend: 'cpu' })
    const raster = referenceRenderGridTile(source, style(7), tile)
    expect(Array.from(canvasPixels(canvas))).toEqual(Array.from(raster.pixels))
  })
})

describe('tile geometry drives the samples', () => {
  /**
   * The renderer samples through `tileProjection`, which is a reformulation of
   * `lonLatForTilePixel` for the shader's sake. This walks the *other* route —
   * the fixture-pinned Swift port, straight to lon/lat, then into the bbox —
   * and asserts the pixels agree. A registration bug in the reformulation
   * cannot hide from both.
   */
  it('matches a per-pixel lonLat walk through the fixture-pinned port', () => {
    const source = layer(8, 8, (column, rowIndex) => column + rowIndex * 8)
    const tileStyle = style(63)
    const side = 24
    // Straddles the Gulf bbox's eastern edge, so the walk covers both the
    // sampled interior and the transparent outside in one pass.
    const tile = { z: 7, x: 32, y: 52, side }
    const raster = referenceRenderGridTile(source, tileStyle, tile)

    const lut = styleLut(tileStyle)
    const referenceLayer = {
      values: source.frame.values,
      mask: source.frame.mask,
      width: source.frame.width,
      height: source.frame.height,
      valueKind: source.frame.valueKind,
    }
    const referenceStyle = {
      stops: resolveRampStops(tileStyle),
      valueRange: tileStyle.valueRange,
      scale: 'linear' as const,
    }
    const [west, south, east, north] = GULF

    let compared = 0
    for (let rowIndex = 0; rowIndex < side; rowIndex += 1) {
      for (let column = 0; column < side; column += 1) {
        const coordinate = lonLatForTilePixel(tile, column + 0.5, rowIndex + 0.5)!
        const u = (coordinate.longitude - west) / (east - west)
        const v = (north - coordinate.latitude) / (north - south)
        const offset = (rowIndex * side + column) * 4
        if (u < 0 || u > 1 || v < 0 || v > 1) {
          expect(raster.pixels[offset + 3]).toBe(0)
          continue
        }
        const expected = referenceScalarPixel(
          referenceLayer,
          lut,
          referenceStyle,
          texelPositionFromUv(u, source.frame.width, 'cell-center'),
          texelPositionFromUv(v, source.frame.height, 'cell-center'),
        )
        for (let channel = 0; channel < 4; channel += 1) {
          expect(Math.abs(raster.pixels[offset + channel]! - Math.round(expected[channel]!))
            ).toBeLessThanOrEqual(1)
        }
        compared += 1
      }
    }
    expect(compared).toBeGreaterThan(100)
  })
})

describe('bboxAnchor', () => {
  /**
   * `/grid` bboxes span cell **centers**; a temporal manifest's spans cell
   * **edges**. The gap is exactly half a cell — invisible on a coarse grid and
   * a misregistered coastline on a fine one — so both are asserted, and against
   * the value they should read rather than against each other.
   *
   * The probe is a two-column grid ramping `0 → 1` across a tile that covers
   * the whole bbox in longitude. Under `cell-center` the two centers sit at the
   * tile's edges, so the value sweeps the full range across the tile. Under
   * `cell-edge` the centers sit a quarter of the way in from each edge, so the
   * outer quarters clamp flat and only the middle half ramps.
   */
  const bbox: GridBBox = [-180, -66.51326044311186, 0, 66.51326044311186]
  const tile = { z: 1, x: 0, y: 0, side: 64 }

  function sweep(anchor: GridBBoxAnchor): number[] {
    const source = layer(2, 2, (column) => column, anchor, bbox)
    const raster = referenceRenderGridTile(source, style(1), tile)
    return row(raster.pixels, tile.side, tile.side - 1)
  }

  it('sweeps the full ramp linearly across the tile when the bbox spans cell centers', () => {
    const values = sweep('cell-center')
    expect(values[0]).toBeLessThan(6)
    expect(values.at(-1)!).toBeGreaterThan(249)
    // The endpoints alone are true of `cell-edge` too — it clamps to 0 and 255
    // at the same places. The interior is where the half cell shows: under
    // `cell-center` the ramp is linear across the whole tile, so a quarter of
    // the way in is a quarter of the way up.
    expect(values[tile.side / 4]).toBeGreaterThan(56)
    expect(values[tile.side / 4]).toBeLessThan(72)
    expect(values[(tile.side * 3) / 4]).toBeGreaterThan(183)
    expect(values[(tile.side * 3) / 4]).toBeLessThan(199)
  })

  it('clamps the outer quarters when the bbox spans cell edges', () => {
    const values = sweep('cell-edge')
    // First and last quarters sit outside both cell centers and clamp flat.
    expect(values.slice(0, tile.side / 4).every((value) => value === 0)).toBe(true)
    expect(values.slice(-tile.side / 4).every((value) => value === 255)).toBe(true)
    // The middle half still ramps, so this is a shift and not a flattening.
    expect(values[tile.side / 2]).toBeGreaterThan(100)
    expect(values[tile.side / 2]).toBeLessThan(160)
  })

  it('differs between the two anchors by exactly the half cell', () => {
    expect(sweep('cell-center')).not.toEqual(sweep('cell-edge'))
  })
})

describe('overzoom', () => {
  /**
   * Every output pixel samples the grid at its own position, so there is no
   * ancestor tile to crop and no cell block to magnify. Past the grid's native
   * resolution the result is a smooth value-space surface.
   *
   * The 8×8 grid over a 4° bbox resolves at roughly z9, so z12 is native + 3
   * and z15 is native + 6 — a whole z12 tile covers about a sixth of one cell.
   *
   * ## Two things this has to get right to mean anything
   *
   * **The value range must be tight enough that the tile sweeps the ramp.** An
   * earlier version of this block used the grid's full `0…7` range, so a z12
   * tile spanned about five 8-bit counts end to end. At that gradient a *nearest
   * -upscaled* rendering also steps ≤1 count per pixel and also shows ~6 distinct
   * values, and the assertions passed identically for both implementations —
   * coverage of the one behavior that justifies this render path at all. The
   * range is therefore derived from the tile's own extent, not written by hand,
   * so it cannot drift back into meaninglessness if the tile moves.
   *
   * **The comparison must be against a real blocky rendering, not a guess about
   * one.** {@link coarseUpscaledRow} renders the identical geography at an
   * eighth the resolution and magnifies it back with nearest sampling — exactly
   * the sampling an ancestor-tile crop performs — so every assertion below is
   * checked to fail for it.
   */
  const source = layer(8, 8, (column) => column)

  /**
   * The value range a tile actually spans, in the units of this fixture.
   *
   * The fill is `value = column` and the sampler is bilinear, so a sample at
   * texel position `gx` is exactly `gx` — which makes the tile's value extent
   * the texel positions of its two edges.
   */
  function tightRange(tile: { z: number; x: number; y: number; side: number }): GridStyle {
    const projection = tileProjection(tile, GULF)!
    const lowerBound = texelPositionFromUv(tileColumnU(projection, 0), 8, 'cell-center')
    const upperBound = texelPositionFromUv(tileColumnU(projection, 1), 8, 'cell-center')
    return { rampStops: GRAY, valueRange: { lowerBound, upperBound }, scale: 'linear' }
  }

  function middleRow(tile: { z: number; x: number; y: number; side: number }): number[] {
    return row(referenceRenderGridTile(source, tightRange(tile), tile).pixels, tile.side, tile.side / 2)
  }

  /** What a renderer that cropped and magnified an ancestor tile would produce. */
  function coarseUpscaledRow(
    tile: { z: number; x: number; y: number; side: number },
    factor: number,
  ): number[] {
    const coarse = referenceRenderGridTile(source, tightRange(tile), {
      ...tile,
      side: tile.side / factor,
    })
    const coarseSide = tile.side / factor
    const coarseRow = row(coarse.pixels, coarseSide, Math.floor(coarseSide / 2))
    return Array.from({ length: tile.side }, (_, index) => coarseRow[Math.floor(index / factor)]!)
  }

  function distinct(values: number[]): number {
    return new Set(values).size
  }

  function maxStep(values: number[]): number {
    let worst = 0
    for (let index = 1; index < values.length; index += 1) {
      worst = Math.max(worst, Math.abs(values[index]! - values[index - 1]!))
    }
    return worst
  }

  const z12 = { z: 12, x: 1024, y: 1690, side: 64 }
  const z15 = { z: 15, x: 8192, y: 13525, side: 64 }

  it.each([
    { label: 'native + 3', tile: z12 },
    { label: 'native + 6', tile: z15 },
  ])('is fully covered and monotone at $label', ({ tile }) => {
    const raster = referenceRenderGridTile(source, tightRange(tile), tile)
    expect(alphas(raster.pixels).every((alpha) => alpha === 255)).toBe(true)
    const middle = row(raster.pixels, tile.side, tile.side / 2)
    for (let index = 1; index < middle.length; index += 1) {
      expect(middle[index]!).toBeGreaterThanOrEqual(middle[index - 1]!)
    }
  })

  it.each([
    { label: 'native + 3', tile: z12 },
    { label: 'native + 6', tile: z15 },
  ])('resolves per-pixel detail a magnified ancestor cannot at $label', ({ tile }) => {
    const direct = middleRow(tile)
    const upscaled = coarseUpscaledRow(tile, 8)

    // Not a flat cell: the field genuinely varies inside one grid cell.
    expect(distinct(direct)).toBeGreaterThanOrEqual(tile.side / 2)
    // Not a magnified block: the crop-and-upscale rendering of the same
    // geography is measurably coarser on both counts. These are the assertions
    // that would have to fail if the render path ever started cropping.
    expect(distinct(upscaled)).toBeLessThan(distinct(direct) / 4)
    expect(maxStep(direct)).toBeLessThan(maxStep(upscaled) / 4)
  })

  it('keeps refining as the zoom goes deeper', () => {
    // The z15 tile lies inside the z12 one, so a renderer that stopped refining
    // past some depth would show the deeper tile resolving no more of the ramp
    // than the shallower. Compared through each tile's own range, both sweep it.
    expect(distinct(middleRow(z15))).toBeGreaterThanOrEqual(z15.side / 2)
    expect(distinct(middleRow(z12))).toBeGreaterThanOrEqual(z12.side / 2)
  })
})

describe('opacity', () => {
  it('composes the style opacity into the tile alpha', () => {
    const source = layer(8, 8, (column) => column)
    const opaque = referenceRenderGridTile(source, style(7), { z: 6, x: 16, y: 26, side: 16 })
    const faded = referenceRenderGridTile(source, style(7, { opacity: 0.5 }), {
      z: 6,
      x: 16,
      y: 26,
      side: 16,
    })
    const opaqueAlphas = alphas(opaque.pixels)
    const fadedAlphas = alphas(faded.pixels)
    expect(fadedAlphas.some((alpha) => alpha > 0)).toBe(true)
    for (let index = 0; index < opaqueAlphas.length; index += 1) {
      expect(Math.abs(fadedAlphas[index]! - Math.round(opaqueAlphas[index]! * 0.5))
        ).toBeLessThanOrEqual(1)
    }
  })

  it('treats a corrupt opacity as fully opaque, not as invisible', () => {
    // `Math.max(0, NaN)` is `NaN`, which the LUT scaling then reads as zero — so
    // the naive clamp turns one bad number into a blank layer with no error.
    const source = layer(8, 8, (column) => column)
    const tile = { z: 6, x: 16, y: 26, side: 16 }
    const plain = referenceRenderGridTile(source, style(7), tile)
    for (const opacity of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const corrupt = referenceRenderGridTile(source, style(7), { ...tile, opacity })
      expect(Array.from(corrupt.pixels)).toEqual(Array.from(plain.pixels))
    }
    // A real zero still means invisible.
    const zero = referenceRenderGridTile(source, style(7), { ...tile, opacity: 0 })
    expect(alphas(zero.pixels).every((alpha) => alpha === 0)).toBe(true)
  })

  it('lets an explicit option hand opacity back to the host', () => {
    const source = layer(8, 8, (column) => column)
    const styled = referenceRenderGridTile(source, style(7, { opacity: 0.5 }), {
      z: 6,
      x: 16,
      y: 26,
      side: 16,
      opacity: 1,
    })
    const plain = referenceRenderGridTile(source, style(7), { z: 6, x: 16, y: 26, side: 16 })
    expect(Array.from(styled.pixels)).toEqual(Array.from(plain.pixels))
  })
})

describe('displayRange', () => {
  /**
   * The stretch has to reach a tile, and it arrives by a different road than it
   * does for the overlay: `GridOverlay` owns a `GridStretchController`, while a
   * tile source has no viewport and no idle event and simply renders the style
   * it is handed. If `referenceStyleFor` dropped `displayRange` on the floor,
   * every tile would render against the *unstretched* ramp while the overlay
   * beside it rendered the stretched one — two renderers disagreeing about the
   * same bytes, which is the failure this package exists to prevent, and one no
   * existing test could see because both results still look plausible.
   */
  const stretchSource = layer(8, 8, (column) => column)
  const stretchTile = { z: 6, x: 16, y: 26, side: 16 }

  it('spreads the ramp over displayRange while decoding through valueRange', () => {
    const unstretched = referenceRenderGridTile(stretchSource, style(7), stretchTile)
    const stretched = referenceRenderGridTile(
      stretchSource,
      style(7, { displayRange: { lowerBound: 3, upperBound: 4 } }),
      stretchTile,
    )
    expect(Array.from(stretched.pixels)).not.toEqual(Array.from(unstretched.pixels))
    // A range narrowed to 3…4 drives most of an 0…7 field to one end of the ramp.
    const reds = row(stretched.pixels, stretchTile.side, stretchTile.side / 2)
    expect(reds.filter((value) => value === 0 || value === 255).length).toBeGreaterThan(
      reds.length / 2,
    )
  })

  it('renders exactly the unstretched tile when displayRange equals valueRange', () => {
    const plain = referenceRenderGridTile(stretchSource, style(7), stretchTile)
    const explicit = referenceRenderGridTile(
      stretchSource,
      style(7, { displayRange: { lowerBound: 0, upperBound: 7 } }),
      stretchTile,
    )
    expect(Array.from(explicit.pixels)).toEqual(Array.from(plain.pixels))
  })

  it('draws nothing rather than throwing on a corrupt displayRange', () => {
    const corrupt = referenceRenderGridTile(
      stretchSource,
      style(7, { displayRange: { lowerBound: 5, upperBound: 5 } }),
      stretchTile,
    )
    expect(alphas(corrupt.pixels).every((alpha) => alpha === 0)).toBe(true)
  })

  it('reaches the tile through the image source too', async () => {
    const { createGridTileImageSource } = await import('../src/tile/image-source.js')
    const stretched = style(7, { displayRange: { lowerBound: 3, upperBound: 4 } })
    const viaSource = await createGridTileImageSource({
      source: stretchSource,
      style: stretched,
      side: stretchTile.side,
    })(stretchTile.x, stretchTile.y, stretchTile.z, 1)
    const direct = renderGridTile(stretchSource, stretched, stretchTile)
    expect(Array.from(canvasPixels(viaSource))).toEqual(Array.from(canvasPixels(direct)))
  })
})

describe('toGridTileLayer', () => {
  function dataset(): GridScalarDataset {
    const width = 4
    const height = 3
    const header: GridBinaryHeader = {
      layer: 'kd490',
      variables: ['kd490'],
      planeCount: 1,
      bbox: [-92, 28, -89, 32],
      width,
      height,
      lon0: -92,
      lat0: 32,
      dx: 1,
      dy: -2,
      units: null,
      scale: 'linear',
      valueRange: null,
      renderMode: 'scalar',
      validTime: null,
      missing: 'NaN',
      releaseId: null,
      generationId: null,
      provenanceCounts: null,
      extra: {},
    }
    const values = new Float32Array(width * height).fill(1)
    const masks = new Uint8Array(width * height).fill(1)
    return { header, planes: [values], masks: [masks], stride: null }
  }

  it('places a decoded dataset on its own cell-center geometry', () => {
    const placed = toGridTileLayer(dataset())
    expect(placed.bbox).toEqual([-92, 28, -89, 32])
    expect(placed.bboxAnchor).toBe('cell-center')
    expect(placed.frame.valueKind).toBe('float32')
    expect(placed.frame.width).toBe(4)
  })

  it('passes a positioned layer through untouched', () => {
    const positioned = layer(2, 2, () => 1, 'cell-edge')
    expect(toGridTileLayer(positioned)).toBe(positioned)
  })

  /**
   * Not a micro-optimization: the conversion hashes the whole plane to build
   * the frame's default cache key (~3.6 ms at 512²), and a map draws dozens of
   * tiles from one dataset. Re-deriving per tile would also hand the GPU
   * renderer a fresh `GridFrame` each time and defeat its texture cache
   * entirely, so identity here is load-bearing rather than incidental.
   */
  it('converts a dataset once and reuses the frame across tiles', () => {
    const decoded = dataset()
    const first = toGridTileLayer(decoded)
    expect(toGridTileLayer(decoded)).toBe(first)
    expect(toGridTileLayer(decoded).frame).toBe(first.frame)
    // A different dataset object is a different grid, even with equal bytes.
    expect(toGridTileLayer(dataset())).not.toBe(first)
  })
})
