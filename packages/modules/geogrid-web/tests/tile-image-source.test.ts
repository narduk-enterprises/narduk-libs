import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { GridBBox, GridFrame, RampStop } from '../src/core/models.js'
import type { GridStyle } from '../src/render/types.js'
import { renderGridTile, type GridTileLayer } from '../src/tile/baker.js'
import { createGridTileImageSource, type GridTileRequest } from '../src/tile/image-source.js'
import {
  canvasHasContext,
  canvasPixels,
  canvasSize,
  installOffscreenCanvas,
} from './support/offscreen-canvas.js'

let uninstall: () => void
beforeAll(() => {
  uninstall = installOffscreenCanvas()
})
afterAll(() => {
  uninstall()
})

/**
 * narduk-mapkit's `MapKitTileOverlayImageSource`, restated rather than
 * imported.
 *
 * That is the architecture decision this lane implements: GeoGridWeb bakes
 * tiles, narduk-mapkit adapts a map host, and neither depends on the other —
 * they agree on a function shape. Restating the type here is what turns that
 * agreement into something the compiler checks, so a change to either side's
 * signature fails this repository's typecheck instead of a consumer's build.
 *
 * Copied verbatim from narduk-mapkit `src/client/runtime.ts`.
 */
type MapKitTileImageSource = HTMLImageElement | HTMLCanvasElement | ImageBitmap | OffscreenCanvas

type MapKitTileOverlayImageSource<TImageSource = MapKitTileImageSource> = (
  x: number,
  y: number,
  z: number,
  scale: number,
  data?: unknown,
) => Promise<TImageSource | null>

const GULF: GridBBox = [-92, 28, -88, 32]

const GRAY: RampStop[] = [
  { position: 0, rgba: [0, 0, 0, 255] },
  { position: 1, rgba: [255, 255, 255, 255] },
]

const STYLE: GridStyle = {
  rampStops: GRAY,
  valueRange: { lowerBound: 0, upperBound: 7 },
  scale: 'linear',
}

function frame(fill: (column: number, row: number) => number | null): GridFrame {
  const width = 8
  const height = 8
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
  return { key: 'probe', width, height, renderMode: 'scalar', valueKind: 'float32', values, mask }
}

function layer(fill: (column: number, row: number) => number | null = (c) => c): GridTileLayer {
  return { frame: frame(fill), bbox: GULF, bboxAnchor: 'cell-center' }
}

function opaqueCount(pixels: Uint8ClampedArray): number {
  let count = 0
  for (let index = 3; index < pixels.length; index += 4) if (pixels[index]! > 0) count += 1
  return count
}

describe('createGridTileImageSource argument contract', () => {
  /**
   * The one that fails silently. MapKit JS delivers `(x, y, z, scale)`, not the
   * `(x, y, scale, z)` its documentation implies — verified empirically against
   * the real API on 2026-07-08 and recorded at narduk-mapkit
   * `src/client/runtime.ts:29-34`. Reading them the other way round hands every
   * tile `z = 1`, which is nearly the whole earth, so the layer renders
   * *something* and nothing throws: the map simply shows the same near-global
   * smear at every zoom.
   */
  it('reads argument three as z and argument four as scale', async () => {
    const source = createGridTileImageSource({ source: layer(), style: STYLE, side: 32 })
    const canvas = await source(16, 26, 6, 2)
    expect(canvas).not.toBeNull()

    const expected = renderGridTile(layer(), STYLE, { z: 6, x: 16, y: 26, side: 64 })
    expect(canvasSize(canvas)).toEqual({ width: 64, height: 64 })
    expect(Array.from(canvasPixels(canvas))).toEqual(Array.from(canvasPixels(expected)))
  })

  it('would not survive the arguments being read the other way round', async () => {
    const source = createGridTileImageSource({ source: layer(), style: STYLE, side: 32 })
    const correct = await source(16, 26, 6, 2)
    // The transposed reading: z=2, scale=6. Different geography, different size.
    const transposed = renderGridTile(layer(), STYLE, { z: 2, x: 16, y: 26, side: 192 })
    expect(canvasSize(correct)).not.toEqual(canvasSize(transposed))
  })

  it('sizes the canvas as side * scale', async () => {
    const source = createGridTileImageSource({ source: layer(), style: STYLE, side: 256 })
    expect(canvasSize(await source(16, 26, 6, 1))).toEqual({ width: 256, height: 256 })
    expect(canvasSize(await source(16, 26, 6, 2))).toEqual({ width: 512, height: 512 })
    expect(canvasSize(await source(16, 26, 6, 3))).toEqual({ width: 768, height: 768 })
  })

  it('falls back to scale 1 for a missing or nonsensical scale', async () => {
    const source = createGridTileImageSource({ source: layer(), style: STYLE, side: 64 })
    expect(canvasSize(await source(16, 26, 6, Number.NaN))).toEqual({ width: 64, height: 64 })
    expect(canvasSize(await source(16, 26, 6, 0))).toEqual({ width: 64, height: 64 })
    expect(canvasSize(await source(16, 26, 6, -2))).toEqual({ width: 64, height: 64 })
  })

  it('hands the resolvers the tile it is about to bake', async () => {
    const seen: GridTileRequest[] = []
    const source = createGridTileImageSource({
      source: (request) => {
        seen.push(request)
        return layer()
      },
      style: () => STYLE,
      side: 128,
    })
    await source(16, 26, 6, 2, { layerId: 'kd490' })
    expect(seen).toHaveLength(1)
    expect(seen[0]).toEqual({
      z: 6,
      x: 16,
      y: 26,
      side: 256,
      scale: 2,
      data: { layerId: 'kd490' },
    })
  })

  it('omits data entirely when the host passes none', async () => {
    const seen: GridTileRequest[] = []
    const source = createGridTileImageSource({
      source: (request) => {
        seen.push(request)
        return layer()
      },
      style: STYLE,
    })
    await source(16, 26, 6, 1)
    expect('data' in seen[0]!).toBe(false)
  })
})

describe('null is reserved for "no grid for this tile"', () => {
  it('returns null only when the source resolves to null', async () => {
    const source = createGridTileImageSource({ source: () => null, style: STYLE, side: 32 })
    expect(await source(16, 26, 6, 1)).toBeNull()
  })

  /**
   * The failure this rule exists to prevent: a host reads the first non-null
   * image as the layer becoming ready. narduk-mapkit turns it into
   * `onFirstImage`, and `MapKitLayerRegistry` waits on that before crossfading,
   * giving up after 1500 ms. A grid covering one basin leaves most of the
   * world's tiles empty, so answering them with `null` would strand the layer
   * behind that timeout on every pan.
   */
  it('answers an all-nodata tile with a transparent canvas, not null', async () => {
    const source = createGridTileImageSource({
      source: layer(() => null),
      style: STYLE,
      side: 32,
    })
    const canvas = await source(16, 26, 6, 1)
    expect(canvas).not.toBeNull()
    expect(canvasSize(canvas)).toEqual({ width: 32, height: 32 })
    expect(opaqueCount(canvasPixels(canvas))).toBe(0)
  })

  it('answers a tile outside the grid with a transparent canvas, not null', async () => {
    const source = createGridTileImageSource({ source: layer(), style: STYLE, side: 32 })
    const canvas = await source(50, 26, 6, 1)
    expect(canvas).not.toBeNull()
    expect(opaqueCount(canvasPixels(canvas))).toBe(0)
  })

  it('culls a missing tile without changing what it would have drawn', async () => {
    const culled = createGridTileImageSource({ source: layer(), style: STYLE, side: 16 })
    const unculled = createGridTileImageSource({
      source: layer(),
      style: STYLE,
      side: 16,
      cullToBBox: false,
    })
    expect(Array.from(canvasPixels(await culled(50, 26, 6, 1)))).toEqual(
      Array.from(canvasPixels(await unculled(50, 26, 6, 1))),
    )
  })

  /**
   * Equal pixels are not the same canvas.
   *
   * A shortcut here once returned `new OffscreenCanvas(side, side)` for a culled
   * tile — transparent, correctly sized, and byte-identical to a drawn empty
   * tile through every pixel comparison above. It is still not interchangeable:
   * a canvas whose context mode is "none" throws `InvalidStateError` from
   * `transferToImageBitmap()`, so a host doing more than `drawImage` would fail
   * on exactly the tiles the culling optimization happened to catch. Which
   * canvas a tile gets must not depend on an optimization.
   */
  it('gives every empty tile the same shape of canvas as a drawn one', async () => {
    const source = createGridTileImageSource({ source: layer(), style: STYLE, side: 16 })
    const drawn = await source(16, 26, 6, 1)
    const nodata = await createGridTileImageSource({
      source: layer(() => null),
      style: STYLE,
      side: 16,
    })(16, 26, 6, 1)
    const culled = await source(50, 26, 6, 1)

    expect(canvasHasContext(drawn)).toBe(true)
    expect(canvasHasContext(nodata)).toBe(true)
    expect(canvasHasContext(culled)).toBe(true)
  })

  it('fails loudly rather than baking an absurdly large tile', async () => {
    const source = createGridTileImageSource({ source: layer(), style: STYLE, side: 256 })
    await expect(source(16, 26, 6, 1e5)).rejects.toThrow(RangeError)
    // The realistic factors stay well inside the cap.
    expect(canvasSize(await source(16, 26, 6, 3))).toEqual({ width: 768, height: 768 })
  })

  it('propagates a fetch failure rather than hiding it as an empty tile', async () => {
    const source = createGridTileImageSource({
      source: () => Promise.reject(new Error('grid fetch failed')),
      style: STYLE,
    })
    await expect(source(16, 26, 6, 1)).rejects.toThrow('grid fetch failed')
  })

  it('draws a tile that hits the grid', async () => {
    const source = createGridTileImageSource({ source: layer(), style: STYLE, side: 32 })
    const canvas = await source(16, 26, 6, 1)
    expect(opaqueCount(canvasPixels(canvas))).toBeGreaterThan(0)
  })
})

describe('structural fit with a tiled host', () => {
  /**
   * A compile-time assertion with a runtime body: the interesting failure is
   * `tsc`, which runs in the same gate.
   */
  it('is assignable to narduk-mapkit’s image-source type with no import', async () => {
    const imageForTile: MapKitTileOverlayImageSource<OffscreenCanvas> = createGridTileImageSource({
      source: layer(),
      style: STYLE,
      side: 16,
    })
    const widened: MapKitTileOverlayImageSource = imageForTile
    expect(await widened(16, 26, 6, 1)).not.toBeNull()
  })

  it('survives the host calling it exactly as its own wrapper does', async () => {
    // The body of createMapKitAsyncTileOverlay, reduced to what it does with
    // the source: call it, notice the first non-null image, forward errors.
    let firstImage = 0
    let errors = 0
    const imageForTile = createGridTileImageSource({ source: layer(), style: STYLE, side: 16 })
    const wrapped: MapKitTileOverlayImageSource<OffscreenCanvas> = (x, y, z, scale, data) =>
      imageForTile(x, y, z, scale, data)
        .then((image) => {
          if (image !== null) firstImage += 1
          return image
        })
        .catch(() => {
          errors += 1
          return null
        })

    expect(await wrapped(16, 26, 6, 1)).not.toBeNull()
    // An empty tile still counts as an image, which is the entire point.
    expect(await wrapped(50, 26, 6, 1)).not.toBeNull()
    expect(firstImage).toBe(2)
    expect(errors).toBe(0)
  })
})
