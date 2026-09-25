/**
 * The overlay's viewport projection over a Web-Mercator basemap (narduk-libs#930).
 *
 * Hosts report a region the way MapKit's `map.region` does: the centre is the
 * Mercator midpoint of the visible rect and `latitudeDelta` is `north - south`
 * in degrees. Screen rows are evenly spaced in Mercator y. These tests compute
 * that truth with their own arithmetic and hold the overlay to it.
 */
import { describe, expect, it } from 'vitest'

import {
  viewportDataProjection,
  viewportDataV,
  viewportLatitudeFrame,
  viewportLatitudeOffset,
  viewportScreenVForDataV,
} from '../src/core/math.js'
import type { GridViewport } from '../src/core/models.js'
import { referenceRenderScalarViewport } from '../src/core/reference-render.js'
import { viewportBBox } from '../src/core/stretch.js'
import { drawMercatorBands } from '../src/render/canvas2d.js'
import {
  rgbCompositionFragmentShader,
  rgbFragmentShader,
  scalarFragmentShader,
} from '../src/render/gl.js'

const toRadians = (degrees: number) => (degrees * Math.PI) / 180
const mercator = (latitude: number) => Math.asinh(Math.tan(toRadians(latitude)))
const latitudeAt = (y: number) => (Math.atan(Math.sinh(y)) * 180) / Math.PI

/** The region MapKit reports for a view whose top edge is `north` and bottom edge `south`. */
function mapKitRegion(north: number, south: number, west: number, east: number): GridViewport {
  return {
    center: {
      latitude: latitudeAt((mercator(north) + mercator(south)) / 2),
      longitude: (west + east) / 2,
    },
    span: { latitudeDelta: north - south, longitudeDelta: east - west },
  }
}

/** Latitude a Web-Mercator basemap draws at screen `v` (0 = top edge). */
function basemapLatitude(north: number, south: number, screenV: number): number {
  return latitudeAt(mercator(north) + screenV * (mercator(south) - mercator(north)))
}

const CONUS = mapKitRegion(50, 25, -100, -90)

describe('viewportLatitudeFrame', () => {
  it('recovers the edges of a MapKit region whose centre is the Mercator midpoint', () => {
    expect(CONUS.center.latitude).toBeCloseTo(38.575, 3)
    const frame = viewportLatitudeFrame(CONUS)
    expect(frame.north).toBeCloseTo(50, 9)
    expect(frame.south).toBeCloseTo(25, 9)
    expect(frame.centerLatitude).toBeCloseTo(CONUS.center.latitude, 9)
  })

  it('clamps a region that would run past the Mercator poles', () => {
    const frame = viewportLatitudeFrame({
      center: { latitude: 80, longitude: 0 },
      span: { latitudeDelta: 40, longitudeDelta: 360 },
    })
    expect(frame.north).toBeCloseTo(85.0511287798, 9)
    expect(frame.south).toBeCloseTo(45.0511287798, 9)
    expect(Number.isFinite(frame.mercatorYPerScreenV)).toBe(true)
  })
})

describe('viewportDataProjection', () => {
  const bbox = [-100, 20, -90, 55] as const

  it('samples the latitude the basemap draws on every row of a 900 px map', () => {
    const projection = viewportDataProjection(CONUS, [...bbox])
    for (let row = 0; row < 900; row += 1) {
      const screenV = (row + 0.5) / 900
      const truth = (bbox[3] - basemapLatitude(50, 25, screenV)) / (bbox[3] - bbox[1])
      expect(viewportDataV(projection, screenV)).toBeCloseTo(truth, 12)
    }
  })

  it('inverts cleanly', () => {
    const projection = viewportDataProjection(CONUS, [...bbox])
    for (const screenV of [0, 0.1, 0.5, 0.77, 1]) {
      expect(viewportScreenVForDataV(projection, viewportDataV(projection, screenV))).toBeCloseTo(
        screenV,
        10,
      )
    }
  })

  it('keeps sub-pixel registration in float32, as the shader evaluates it, at deep zoom', () => {
    // ~z20 at 45°N: a 1000-row map spans about 0.00095° of latitude.
    const region = mapKitRegion(45.0005, 44.99955, -93.0006, -92.9994)
    const frame = viewportLatitudeFrame(region)
    const f = Math.fround
    const a = f(frame.centerHalfTanh)
    const slope = f(frame.mercatorYPerScreenV)
    const degreesPerPixel = (frame.north - frame.south) / 1000
    for (let row = 0; row < 1000; row += 37) {
      const screenV = f((row + 0.5) / 1000)
      const b = f(Math.tanh(f(f(f(screenV - 0.5) * slope) * 0.5)))
      const numerator = f(b * f(1 - f(a * a)))
      const denominator = f(f(1 + f(a * a)) + f(f(2 * a) * b))
      const shaderOffset = f(f(2 * f(Math.atan2(numerator, denominator))) * f(180 / Math.PI))
      const truth = viewportLatitudeOffset(frame, screenV)
      expect(Math.abs(shaderOffset - truth) / degreesPerPixel).toBeLessThan(0.05)
    }
  })
})

describe('the overlay over a Web-Mercator basemap (#930)', () => {
  it('paints a one-degree band on the rows the basemap draws that band on', () => {
    // A single cell covering 44–45°N, drawn over a CONUS view 900 px tall.
    const height = 900
    const raster = referenceRenderScalarViewport(
      { values: [50], mask: [1], width: 1, height: 1, valueKind: 'float32' },
      {
        stops: [
          { position: 0, rgba: [255, 0, 0, 255] },
          { position: 1, rgba: [255, 0, 0, 255] },
        ],
        valueRange: [0, 100],
        scale: 'linear',
      },
      { viewport: CONUS, bbox: [-100, 44, -90, 45], width: 1, height, anchor: 'cell-edge' },
    )
    const painted: number[] = []
    const expected: number[] = []
    for (let row = 0; row < height; row += 1) {
      if (raster.pixels[row * 4 + 3]! > 0) painted.push(row)
      const latitude = basemapLatitude(50, 25, (row + 0.5) / height)
      if (latitude >= 44 && latitude <= 45) expected.push(row)
    }
    // Linear-in-latitude placement put this band ~40 rows too low.
    expect(painted).toEqual(expected)
  })
})

describe('viewportBBox', () => {
  it('reports the edges the basemap shows, not centre ± delta / 2', () => {
    const [west, south, east, north] = viewportBBox(CONUS)
    expect(west).toBeCloseTo(-100, 9)
    expect(east).toBeCloseTo(-90, 9)
    expect(south).toBeCloseTo(25, 9)
    expect(north).toBeCloseTo(50, 9)
  })
})

describe('the WebGL2 shaders', () => {
  const viewportShaders = {
    'scalar encoded-u16': scalarFragmentShader('encoded-u16'),
    'scalar float32': scalarFragmentShader('float32'),
    rgb: rgbFragmentShader(),
    'rgb composition': rgbCompositionFragmentShader(),
  }

  for (const [name, source] of Object.entries(viewportShaders)) {
    it(`${name}: maps screen rows through Mercator, data and stencil alike`, () => {
      // No affine latitude transform survives anywhere in the overlay's shaders.
      expect(source).not.toMatch(/uvOffset|uvScale|stencilUvOffset|stencilUvScale/)
      expect(source).toContain('viewportLatitudeOffset(screenUv.y, viewportMerc)')
      expect(source).toContain('viewportLatitudeOffset(screenUv.y, stencilMerc)')
      expect(source).toMatch(/vec2 uv = dataUv\(vUv\);/)
    })
  }

  it('rgb composition takes its overview area through the same projection', () => {
    const source = rgbCompositionFragmentShader()
    expect(source).toContain('vec2 areaUv0 = dataUv(screenUv0);')
    expect(source).toContain('vec2 areaUv1 = dataUv(screenUv1);')
  })

  it('leaves the tile projection alone', () => {
    const source = scalarFragmentShader('encoded-u16', 'mercator')
    expect(source).toContain('tileMercArg')
    expect(source).not.toContain('viewportMerc;')
  })
})

describe('drawMercatorBands (Canvas2D blit and stencil)', () => {
  interface Call {
    sy: number
    sh: number
    dx: number
    dy: number
    dw: number
    dh: number
  }

  function record(
    image: { width: number; height: number },
    bbox: [number, number, number, number],
  ) {
    const calls: Call[] = []
    const context = {
      drawImage: (
        _image: unknown,
        _sx: number,
        sy: number,
        _sw: number,
        sh: number,
        dx: number,
        dy: number,
        dw: number,
        dh: number,
      ) => calls.push({ sy, sh, dx, dy, dw, dh }),
    } as unknown as CanvasRenderingContext2D
    drawMercatorBands(
      context,
      image as HTMLCanvasElement,
      viewportDataProjection(CONUS, bbox),
      100,
      900,
    )
    return calls
  }

  it('lays seamless bands whose edges sit on the basemap rows of their latitudes', () => {
    const bbox: [number, number, number, number] = [-100, 30, -95, 45]
    const image = { width: 50, height: 150 }
    const calls = record(image, bbox)
    expect(calls.length).toBeGreaterThan(10)
    // Where the basemap draws the bbox's north and south edges.
    const rowOf = (latitude: number) =>
      ((mercator(50) - mercator(latitude)) / (mercator(50) - mercator(25))) * 900
    expect(calls[0]!.dy).toBeCloseTo(rowOf(45), 9)
    const last = calls.at(-1)!
    expect(last.dy + last.dh).toBeCloseTo(rowOf(30), 9)
    for (let index = 0; index < calls.length; index += 1) {
      const call = calls[index]!
      // Horizontal placement is the plain affine one.
      expect(call.dx).toBeCloseTo(0, 9)
      expect(call.dw).toBeCloseTo(50, 9)
      if (index > 0) {
        const previous = calls[index - 1]!
        expect(call.dy).toBe(previous.dy + previous.dh)
        expect(call.sy).toBeCloseTo(previous.sy + previous.sh, 9)
        expect(Number.isInteger(call.dy)).toBe(true)
      }
      // Each band edge's source row is the latitude the basemap draws there.
      for (const [dy, sy] of [
        [call.dy, call.sy],
        [call.dy + call.dh, call.sy + call.sh],
      ] as const) {
        const latitude = basemapLatitude(50, 25, dy / 900)
        expect(sy).toBeCloseTo(((45 - latitude) / 15) * image.height, 9)
      }
      // Inside a band, the linear stretch stays well under a pixel off the curve.
      const middle = call.dy + call.dh / 2
      const linear = call.sy + call.sh / 2
      const truth = ((45 - basemapLatitude(50, 25, middle / 900)) / 15) * image.height
      const rowsPerSource = 900 / ((25 / 15) * image.height)
      expect(Math.abs(linear - truth) * rowsPerSource).toBeLessThan(0.05)
    }
  })

  it('draws nothing for a bbox wholly off screen', () => {
    expect(record({ width: 10, height: 10 }, [-100, 60, -90, 70])).toEqual([])
  })
})
