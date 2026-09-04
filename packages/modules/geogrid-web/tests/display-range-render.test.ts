import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { displayValueFromEncoded } from '../src/core/math.js'
import { normalizeValue } from '../src/color/normalize.js'
import { rampLut } from '../src/color/ramp.js'
import {
  referenceRenderScalarViewport,
  referenceScalarPixel,
  referenceLut,
  sampleLutLinear,
  type ReferenceScalarLayer,
  type ReferenceScalarStyle,
} from '../src/core/reference-render.js'
import type {
  GridBBox,
  GridFrame,
  GridValueRange,
  GridViewport,
  RampStop,
} from '../src/core/models.js'

/**
 * `displayRange` is a render stretch. `valueRange` is a decode domain.
 *
 * This file exists because the tempting shortcut — "just narrow `valueRange` to
 * stretch the picture" — is not a worse way to do the same thing, it is a
 * different thing that silently corrupts the data. On an `encoded-u16` frame
 * every sample is a `0…65535` count that only means something against the range
 * it was quantized over, so narrowing that range does not re-spread the ramp,
 * it *re-decodes every cell to a number the publisher never wrote*. The
 * numbers below are what that looks like.
 */

/** Black at position 0, white at position 1: the color is the position. */
const GREYSCALE: readonly RampStop[] = [
  { position: 0, rgba: [0, 0, 0, 255] },
  { position: 1, rgba: [255, 255, 255, 255] },
]

const WIRE_RANGE: GridValueRange = { lowerBound: 0, upperBound: 100 }
/** Half of `0…65535`, so the decoded value sits at the middle of the wire domain. */
const MID_ENCODED = 32_768

function uniformLayer(value: number, kind: 'encoded-u16' | 'float32'): ReferenceScalarLayer {
  return {
    values:
      kind === 'float32'
        ? Float32Array.from([value, value, value, value])
        : Uint16Array.from([value, value, value, value]),
    mask: Uint8Array.from([1, 1, 1, 1]),
    width: 2,
    height: 2,
    valueKind: kind,
  }
}

function pixel(layer: ReferenceScalarLayer, style: ReferenceScalarStyle): number {
  const rgba = referenceScalarPixel(layer, referenceLut(style), style, 0.5, 0.5)
  expect(rgba[3]).toBeGreaterThan(0)
  // Greyscale ramp, so all three channels agree and the red channel is the
  // normalized position in 0…255.
  expect(rgba[1]).toBe(rgba[0])
  expect(rgba[2]).toBe(rgba[0])
  return rgba[0]
}

describe('displayRange defaults to valueRange', () => {
  it('renders identically whether omitted or set to the same numbers', () => {
    for (const kind of ['encoded-u16', 'float32'] as const) {
      const layer = uniformLayer(kind === 'float32' ? 37 : MID_ENCODED, kind)
      const base: ReferenceScalarStyle = {
        stops: GREYSCALE,
        valueRange: WIRE_RANGE,
        scale: 'linear',
      }
      expect(pixel(layer, { ...base, displayRange: WIRE_RANGE })).toBe(pixel(layer, base))
    }
  })
})

describe('the wire domain is not a stretch knob', () => {
  /**
   * The failure mode, in one assertion.
   *
   * Both styles ask for "the top half of the layer". Narrowing `displayRange`
   * gets it. Narrowing `valueRange` instead halves the decoded value of every
   * cell first and then normalizes the wrong number over the narrowed range,
   * landing back in the middle of the ramp — a picture that looks reasonable
   * and is reporting values nobody measured.
   */
  it('narrowing valueRange re-decodes the frame; narrowing displayRange does not', () => {
    const layer = uniformLayer(MID_ENCODED, 'encoded-u16')
    const stretched = pixel(layer, {
      stops: GREYSCALE,
      valueRange: WIRE_RANGE,
      displayRange: { lowerBound: 0, upperBound: 50 },
      scale: 'linear',
    })
    const misdecoded = pixel(layer, {
      stops: GREYSCALE,
      valueRange: { lowerBound: 0, upperBound: 50 },
      scale: 'linear',
    })

    // The decode itself, stated rather than inferred: the same wire count reads
    // as ~50 against the real domain and ~25 against the narrowed one.
    expect(displayValueFromEncoded(MID_ENCODED, WIRE_RANGE, 'linear')).toBeCloseTo(50, 2)
    expect(
      displayValueFromEncoded(MID_ENCODED, { lowerBound: 0, upperBound: 50 }, 'linear'),
    ).toBeCloseTo(25, 2)

    // …so the stretch saturates the ramp while the mis-decode sits at its middle.
    expect(normalizeValue(50, { lowerBound: 0, upperBound: 50 }, 'linear')).toBe(1)
    expect(normalizeValue(25, { lowerBound: 0, upperBound: 50 }, 'linear')).toBe(0.5)
    expect(stretched).toBe(255)
    expect(misdecoded).toBeLessThan(140)
    expect(misdecoded).toBeGreaterThan(115)
  })

  it('leaves a float32 frame alone, where valueRange decodes nothing', () => {
    const layer = uniformLayer(25, 'float32')
    // A float32 sample is display units already, so `valueRange` only has to be
    // drawable — the color comes entirely from `displayRange`.
    const wide = pixel(layer, {
      stops: GREYSCALE,
      valueRange: WIRE_RANGE,
      displayRange: WIRE_RANGE,
      scale: 'linear',
    })
    const narrow = pixel(layer, {
      stops: GREYSCALE,
      valueRange: WIRE_RANGE,
      displayRange: { lowerBound: 20, upperBound: 30 },
      scale: 'linear',
    })
    expect(wide).toBeLessThan(80)
    expect(narrow).toBeGreaterThan(120)
    expect(narrow).toBeLessThan(140)
  })

  it('stretches a log layer in log space', () => {
    const layer = uniformLayer(0.1, 'float32')
    const range: GridValueRange = { lowerBound: 0.01, upperBound: 1 }
    // 0.1 is the geometric midpoint of 0.01…1, so an unstretched log layer puts
    // it at the middle of the ramp.
    expect(pixel(layer, { stops: GREYSCALE, valueRange: range, scale: 'log' })).toBeGreaterThan(120)
    // Stretched to 0.1…1 it is the floor.
    expect(
      pixel(layer, {
        stops: GREYSCALE,
        valueRange: range,
        displayRange: { lowerBound: 0.1, upperBound: 1 },
        scale: 'log',
      }),
    ).toBe(0)
  })

  it('draws nothing for a degenerate displayRange, even with a sound valueRange', () => {
    const layer = uniformLayer(25, 'float32')
    const style: ReferenceScalarStyle = {
      stops: GREYSCALE,
      valueRange: WIRE_RANGE,
      displayRange: { lowerBound: 40, upperBound: 40 },
      scale: 'linear',
    }
    expect(referenceScalarPixel(layer, referenceLut(style), style, 0.5, 0.5)).toEqual([0, 0, 0, 0])

    const inverted: ReferenceScalarStyle = { ...style, displayRange: [50, 10] }
    expect(referenceScalarPixel(layer, referenceLut(inverted), inverted, 0.5, 0.5)).toEqual([
      0, 0, 0, 0,
    ])
  })
})

// ---------------------------------------------------------------------------
// The Canvas2D backend honors it too
// ---------------------------------------------------------------------------

const CANVAS_WIDTH = 64
const CANVAS_HEIGHT = 48
const GRID_WIDTH = 8
const GRID_HEIGHT = 6
const BBOX: GridBBox = [-95, 27, -88, 30]
const VIEWPORT: GridViewport = {
  center: { latitude: 28.5, longitude: -91.5 },
  span: { latitudeDelta: 3.2, longitudeDelta: 7.4 },
}

const captured: { image: { data: Uint8ClampedArray } | null } = { image: null }
const originals: Record<string, unknown> = {}

/**
 * Read the capture through a declared return type.
 *
 * Assigning `captured.image = null` narrows the field to `null` for the rest of
 * the block, and the write that matters happens inside the shim's
 * `putImageData` — invisible to control-flow analysis, which would otherwise
 * conclude the value can only ever be `null`.
 */
function takeCapture(): { data: Uint8ClampedArray } {
  const image = captured.image
  if (!image) throw new Error('nothing was rasterized')
  return image
}

class ShimImageData {
  readonly width: number
  readonly height: number
  readonly data: Uint8ClampedArray
  constructor(width: number, height: number) {
    this.width = width
    this.height = height
    this.data = new Uint8ClampedArray(width * height * 4)
  }
}

function shimCanvas(): Record<string, unknown> {
  return {
    className: '',
    style: {} as Record<string, string>,
    width: 0,
    height: 0,
    parentElement: null,
    setAttribute: () => {},
    remove: () => {},
    getBoundingClientRect: () => ({ width: CANVAS_WIDTH, height: CANVAS_HEIGHT }),
    getContext: () => ({
      setTransform: () => {},
      clearRect: () => {},
      drawImage: () => {},
      save: () => {},
      restore: () => {},
      putImageData: (image: { data: Uint8ClampedArray }) => {
        captured.image = image
      },
      filter: 'none',
      globalCompositeOperation: 'source-over',
    }),
  }
}

beforeAll(() => {
  for (const key of ['ImageData', 'window', 'document']) {
    originals[key] = (globalThis as Record<string, unknown>)[key]
  }
  Object.assign(globalThis, {
    ImageData: ShimImageData,
    window: { devicePixelRatio: 1 },
    document: { createElement: () => shimCanvas() },
  })
})

afterAll(() => {
  for (const [key, value] of Object.entries(originals)) {
    if (value === undefined) delete (globalThis as Record<string, unknown>)[key]
    else (globalThis as Record<string, unknown>)[key] = value
  }
})

function rampGrid(): { values: Float32Array; mask: Uint8Array } {
  const values = new Float32Array(GRID_WIDTH * GRID_HEIGHT)
  const mask = new Uint8Array(GRID_WIDTH * GRID_HEIGHT).fill(1)
  for (let i = 0; i < values.length; i += 1) {
    values[i] = (i / (values.length - 1)) * 100
  }
  return { values, mask }
}

async function renderThroughCanvas2D(
  displayRange: GridValueRange | undefined,
): Promise<Uint8ClampedArray> {
  const { Canvas2DGridBackend } = await import('../src/render/canvas2d.js')
  const { values, mask } = rampGrid()
  const backend = Canvas2DGridBackend.create({
    mode: 'scalar',
    style: {
      rampStops: GREYSCALE,
      valueRange: WIRE_RANGE,
      scale: 'linear',
      ...(displayRange !== undefined ? { displayRange } : {}),
    },
  })
  const element = backend.element() as unknown as { parentElement: unknown }
  element.parentElement = {
    getBoundingClientRect: () => ({ width: CANVAS_WIDTH, height: CANVAS_HEIGHT }),
  }
  backend.setViewport(VIEWPORT)
  const frame: GridFrame = {
    key: 'display-range',
    width: GRID_WIDTH,
    height: GRID_HEIGHT,
    renderMode: 'scalar',
    valueKind: 'float32',
    values,
    mask,
  }
  captured.image = null
  backend.render({ lower: frame, upper: frame, progress: 0, bbox: BBOX })
  return takeCapture().data
}

function renderThroughReference(displayRange: GridValueRange | undefined): Uint8ClampedArray {
  const { values, mask } = rampGrid()
  return referenceRenderScalarViewport(
    { values, mask, width: GRID_WIDTH, height: GRID_HEIGHT, valueKind: 'float32' },
    {
      stops: GREYSCALE,
      valueRange: WIRE_RANGE,
      scale: 'linear',
      ...(displayRange !== undefined ? { displayRange } : {}),
    },
    { viewport: VIEWPORT, bbox: BBOX, width: CANVAS_WIDTH, height: CANVAS_HEIGHT },
  ).pixels
}

// ---------------------------------------------------------------------------
// End to end through the overlay
// ---------------------------------------------------------------------------

/** `gridBounds`, inlined so the expectation is not the code under test. */
function datasetBounds(lon0: number, lat0: number, dx: number, dy: number): GridBBox {
  const lastLon = lon0 + (GRID_WIDTH - 1) * dx
  const lastLat = lat0 + (GRID_HEIGHT - 1) * dy
  return [
    Math.min(lon0, lastLon),
    Math.min(lat0, lastLat),
    Math.max(lon0, lastLon),
    Math.max(lat0, lastLat),
  ]
}

const DATASET_DX = 1
const DATASET_DY = -0.6
const DATASET_LON0 = -95
const DATASET_LAT0 = 30
const DATASET_BBOX = datasetBounds(DATASET_LON0, DATASET_LAT0, DATASET_DX, DATASET_DY)

function rampDataset(): import('../src/core/decode/grid.js').GridScalarDataset {
  const { values, mask } = rampGrid()
  return {
    header: {
      layer: 'test',
      variables: ['value'],
      planeCount: 1,
      bbox: null,
      width: GRID_WIDTH,
      height: GRID_HEIGHT,
      lon0: DATASET_LON0,
      lat0: DATASET_LAT0,
      dx: DATASET_DX,
      dy: DATASET_DY,
      units: '1',
      scale: 'linear',
      valueRange: WIRE_RANGE,
      renderMode: 'scalar',
      validTime: null,
      missing: 'NaN',
      releaseId: null,
      generationId: null,
      provenanceCounts: null,
      extra: {},
    },
    planes: [values],
    masks: [mask],
    stride: null,
  }
}

describe('GridOverlay drives the stretch end to end', () => {
  /**
   * The whole chain in one assertion: a decoded dataset goes in, a percentile
   * stretch is computed from its own cells, the resulting `displayRange` reaches
   * the backend's style, and the pixels that come out are the ones the reference
   * renderer produces for that range. Every link in that chain is somewhere a
   * range could silently fail to arrive.
   */
  it('computes a range from the frame and renders through it', async () => {
    const { createGridOverlay } = await import('../src/overlay/grid-overlay.js')
    const { defaultViewportPercentileStretch } = await import('../src/core/stretch.js')

    const overlay = createGridOverlay({
      prefer: 'canvas2d',
      style: { rampStops: GREYSCALE, valueRange: WIRE_RANGE, scale: 'linear' },
      stretch: defaultViewportPercentileStretch(),
    })
    const element = overlay.element() as unknown as { parentElement: unknown }
    element.parentElement = {
      getBoundingClientRect: () => ({ width: CANVAS_WIDTH, height: CANVAS_HEIGHT }),
    }

    const seen: Array<{ range: GridValueRange; fallback: boolean; reason: string }> = []
    overlay.onDisplayRangeChange((range, meta) =>
      seen.push({ range, fallback: meta.fallback, reason: meta.reason }),
    )
    expect(overlay.currentDisplayRange()).toBeNull()

    overlay.setViewport(VIEWPORT)
    captured.image = null
    overlay.setScalarFrame(rampDataset())

    // 48 cells ramped 0…100: p2 = 2, p98 = 98 under Hyndman-Fan type 7.
    // Four places, not nine: the plane is a `Float32Array`, so every sampled
    // value carries ~1.2e-7 of relative storage error — about 1.2e-5 absolute up
    // at 98 — before the percentile ever sees it. The exact-arithmetic vectors
    // live in `stretch-parity.test.ts`, on integer-valued grids.
    const range = overlay.currentDisplayRange()
    expect(range!.lowerBound).toBeCloseTo(2, 4)
    expect(range!.upperBound).toBeCloseTo(98, 4)
    expect(seen).toHaveLength(1)
    expect(seen[0]!.fallback).toBe(false)
    expect(seen[0]!.reason).toBe('source')

    // The wire domain is untouched — the stretch is additive, not a rewrite.
    const { values, mask } = rampGrid()
    const expected = referenceRenderScalarViewport(
      { values, mask, width: GRID_WIDTH, height: GRID_HEIGHT, valueKind: 'float32' },
      { stops: GREYSCALE, valueRange: WIRE_RANGE, scale: 'linear', displayRange: range! },
      {
        viewport: VIEWPORT,
        bbox: DATASET_BBOX,
        width: CANVAS_WIDTH,
        height: CANVAS_HEIGHT,
      },
    ).pixels

    const painted = takeCapture()
    let differing = 0
    for (let i = 0; i < expected.length; i += 1) {
      if (painted.data[i] !== expected[i]) differing += 1
    }
    expect(differing).toBe(0)

    // …and it is genuinely a stretch: the unstretched raster differs.
    const unstretched = referenceRenderScalarViewport(
      { values, mask, width: GRID_WIDTH, height: GRID_HEIGHT, valueKind: 'float32' },
      { stops: GREYSCALE, valueRange: WIRE_RANGE, scale: 'linear' },
      { viewport: VIEWPORT, bbox: DATASET_BBOX, width: CANVAS_WIDTH, height: CANVAS_HEIGHT },
    ).pixels
    let stretchDelta = 0
    for (let i = 0; i < expected.length; i += 1) {
      if (unstretched[i] !== expected[i]) stretchDelta += 1
    }
    expect(stretchDelta).toBeGreaterThan(0)

    overlay.destroy()
  })

  it('holds the range still through playback and applies the request on pause', async () => {
    const { createGridOverlay } = await import('../src/overlay/grid-overlay.js')

    const overlay = createGridOverlay({
      prefer: 'canvas2d',
      style: { rampStops: GREYSCALE, valueRange: WIRE_RANGE, scale: 'linear' },
      stretch: { mode: 'viewport-minmax', pad: 0 },
    })
    overlay.setViewport(VIEWPORT)
    overlay.setScalarFrame(rampDataset())
    const before = overlay.currentDisplayRange()
    expect(before).toEqual({ lowerBound: 0, upperBound: 100 })

    overlay.setPlaying(true)
    overlay.setStretch({ mode: 'manual', range: { lowerBound: 10, upperBound: 20 } })
    expect(overlay.currentDisplayRange()).toEqual(before)

    overlay.setPlaying(false)
    expect(overlay.currentDisplayRange()).toEqual({ lowerBound: 10, upperBound: 20 })
    expect(overlay.currentStretch()).toEqual({
      mode: 'manual',
      range: { lowerBound: 10, upperBound: 20 },
    })

    overlay.destroy()
  })

  it('leaves displayRange unset under the default fixed stretch', async () => {
    const { createGridOverlay } = await import('../src/overlay/grid-overlay.js')
    const overlay = createGridOverlay({
      prefer: 'canvas2d',
      style: { rampStops: GREYSCALE, valueRange: WIRE_RANGE, scale: 'linear' },
    })
    overlay.setViewport(VIEWPORT)
    overlay.setScalarFrame(rampDataset())
    expect(overlay.currentStretch()).toEqual({ mode: 'fixed' })
    expect(overlay.currentDisplayRange()).toBeNull()
    overlay.destroy()
  })

  /**
   * A hand-set `displayRange` must not leave the controller behind.
   *
   * Writing the style field directly made `currentDisplayRange()` answer `null`
   * while the picture showed the hand-set range — and left the controller's
   * hysteresis measuring against a range it had never computed, which can wedge
   * a running stretch so it never applies again. Routing the hand-set value
   * through the controller as the `manual` stretch it amounts to makes one
   * writer responsible for both the field and the answer.
   */
  it('reports a hand-set displayRange as the manual stretch it is', async () => {
    const { createGridOverlay } = await import('../src/overlay/grid-overlay.js')
    const overlay = createGridOverlay({
      prefer: 'canvas2d',
      style: {
        rampStops: GREYSCALE,
        valueRange: WIRE_RANGE,
        scale: 'linear',
        displayRange: [25, 75],
      },
    })
    // Set through the constructor, and visible before any frame arrives.
    expect(overlay.currentDisplayRange()).toEqual({ lowerBound: 25, upperBound: 75 })
    expect(overlay.currentStretch()).toEqual({
      mode: 'manual',
      range: { lowerBound: 25, upperBound: 75 },
    })

    const seen: GridValueRange[] = []
    overlay.onDisplayRangeChange((range) => seen.push(range))

    overlay.setStyle({ displayRange: [10, 20] })
    expect(overlay.currentDisplayRange()).toEqual({ lowerBound: 10, upperBound: 20 })
    expect(seen).toEqual([{ lowerBound: 10, upperBound: 20 }])

    // Clearing goes back to the wire domain, and says so.
    overlay.setStyle({ displayRange: null })
    expect(overlay.currentDisplayRange()).toBeNull()
    expect(overlay.currentStretch()).toEqual({ mode: 'fixed' })
    expect(seen).toHaveLength(2)
    expect(seen[1]).toEqual(WIRE_RANGE)

    // An unrelated setStyle leaves the stretch alone rather than clearing it.
    overlay.setStyle({ displayRange: [30, 40] })
    overlay.setStyle({ opacity: 0.5 })
    expect(overlay.currentDisplayRange()).toEqual({ lowerBound: 30, upperBound: 40 })

    overlay.destroy()
  })

  /**
   * A relocated plane is sampled where it is drawn.
   *
   * `setScalarFrame`'s `bbox` option overrides where the renderer puts these
   * cells. The stretch used to keep reading the header's own `lon0`/`dx`, so it
   * answered a plausible range computed from cells nobody was looking at, with
   * an error that grows without bound as the override moves away.
   */
  it('stretches through setScalarFrame\'s bbox override, not the header', async () => {
    const { createGridOverlay } = await import('../src/overlay/grid-overlay.js')

    // The viewport covers the western half of the *overridden* extent.
    const western: GridViewport = {
      center: { latitude: 28.5, longitude: -93.25 },
      span: { latitudeDelta: 3.2, longitudeDelta: 3.5 },
    }
    const build = async (bbox?: GridBBox) => {
      const overlay = createGridOverlay({
        prefer: 'canvas2d',
        style: { rampStops: GREYSCALE, valueRange: WIRE_RANGE, scale: 'linear' },
        stretch: { mode: 'viewport-minmax', pad: 0 },
      })
      overlay.setViewport(western)
      overlay.setScalarFrame(rampDataset(), 0, bbox !== undefined ? { bbox } : {})
      const range = overlay.currentDisplayRange()
      overlay.destroy()
      return range
    }

    // Default placement: the viewport covers the plane's western columns, which
    // hold the low end of a row-major ramp.
    const asPublished = await build()
    expect(asPublished!.upperBound).toBeLessThan(WIRE_RANGE.upperBound)

    // Shift the plane half its width west. The same viewport now covers its
    // *eastern* columns instead, so the range must move to the high end — which
    // it can only do if the sampler followed the override.
    const half = (DATASET_BBOX[2] - DATASET_BBOX[0]) / 2
    const shifted: GridBBox = [
      DATASET_BBOX[0] - half,
      DATASET_BBOX[1],
      DATASET_BBOX[2] - half,
      DATASET_BBOX[3],
    ]
    const relocated = await build(shifted)
    expect(relocated).not.toBeNull()
    expect(relocated!.upperBound).toBeGreaterThan(asPublished!.upperBound)
    expect(relocated!.lowerBound).toBeGreaterThan(asPublished!.lowerBound)
  })

  it('accepts a hand-set displayRange through setStyle, and clears it with null', async () => {
    const { createGridOverlay } = await import('../src/overlay/grid-overlay.js')
    const overlay = createGridOverlay({
      prefer: 'canvas2d',
      style: {
        rampStops: GREYSCALE,
        valueRange: WIRE_RANGE,
        scale: 'linear',
        displayRange: [25, 75],
      },
    })
    const element = overlay.element() as unknown as { parentElement: unknown }
    element.parentElement = {
      getBoundingClientRect: () => ({ width: CANVAS_WIDTH, height: CANVAS_HEIGHT }),
    }
    overlay.setViewport(VIEWPORT)
    captured.image = null
    overlay.setScalarFrame(rampDataset())

    const { values, mask } = rampGrid()
    const expected = referenceRenderScalarViewport(
      { values, mask, width: GRID_WIDTH, height: GRID_HEIGHT, valueKind: 'float32' },
      {
        stops: GREYSCALE,
        valueRange: WIRE_RANGE,
        scale: 'linear',
        displayRange: { lowerBound: 25, upperBound: 75 },
      },
      { viewport: VIEWPORT, bbox: DATASET_BBOX, width: CANVAS_WIDTH, height: CANVAS_HEIGHT },
    ).pixels
    const stretchedPixels = takeCapture().data
    let differing = 0
    for (let i = 0; i < expected.length; i += 1) {
      if (stretchedPixels[i] !== expected[i]) differing += 1
    }
    expect(differing).toBe(0)

    // `null` clears; `undefined` would have carried the current one forward.
    captured.image = null
    overlay.setStyle({ displayRange: null })
    const cleared = referenceRenderScalarViewport(
      { values, mask, width: GRID_WIDTH, height: GRID_HEIGHT, valueKind: 'float32' },
      { stops: GREYSCALE, valueRange: WIRE_RANGE, scale: 'linear' },
      { viewport: VIEWPORT, bbox: DATASET_BBOX, width: CANVAS_WIDTH, height: CANVAS_HEIGHT },
    ).pixels
    const clearedPixels = takeCapture().data
    let clearedDiffering = 0
    for (let i = 0; i < cleared.length; i += 1) {
      if (clearedPixels[i] !== cleared[i]) clearedDiffering += 1
    }
    expect(clearedDiffering).toBe(0)

    overlay.destroy()
  })
})

describe('Canvas2D honors displayRange', () => {
  const STRETCH: GridValueRange = { lowerBound: 40, upperBound: 60 }

  it('stays byte-identical to the reference renderer under a stretch', async () => {
    const actual = await renderThroughCanvas2D(STRETCH)
    const expected = renderThroughReference(STRETCH)

    // Guard against a vacuous pass.
    let painted = 0
    for (let i = 3; i < expected.length; i += 4) if (expected[i]! > 0) painted += 1
    expect(painted).toBeGreaterThan(CANVAS_WIDTH * CANVAS_HEIGHT * 0.3)

    let differing = 0
    for (let i = 0; i < expected.length; i += 1) if (actual[i] !== expected[i]) differing += 1
    expect(differing).toBe(0)
  })

  /**
   * Cache invalidation, asserted on **one** backend instance.
   *
   * The version of this test that shipped in the first draft rendered through
   * two freshly-created backends and compared them, which proves only that two
   * different styles produce two different pictures — nothing about caching at
   * all, since a new instance has no cache to invalidate. What actually has to
   * hold is that a *live* backend, already holding a raster, repaints when
   * `setStyle` changes only the stretch.
   */
  it('repaints a live backend when only the stretch changed', async () => {
    const { Canvas2DGridBackend } = await import('../src/render/canvas2d.js')
    const { values, mask } = rampGrid()
    const style = { rampStops: GREYSCALE, valueRange: WIRE_RANGE, scale: 'linear' as const }
    const backend = Canvas2DGridBackend.create({ mode: 'scalar', style })
    const element = backend.element() as unknown as { parentElement: unknown }
    element.parentElement = {
      getBoundingClientRect: () => ({ width: CANVAS_WIDTH, height: CANVAS_HEIGHT }),
    }
    backend.setViewport(VIEWPORT)
    const frame: GridFrame = {
      key: 'cache',
      width: GRID_WIDTH,
      height: GRID_HEIGHT,
      renderMode: 'scalar',
      valueKind: 'float32',
      values,
      mask,
    }

    captured.image = null
    backend.render({ lower: frame, upper: frame, progress: 0, bbox: BBOX })
    const first = Uint8ClampedArray.from(takeCapture().data)

    // Same frame, same viewport, same everything except the stretch.
    captured.image = null
    backend.setStyle({ ...style, displayRange: STRETCH })
    backend.render({ lower: frame, upper: frame, progress: 0, bbox: BBOX })
    const second = takeCapture().data

    let differing = 0
    for (let i = 0; i < first.length; i += 1) if (first[i] !== second[i]) differing += 1
    expect(differing).toBeGreaterThan(0)
    // And it is the stretched picture, not merely a different one.
    const expected = renderThroughReference(STRETCH)
    let wrong = 0
    for (let i = 0; i < expected.length; i += 1) if (second[i] !== expected[i]) wrong += 1
    expect(wrong).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// The minified raster path — the common Gulf-wide view
// ---------------------------------------------------------------------------

/**
 * Below {@link SCREEN_SPACE_PIXELS_PER_CELL} the Canvas2D backend does not run
 * the reference kernel at all: it colors one pixel per *cell* in `rasterize` and
 * lets `drawImage` scale the result. That is a second, independent colorizer —
 * `writeColor` — and it is the branch a whole-Gulf view actually takes, where a
 * 900-cell-wide grid lands in a few hundred screen pixels.
 *
 * It had no coverage. The reviewer proved it by deleting the display-range
 * handling from `writeColor` outright and watching every test still pass.
 */
const MINIFIED_GRID_WIDTH = 240
const MINIFIED_GRID_HEIGHT = 180

function minifiedGrid(): { values: Float32Array; mask: Uint8Array } {
  const count = MINIFIED_GRID_WIDTH * MINIFIED_GRID_HEIGHT
  const values = new Float32Array(count)
  const mask = new Uint8Array(count).fill(1)
  for (let i = 0; i < count; i += 1) values[i] = (i / (count - 1)) * 100
  // A few gaps, so the transparent branch is exercised too.
  for (const i of [0, 7, 1234, count - 1]) {
    values[i] = Number.NaN
    mask[i] = 0
  }
  return { values, mask }
}

/** What `rasterize` + `writeColor` must produce: one colored pixel per cell. */
function expectedMinifiedRaster(displayRange: GridValueRange): Uint8ClampedArray {
  const { values, mask } = minifiedGrid()
  const lut = rampLut(GREYSCALE, 256)
  const pixels = new Uint8ClampedArray(values.length * 4)
  for (let i = 0; i < values.length; i += 1) {
    const offset = i * 4
    if (!mask[i]) continue
    const position = normalizeValue(values[i]!, displayRange, 'linear')
    if (position === null) continue
    const rgba = sampleLutLinear(lut, position)
    pixels[offset] = Math.round(rgba[0])
    pixels[offset + 1] = Math.round(rgba[1])
    pixels[offset + 2] = Math.round(rgba[2])
    pixels[offset + 3] = Math.round(rgba[3])
  }
  return pixels
}

async function renderMinified(displayRange: GridValueRange | undefined): Promise<Uint8ClampedArray> {
  const { Canvas2DGridBackend } = await import('../src/render/canvas2d.js')
  const { values, mask } = minifiedGrid()
  const backend = Canvas2DGridBackend.create({
    mode: 'scalar',
    style: {
      rampStops: GREYSCALE,
      valueRange: WIRE_RANGE,
      scale: 'linear',
      ...(displayRange !== undefined ? { displayRange } : {}),
    },
  })
  const element = backend.element() as unknown as { parentElement: unknown }
  element.parentElement = {
    getBoundingClientRect: () => ({ width: CANVAS_WIDTH, height: CANVAS_HEIGHT }),
  }
  backend.setViewport(VIEWPORT)
  captured.image = null
  backend.render({
    lower: {
      key: 'minified',
      width: MINIFIED_GRID_WIDTH,
      height: MINIFIED_GRID_HEIGHT,
      renderMode: 'scalar',
      valueKind: 'float32',
      values,
      mask,
    },
    upper: {
      key: 'minified',
      width: MINIFIED_GRID_WIDTH,
      height: MINIFIED_GRID_HEIGHT,
      renderMode: 'scalar',
      valueKind: 'float32',
      values,
      mask,
    },
    progress: 0,
    bbox: BBOX,
  })
  const raster = takeCapture().data
  // The capture is the cell-resolution raster `rasterize` built, not a screen
  // blit — which is how we know the minified branch is the one that ran.
  expect(raster.length).toBe(MINIFIED_GRID_WIDTH * MINIFIED_GRID_HEIGHT * 4)
  return raster
}

describe('Canvas2D minified raster path honors displayRange', () => {
  const STRETCH: GridValueRange = { lowerBound: 40, upperBound: 60 }

  it('colors every cell through the stretch, not through the wire domain', async () => {
    const actual = await renderMinified(STRETCH)
    const expected = expectedMinifiedRaster(STRETCH)

    let differing = 0
    for (let i = 0; i < expected.length; i += 1) if (actual[i] !== expected[i]) differing += 1
    expect(differing).toBe(0)

    // The assertion that makes the one above non-vacuous: coloring through
    // `valueRange` instead — the mutation that used to pass — is a different
    // raster, and by a lot.
    const throughWireDomain = expectedMinifiedRaster(WIRE_RANGE)
    let wrong = 0
    for (let i = 0; i < expected.length; i += 1) {
      if (throughWireDomain[i] !== expected[i]) wrong += 1
    }
    expect(wrong).toBeGreaterThan(expected.length / 4)
  })

  it('renders the wire domain when no stretch is set', async () => {
    const actual = await renderMinified(undefined)
    const expected = expectedMinifiedRaster(WIRE_RANGE)
    let differing = 0
    for (let i = 0; i < expected.length; i += 1) if (actual[i] !== expected[i]) differing += 1
    expect(differing).toBe(0)
  })

  it('leaves gap cells fully transparent under a stretch', async () => {
    const actual = await renderMinified(STRETCH)
    for (const i of [0, 7, 1234, MINIFIED_GRID_WIDTH * MINIFIED_GRID_HEIGHT - 1]) {
      expect(actual[i * 4 + 3]).toBe(0)
    }
  })
})

// ---------------------------------------------------------------------------
// The WebGL2 shader, checked structurally
// ---------------------------------------------------------------------------

/**
 * There is no GL context in this environment and this package adds no
 * dependency to invent one, so the choice is a structural assertion or nothing.
 *
 * Structure is worth asserting here because the property at risk is textual and
 * invisible to a reviewer skimming a 120-line shader: does `normalizedScalar`
 * normalize over `displayRange` while `displayValue` decodes over `valueRange`,
 * and does it carry the same two guards the CPU reference does? Pixel parity
 * against a real GPU stays the browser leg's job.
 */
describe('the WebGL2 scalar shader splits decode from normalize', () => {
  function normalizedScalarBody(source: string): string {
    const start = source.indexOf('float normalizedScalar(float value) {')
    expect(start).toBeGreaterThan(-1)
    const end = source.indexOf('\nvoid main()', start)
    expect(end).toBeGreaterThan(start)
    return source.slice(start, end)
  }

  function displayValueBody(source: string): string {
    const start = source.indexOf('float displayValue(')
    expect(start).toBeGreaterThan(-1)
    return source.slice(start, source.indexOf('/** uv ->', start))
  }

  for (const valueKind of ['float32', 'encoded-u16'] as const) {
    it(`declares both uniforms and uses each for its own job (${valueKind})`, async () => {
      const { scalarFragmentShader } = await import('../src/render/gl.js')
      const source = scalarFragmentShader(valueKind)

      expect(source).toContain('uniform vec2 valueRange;')
      expect(source).toContain('uniform vec2 displayRange;')

      const normalize = normalizedScalarBody(source)
      // Both guards, in the negated-less-than form the CPU twin uses so a NaN
      // bound is rejected rather than passed through.
      expect(normalize).toContain('if (!(valueRange.x < valueRange.y)) return -1.0;')
      expect(normalize).toContain('if (!(displayRange.x < displayRange.y)) return -1.0;')
      // …and the arithmetic reads only the display range. A stray `valueRange`
      // outside the guard line is the exact regression this catches.
      const arithmetic = normalize.replace(
        'if (!(valueRange.x < valueRange.y)) return -1.0;',
        '',
      )
      expect(arithmetic).not.toContain('valueRange')
      expect(arithmetic).toContain('displayRange.x')
      expect(arithmetic).toContain('displayRange.y')
    })
  }

  it('decodes an encoded-u16 sample over the wire domain only', async () => {
    const { scalarFragmentShader } = await import('../src/render/gl.js')
    const decode = displayValueBody(scalarFragmentShader('encoded-u16'))
    expect(decode).toContain('valueRange.x')
    expect(decode).toContain('valueRange.y')
    // Decoding through the stretch is the mis-decode this whole file is about.
    expect(decode).not.toContain('displayRange')
  })

  it('makes float32 decoding the identity, touching neither range', async () => {
    const { scalarFragmentShader } = await import('../src/render/gl.js')
    const decode = displayValueBody(scalarFragmentShader('float32'))
    expect(decode).toContain('float displayValue(float raw) { return raw; }')
  })
})
