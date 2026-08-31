import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { normalizeWireStops } from '../src/color/ramp.js'
import {
  observationSupportModulatesWeight,
  observationWeightForZoom,
  viewportZoom,
} from '../src/core/math.js'
import {
  referenceRenderRgbCompositionViewport,
  referenceRenderScalarViewport,
  type ReferenceRgbCompositionLayer,
} from '../src/core/reference-render.js'
import type {
  GridBBox,
  GridFrame,
  GridRgbCompositionVersion,
  GridSampling,
  GridViewport,
} from '../src/core/models.js'

/**
 * The parity contract, asserted rather than asserted-to.
 *
 * The Canvas2D fallback is supposed to *be* the reference renderer in its
 * magnified path — it calls `referenceScalarPixel` rather than a copy — and
 * that claim is worth exactly nothing unless something checks it. The C7 golden
 * harness will check the browser legs; this checks the leg that can be checked
 * in Node, which is the one most likely to drift silently because nobody looks
 * at the fallback until WebGL2 is unavailable.
 *
 * The DOM here is the minimum the backend touches. It is a shim, not an
 * emulation: it exists to let real backend code run and to capture the exact
 * `ImageData` it rasterizes.
 */

const CANVAS_WIDTH = 160
const CANVAS_HEIGHT = 120

interface Captured {
  image: { data: Uint8ClampedArray } | null
}

const captured: Captured = { image: null }
const originals: Record<string, unknown> = {}

/**
 * Read the capture through a declared return type.
 *
 * Assigning `captured.image = null` narrows the field to `null` for the rest of
 * the block, and the write that matters happens inside the shim's
 * `putImageData` — invisible to control-flow analysis, which would otherwise
 * conclude the value can only be `null` and reject every use of it.
 */
function takeCapture(): Captured['image'] {
  return captured.image
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

// A gulf-shaped scalar grid: log layer, a sharp front, a ragged coastline of
// missing cells — the three things that make the kernel and coverage rules
// visible at all.
const GRID_WIDTH = 40
const GRID_HEIGHT = 30
const VALUE_RANGE = { lowerBound: 0.01, upperBound: 6.6 }
const BBOX: GridBBox = [-95, 27, -88, 30]
const VIEWPORT: GridViewport = {
  center: { latitude: 28.5, longitude: -91.5 },
  span: { latitudeDelta: 3.2, longitudeDelta: 7.4 },
}

function buildGrid(): { values: Float32Array; mask: Uint8Array } {
  const values = new Float32Array(GRID_WIDTH * GRID_HEIGHT)
  const mask = new Uint8Array(GRID_WIDTH * GRID_HEIGHT)
  for (let y = 0; y < GRID_HEIGHT; y += 1) {
    for (let x = 0; x < GRID_WIDTH; x += 1) {
      const i = y * GRID_WIDTH + x
      const land = x + y * 0.4 < 9 + 3 * Math.sin(y * 0.8)
      mask[i] = land ? 0 : 1
      values[i] = land
        ? Number.NaN
        : Math.max(
            0.011,
            (x > GRID_WIDTH * 0.6 ? 0.9 : 0.05) + 0.04 * Math.sin(x * 0.6) * Math.cos(y * 0.5),
          )
    }
  }
  return { values, mask }
}

const stops = normalizeWireStops(
  [
    { value: 0.01, r: 8, g: 24, b: 90, a: 255 },
    { value: 0.08, r: 0, g: 150, b: 190, a: 200 },
    { value: 0.4, r: 240, g: 230, b: 110, a: 255 },
    { value: 6.6, r: 150, g: 30, b: 20, a: 255 },
  ],
  VALUE_RANGE,
  'log',
)

async function renderThroughBackend(sampling: GridSampling): Promise<Uint8ClampedArray> {
  const { Canvas2DGridBackend } = await import('../src/render/canvas2d.js')
  const { values, mask } = buildGrid()
  const backend = Canvas2DGridBackend.create({
    mode: 'scalar',
    style: { rampStops: stops, valueRange: VALUE_RANGE, scale: 'log', sampling },
  })
  const element = backend.element() as unknown as { parentElement: unknown }
  element.parentElement = {
    getBoundingClientRect: () => ({ width: CANVAS_WIDTH, height: CANVAS_HEIGHT }),
  }
  backend.setViewport(VIEWPORT)
  const frame: GridFrame = {
    key: 'parity',
    width: GRID_WIDTH,
    height: GRID_HEIGHT,
    renderMode: 'scalar',
    valueKind: 'float32',
    values,
    mask,
  }
  captured.image = null
  backend.render({ lower: frame, upper: frame, progress: 0, bbox: BBOX })
  const image = takeCapture()
  if (!image) throw new Error('Canvas2D did not take its screen-space path')
  return image.data
}

function renderThroughReference(sampling: GridSampling): Uint8ClampedArray {
  const { values, mask } = buildGrid()
  return referenceRenderScalarViewport(
    { values, mask, width: GRID_WIDTH, height: GRID_HEIGHT, valueKind: 'float32' },
    { stops, valueRange: VALUE_RANGE, scale: 'log', sampling },
    { viewport: VIEWPORT, bbox: BBOX, width: CANVAS_WIDTH, height: CANVAS_HEIGHT },
  ).pixels
}

async function renderRgbThroughBackend(sampling: GridSampling): Promise<Uint8ClampedArray> {
  const { Canvas2DGridBackend } = await import('../src/render/canvas2d.js')
  const width = 4
  const height = 3
  const red = new Uint8Array([20, 40, 0, 0, 30, 60, 90, 0, 40, 80, 120, 160])
  const green = new Uint8Array([80, 90, 0, 0, 90, 100, 110, 0, 100, 110, 120, 130])
  const blue = new Uint8Array([180, 160, 0, 0, 160, 140, 120, 0, 140, 120, 100, 80])
  const mask = new Uint8Array([1, 1, 0, 0, 1, 1, 1, 0, 1, 1, 1, 1])
  const backend = Canvas2DGridBackend.create({
    mode: 'rgb',
    style: { valueRange: { lowerBound: 0, upperBound: 1 }, scale: 'linear', sampling },
  })
  const element = backend.element() as unknown as { parentElement: unknown }
  element.parentElement = {
    getBoundingClientRect: () => ({ width: CANVAS_WIDTH, height: CANVAS_HEIGHT }),
  }
  backend.setViewport(VIEWPORT)
  const frame: GridFrame = {
    key: `rgb-${sampling}`,
    width,
    height,
    renderMode: 'rgb',
    valueKind: 'encoded-u16',
    values: red,
    channels: [red, green, blue],
    mask,
  }
  captured.image = null
  backend.render({ lower: frame, upper: frame, progress: 0, bbox: BBOX })
  const image = takeCapture()
  if (!image) throw new Error('Canvas2D did not rasterize its RGB source image')
  return image.data
}

function composedFrame(
  key: string,
  offset: number,
  version?: GridRgbCompositionVersion,
): GridFrame {
  const width = 4
  const height = 3
  const size = width * height
  const baseChannels = [
    new Uint8Array(Array.from({ length: size }, (_, index) => 20 + offset + index * 3)),
    new Uint8Array(Array.from({ length: size }, (_, index) => 70 + offset + index * 2)),
    new Uint8Array(Array.from({ length: size }, (_, index) => 150 + offset - index * 2)),
  ] as const
  const observedChannels = [
    new Uint8Array(Array.from({ length: size }, (_, index) => 150 + offset - index * 2)),
    new Uint8Array(Array.from({ length: size }, (_, index) => 30 + offset + index * 4)),
    new Uint8Array(Array.from({ length: size }, (_, index) => 45 + offset + index * 5)),
  ] as const
  const confidence = new Uint8Array(
    Array.from({ length: size }, (_, index) => 80 + ((index * 29 + offset) % 176)),
  )
  const baseMask = new Uint8Array([1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 1])
  const observedMask = new Uint8Array([0, 1, 1, 0, 0, 1, 1, 1, 0, 0, 1, 1])
  const rgbComposition = {
    ...(version ? { version } : {}),
    baseChannels,
    observedChannels,
    confidence,
    baseMask,
    observedMask,
  }
  return {
    key,
    width,
    height,
    renderMode: 'rgb',
    valueKind: 'encoded-u16',
    values: baseChannels[0],
    channels: baseChannels,
    mask: baseMask,
    rgbComposition,
  }
}

function referenceCompositionLayer(frame: GridFrame): ReferenceRgbCompositionLayer {
  const composition = frame.rgbComposition
  if (!composition) throw new Error('test frame is missing RGB composition')
  return {
    ...composition,
    width: frame.width,
    height: frame.height,
  }
}

const COMPOSITION_VIEWPORT: GridViewport = { ...VIEWPORT, zoom: 9.25 }

async function renderRgbCompositionThroughBackend(
  sampling: GridSampling,
  viewport: GridViewport = COMPOSITION_VIEWPORT,
  version?: GridRgbCompositionVersion,
): Promise<Uint8ClampedArray> {
  const { Canvas2DGridBackend } = await import('../src/render/canvas2d.js')
  const backend = Canvas2DGridBackend.create({
    mode: 'rgb',
    style: { valueRange: { lowerBound: 0, upperBound: 1 }, scale: 'linear', sampling },
  })
  const element = backend.element() as unknown as { parentElement: unknown }
  element.parentElement = {
    getBoundingClientRect: () => ({ width: CANVAS_WIDTH, height: CANVAS_HEIGHT }),
  }
  backend.setViewport(viewport)
  captured.image = null
  backend.render({
    lower: composedFrame('lower', 0, version),
    upper: composedFrame('upper', 12, version),
    progress: 0.35,
    bbox: BBOX,
  })
  const image = takeCapture()
  if (!image) throw new Error('Canvas2D did not take its composed RGB screen-space path')
  return image.data
}

function renderRgbCompositionThroughReference(
  sampling: GridSampling,
  viewport: GridViewport = COMPOSITION_VIEWPORT,
  version?: GridRgbCompositionVersion,
): Uint8ClampedArray {
  const lower = composedFrame('lower', 0, version)
  const upper = composedFrame('upper', 12, version)
  const zoom = viewportZoom(viewport, CANVAS_WIDTH)
  return referenceRenderRgbCompositionViewport(
    referenceCompositionLayer(lower),
    {
      sampling,
      observationWeight: observationWeightForZoom(zoom, version),
      supportModulatesWeight: observationSupportModulatesWeight(zoom, version),
    },
    {
      viewport,
      bbox: BBOX,
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
      blend: { upper: referenceCompositionLayer(upper), progress: 0.35 },
    },
  ).pixels
}

describe('Canvas2D screen-space path === reference renderer', () => {
  for (const sampling of ['soft', 'coastal'] as const) {
    it(`is byte-identical for ${sampling} sampling`, async () => {
      const actual = await renderThroughBackend(sampling)
      const expected = renderThroughReference(sampling)

      // Guard against a vacuous pass: a fully transparent raster would match
      // trivially and prove nothing about the kernel.
      let painted = 0
      for (let i = 3; i < expected.length; i += 4) if (expected[i]! > 0) painted += 1
      expect(painted).toBeGreaterThan(CANVAS_WIDTH * CANVAS_HEIGHT * 0.3)

      expect(actual.length).toBe(expected.length)
      let differing = 0
      for (let i = 0; i < expected.length; i += 1) {
        if (actual[i] !== expected[i]) differing += 1
      }
      expect(differing).toBe(0)
    })
  }

  for (const sampling of ['soft', 'coastal'] as const) {
    it(`is byte-identical for v2 area overview with ${sampling} sampling`, async () => {
      const version = 'base-observed-confidence-v2-area-anchor' as const
      const viewport = { ...COMPOSITION_VIEWPORT, zoom: 7 }
      const actual = await renderRgbCompositionThroughBackend(sampling, viewport, version)
      const expected = renderRgbCompositionThroughReference(sampling, viewport, version)
      expect(actual).toEqual(expected)
    })
  }

  it('paints more of the coastline under coastal than under soft', async () => {
    const countPainted = (pixels: Uint8ClampedArray): number => {
      let n = 0
      for (let i = 3; i < pixels.length; i += 4) if (pixels[i]! > 0) n += 1
      return n
    }
    const soft = countPainted(renderThroughReference('soft'))
    const coastal = countPainted(renderThroughReference('coastal'))
    // Coastal keeps the partially-covered edge cells that soft discards.
    expect(coastal).toBeGreaterThan(soft)
  })
})

describe('Canvas2D RGB sampling boundary', () => {
  it('keeps its fast premultiplied-alpha resample independent of the WebGL sampling hint', async () => {
    const soft = await renderRgbThroughBackend('soft')
    const coastal = await renderRgbThroughBackend('coastal')

    // This equality is the documented backend boundary, not an accidental
    // parity claim: Canvas scales this same masked RGBA image with its native
    // premultiplied-alpha filter for either hint. WebGL2 and the CPU reference
    // are the paths that select explicit soft/coastal RGB kernels.
    expect(soft).toEqual(coastal)
    expect(Array.from(soft).filter((_, index) => index % 4 === 3)).toContain(0)
    expect(Array.from(soft).filter((_, index) => index % 4 === 3)).toContain(255)
  })
})

describe('Canvas2D scale-aware RGB === linear-sRGB CPU reference', () => {
  for (const sampling of ['soft', 'coastal'] as const) {
    it(`is byte-identical for ${sampling} sampling`, async () => {
      const actual = await renderRgbCompositionThroughBackend(sampling)
      const expected = renderRgbCompositionThroughReference(sampling)
      let painted = 0
      for (let index = 3; index < expected.length; index += 4) {
        if (expected[index]! > 0) painted += 1
      }
      expect(painted).toBeGreaterThan(CANVAS_WIDTH * CANVAS_HEIGHT * 0.2)
      expect(actual).toEqual(expected)
    })
  }


  it('derives continuous zoom from CSS width when the host omits viewport.zoom', async () => {
    const expectedZoom = 9.25
    const longitudeDelta = (360 * CANVAS_WIDTH) / (256 * 2 ** expectedZoom)
    const viewport: GridViewport = {
      center: VIEWPORT.center,
      span: { ...VIEWPORT.span, longitudeDelta },
    }
    expect(viewportZoom(viewport, CANVAS_WIDTH)).toBeCloseTo(expectedZoom, 12)
    const actual = await renderRgbCompositionThroughBackend('coastal', viewport)
    const expected = renderRgbCompositionThroughReference('coastal', viewport)
    expect(actual).toEqual(expected)
  })
})
