import { gridBounds, type GridScalarDataset } from '../core/decode/grid.js'
import { defaultBBoxAnchor, frameCacheKey, gridFrameFromScalarDataset } from '../core/frame.js'
import { texelPositionFromUv } from '../core/math.js'
import type { GridBBox, GridBBoxAnchor, GridFrame, GridValueKind } from '../core/models.js'
import {
  referenceScalarPixel,
  type ReferenceRaster,
  type ReferenceScalarLayer,
  type ReferenceScalarStyle,
} from '../core/reference-render.js'
import {
  bindTexture,
  createProgram,
  scalarFragmentShader,
  setClampNearest,
  vertexShader,
} from '../render/gl.js'
import { RAMP_LUT_COUNT, resolveRampStops, styleLut, styleScale } from '../render/style.js'
import type { GridStyle } from '../render/types.js'
import {
  tileColumnU,
  tileProjection,
  tileRowV,
  type GridTileKey,
  type TileProjection,
} from './mercator.js'

/**
 * Bake one Web-Mercator raster tile out of a decoded grid.
 *
 * ## What this is for
 *
 * The overlay path (`createGridOverlay`) draws one viewport-sized canvas over a
 * basemap. That is the right shape for a map this package positions itself, and
 * the wrong shape for a host that owns tiling — MapKit JS, MapLibre, Leaflet —
 * which wants an image per `z/x/y` and will reproject, cache and crossfade them
 * itself. Those hosts previously had to fall back to the server's pre-baked
 * PNGs, which are fixed-zoom, fixed-ramp, and a release behind. This bakes the
 * same pixels the overlay would draw, per tile, from the same bytes.
 *
 * ## Two backends, one set of pixels
 *
 * WebGL2 is used when the runtime has it: one shared context, one FBO, and the
 * fragment shader from `render/gl.ts` — literally the program the overlay
 * renders through, with the Mercator inverse substituted for the viewport's
 * affine transform. Where WebGL2 is unavailable (a Node test, a locked-down
 * browser, a worker without OffscreenCanvas GL), {@link referenceRenderGridTile}
 * runs the same math on the CPU through `referenceScalarPixel` — the same
 * function `Canvas2DGridBackend` calls, so the fallback cannot drift from the
 * primary.
 *
 * Both paths sample the grid **per output pixel**. Nothing crops or upscales an
 * ancestor tile, so overzooming past the grid's native resolution produces a
 * smooth value-space surface rather than visible cell blocks — the same thing
 * the overlay does when you zoom in on it.
 */

/** A decoded grid, placed on the globe: what a tile is baked from. */
export interface GridTileLayer {
  frame: GridFrame
  /** `[west, south, east, north]` — the frame's geographic extent. */
  bbox: GridBBox
  /**
   * What `bbox` measures. Defaults from the frame's value kind — `cell-center`
   * for `float32`, `cell-edge` for the temporal dialect. The two differ by half
   * a cell; see {@link GridBBoxAnchor}.
   */
  bboxAnchor?: GridBBoxAnchor
}

/**
 * Either a positioned layer or a freshly decoded `/grid` dataset.
 *
 * A dataset is self-describing — `gridBounds(header)` is its extent and it
 * spans cell centers — so the common case needs no wrapper. Pass a
 * {@link GridTileLayer} when the extent is not the grid's own (a temporal
 * manifest's edge-anchored bbox, say).
 */
export type GridTileSource = GridTileLayer | GridScalarDataset

export interface GridTileRenderOptions extends GridTileKey {
  /** Plane to render when the source is a multi-plane dataset. Defaults to `0`. */
  planeIndex?: number
  /**
   * Flat multiplier on the output alpha. Defaults to `style.opacity ?? 1`.
   *
   * **A tile carries its opacity in its pixels.** The overlay path puts
   * `style.opacity` on the canvas element as a CSS property; a tile has no
   * element, so it is composed into the alpha here instead. A host that also
   * sets its own layer opacity (MapKit's `TileOverlay({ opacity })`, for one)
   * squares it — pass `opacity: 1` here and let the host own it, or leave the
   * host at `1` and let the style own it, but not both.
   */
  opacity?: number
  /**
   * Renderer to bake through. Omitted, a lazily-created process-wide WebGL2
   * renderer is used, falling back to the CPU path where WebGL2 is
   * unavailable. An explicit `null` means "do not use one", which is how a
   * caller pins the CPU path without also forbidding a future GPU backend.
   */
  renderer?: GridTileRenderer | null
  /** Force a backend. `auto` (default) prefers WebGL2. */
  backend?: 'auto' | 'webgl2' | 'cpu'
}

function isScalarDataset(source: GridTileSource): source is GridScalarDataset {
  return 'header' in source && 'planes' in source
}

const placedDatasets = new WeakMap<GridScalarDataset, Map<number, GridTileLayer>>()

/**
 * Normalize either source shape into a positioned layer.
 *
 * A dataset's extent comes from `gridBounds(header)` rather than
 * `header.bbox` — deliberately the same choice `overlay.setScalarFrame` makes,
 * so a tile and the overlay never disagree about where a grid sits. The two
 * should be equal (the decoder's tests assert it), and where a publisher's
 * `bbox` disagrees with its own geometry, the geometry is what the samples
 * actually are.
 *
 * ## Why the result is memoized on the dataset
 *
 * `gridFrameFromScalarDataset` builds the frame's default `key` by hashing the
 * whole plane, which is ~3.6 ms for a 512² grid — fine once at decode time, and
 * ruinous **per tile**: a map showing thirty tiles would spend a tenth of a
 * second hashing the same unchanged bytes thirty times over. Holding the
 * conversion on the dataset's identity also means every tile hands the GPU
 * renderer the *same* `GridFrame` object, so its texture cache sees one grid
 * rather than thirty indistinguishable ones.
 *
 * Keyed on identity because nothing here rewrites a plane in place — the
 * decoder allocates fresh arrays per response, so a refetch arrives as a new
 * object. A caller who mutates a decoded plane in place, **or swaps a new array
 * into `dataset.planes[i]` on the same dataset object**, keeps the layer this
 * cached first and should build the {@link GridTileLayer} itself with its own
 * frame `key` instead.
 */
export function toGridTileLayer(source: GridTileSource, planeIndex = 0): GridTileLayer {
  if (!isScalarDataset(source)) return source
  let byPlane = placedDatasets.get(source)
  if (!byPlane) {
    byPlane = new Map()
    placedDatasets.set(source, byPlane)
  }
  const cached = byPlane.get(planeIndex)
  if (cached) return cached
  const placed: GridTileLayer = {
    frame: gridFrameFromScalarDataset(source, planeIndex),
    bbox: gridBounds(source.header),
    bboxAnchor: 'cell-center',
  }
  byPlane.set(planeIndex, placed)
  return placed
}

/**
 * The ramp LUT a tile is colored through, with the tile's opacity already in it.
 *
 * Scaling the LUT's alpha rather than the composed pixel alpha is what lets the
 * WebGL and CPU paths share one number: the GPU has no flat-opacity uniform
 * (the overlay does not need one — CSS carries it there), and adding one to the
 * shared fragment would make an unset uniform on the overlay path mean
 * "invisible". `alpha = lut.a * coverage` is linear in `lut.a`, so folding the
 * multiplier in here is exact up to the one count of byte rounding it costs.
 */
function tileLut(style: GridStyle, opacity: number): Uint8Array {
  const lut = styleLut(style)
  if (opacity >= 1) return lut
  const scale = opacity > 0 ? opacity : 0
  // `styleLut` allocates per call, so this is a fresh array, not a shared one.
  for (let index = 3; index < lut.length; index += 4) {
    lut[index] = Math.round((lut[index] ?? 0) * scale)
  }
  return lut
}

/**
 * The two ranges do two jobs, and a tile has to carry both.
 *
 * `valueRange` decodes an `encoded-u16` sample; `displayRange` spreads the ramp.
 * Dropping the stretch here would not fail — it would render every tile against
 * the unstretched ramp while the overlay beside it renders the stretched one,
 * which is the exact "two renderers disagreeing about the same bytes" failure
 * this package exists to prevent.
 */
function referenceStyleFor(style: GridStyle): ReferenceScalarStyle {
  return {
    stops: resolveRampStops(style),
    valueRange: style.valueRange,
    scale: styleScale(style),
    lutCount: RAMP_LUT_COUNT,
    ...(style.displayRange !== undefined ? { displayRange: style.displayRange } : {}),
    ...(style.sampling !== undefined ? { sampling: style.sampling } : {}),
  }
}

function referenceLayerFor(frame: GridFrame): ReferenceScalarLayer {
  return {
    values: frame.values,
    mask: frame.mask,
    width: frame.width,
    height: frame.height,
    valueKind: frame.valueKind,
  }
}

function tileSide(tile: GridTileKey): number {
  const side = Math.floor(tile.side)
  if (!Number.isFinite(side) || side < 1) {
    throw new RangeError(`tile side must be a positive integer, received ${String(tile.side)}`)
  }
  return side
}

function assertScalar(frame: GridFrame): void {
  if (frame.renderMode !== 'scalar') {
    throw new TypeError(
      `tile baking supports scalar frames only, received renderMode "${frame.renderMode}"`,
    )
  }
}

/**
 * The alpha multiplier for this tile, clamped to `0…1`.
 *
 * A non-finite opacity resolves to `1`, not to `0`. `Math.max(0, …)` on a `NaN`
 * yields `NaN`, which {@link tileLut}'s `> 0` test then reads as zero and turns
 * into an invisible layer — a corrupt number should not be the difference
 * between a map and a blank one.
 */
function resolvedOpacity(style: GridStyle, options: GridTileRenderOptions): number {
  const opacity = options.opacity ?? style.opacity ?? 1
  if (!Number.isFinite(opacity)) return 1
  return Math.max(0, Math.min(1, opacity))
}

/**
 * Bake a tile on the CPU, with no canvas and no GL.
 *
 * The Node-assertable half of this module, and the fallback the browser path
 * takes when WebGL2 is missing. Pixels are non-premultiplied RGBA8, row-major,
 * north row first — the same layout `referenceRenderScalarTile` produces.
 *
 * A pixel whose data UV falls outside the grid is left fully transparent, which
 * is the `uv` bounds check the fragment shader opens with. A tile that misses
 * the grid entirely is therefore a transparent tile, not an error and not a
 * `null`.
 */
export function referenceRenderGridTile(
  source: GridTileSource,
  style: GridStyle,
  options: GridTileRenderOptions,
): ReferenceRaster {
  const layer = toGridTileLayer(source, options.planeIndex ?? 0)
  assertScalar(layer.frame)
  const side = tileSide(options)
  const pixels = new Uint8ClampedArray(side * side * 4)
  const raster: ReferenceRaster = { width: side, height: side, pixels }

  const projection = tileProjection(options, layer.bbox)
  if (!projection) return raster

  const frame = layer.frame
  const anchor = layer.bboxAnchor ?? defaultBBoxAnchor(frame.valueKind)
  const lut = tileLut(style, resolvedOpacity(style, options))
  const referenceStyle = referenceStyleFor(style)
  const referenceLayer = referenceLayerFor(frame)

  for (let row = 0; row < side; row += 1) {
    const v = tileRowV(projection, (row + 0.5) / side)
    if (v < 0 || v > 1) continue
    const gy = texelPositionFromUv(v, frame.height, anchor)
    for (let column = 0; column < side; column += 1) {
      const u = tileColumnU(projection, (column + 0.5) / side)
      if (u < 0 || u > 1) continue
      const gx = texelPositionFromUv(u, frame.width, anchor)
      const rgba = referenceScalarPixel(referenceLayer, lut, referenceStyle, gx, gy)
      const offset = (row * side + column) * 4
      pixels[offset] = Math.round(rgba[0])
      pixels[offset + 1] = Math.round(rgba[1])
      pixels[offset + 2] = Math.round(rgba[2])
      pixels[offset + 3] = Math.round(rgba[3])
    }
  }
  return raster
}

const UNIT_VALUES = 0
const UNIT_MASK = 1
const UNIT_LUT = 2
const UNIT_STENCIL = 3

const DEFAULT_MAX_GPU_FRAMES = 4

interface GpuFrame {
  values: WebGLTexture
  mask: WebGLTexture
  valueKind: GridValueKind
}

interface Pipeline {
  program: WebGLProgram
  locations: Map<string, WebGLUniformLocation | null>
}

export interface GridTileRendererOptions {
  /** How many decoded grids to keep uploaded. Defaults to `4`, minimum `1`. */
  maxGpuFrames?: number
}

/**
 * A WebGL2 tile baker: one context, one FBO, reused across every tile.
 *
 * ## Why one shared renderer and not one context per tile
 *
 * A browser caps live WebGL contexts at roughly sixteen and silently kills the
 * oldest past that. A map showing thirty tiles would therefore lose its own
 * earlier tiles mid-render if each tile brought a context. One context for the
 * whole layer also means one texture upload per *grid* rather than per tile,
 * which is the difference between uploading a 512×512 float plane once and
 * uploading it thirty times.
 *
 * The cost is a `readPixels` per tile: the result has to leave the shared
 * drawing buffer before the next tile overwrites it. That is a synchronous GPU
 * stall of well under a millisecond at 256², against a fragment pass that would
 * otherwise be ~30× a CPU bake, and it yields non-premultiplied RGBA8 bytes in
 * exactly the layout the CPU reference produces — which is what makes the two
 * backends comparable at all.
 *
 * Blending is **off** for the tile pass. There is nothing underneath a tile to
 * blend with, and leaving `SRC_ALPHA` blending on would premultiply the output
 * against a cleared buffer and quietly darken every semi-transparent pixel.
 */
export class GridTileRenderer {
  private readonly gl: WebGL2RenderingContext
  private readonly canvas: OffscreenCanvas
  private readonly buffer: WebGLBuffer
  private readonly framebuffer: WebGLFramebuffer
  private readonly whiteStencil: WebGLTexture
  private readonly pipelines = new Map<GridValueKind, Pipeline>()
  private readonly frames = new Map<string, GpuFrame>()
  private readonly maxGpuFrames: number
  private colorTexture: WebGLTexture | null = null
  private targetWidth = 0
  private targetHeight = 0
  private lutTexture: WebGLTexture | null = null
  private lutBytes: Uint8Array | null = null
  private readback: Uint8Array = new Uint8Array(0)
  private destroyed = false

  /** `null` when the runtime has no OffscreenCanvas WebGL2 to bake with. */
  static create(options: GridTileRendererOptions = {}): GridTileRenderer | null {
    if (typeof OffscreenCanvas === 'undefined') return null
    let canvas: OffscreenCanvas
    try {
      canvas = new OffscreenCanvas(1, 1)
    } catch {
      return null
    }
    const gl = canvas.getContext('webgl2', {
      alpha: true,
      antialias: false,
      depth: false,
      premultipliedAlpha: false,
      stencil: false,
    })
    if (!gl) return null
    try {
      return new GridTileRenderer(canvas, gl, options)
    } catch {
      return null
    }
  }

  private constructor(
    canvas: OffscreenCanvas,
    gl: WebGL2RenderingContext,
    options: GridTileRendererOptions,
  ) {
    this.canvas = canvas
    this.gl = gl
    this.maxGpuFrames = Math.max(1, Math.floor(options.maxGpuFrames ?? DEFAULT_MAX_GPU_FRAMES))

    const buffer = gl.createBuffer()
    if (!buffer) throw new Error('WebGL buffer unavailable')
    this.buffer = buffer
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)

    const framebuffer = gl.createFramebuffer()
    if (!framebuffer) throw new Error('WebGL framebuffer unavailable')
    this.framebuffer = framebuffer

    gl.disable(gl.DEPTH_TEST)
    gl.disable(gl.CULL_FACE)
    gl.disable(gl.BLEND)

    // The shared fragment declares a `stencil` sampler even where nothing uses
    // it. An unbound sampler resolves to unit 0, where a `usampler2D` mask is
    // already bound, and two samplers of different types on one unit make the
    // draw call invalid on a conformant driver — so it gets a real texture on
    // its own unit rather than being left to default.
    const white = gl.createTexture()
    if (!white) throw new Error('WebGL stencil fallback texture unavailable')
    gl.bindTexture(gl.TEXTURE_2D, white)
    setClampNearest(gl)
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      1,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array([255, 255, 255, 255]),
    )
    this.whiteStencil = white
  }

  /**
   * Bake a tile, or answer `null` when this renderer cannot (a shader that will
   * not compile on this driver, an incomplete framebuffer, a lost context).
   *
   * `null` here means *use the CPU path*, not *there is no tile*. A tile with
   * no data in it is a fully transparent raster, which is a successful bake.
   */
  render(
    source: GridTileSource,
    style: GridStyle,
    options: GridTileRenderOptions,
  ): ReferenceRaster | null {
    if (this.destroyed) return null
    // A lost context is the one failure that reports itself through no GL call
    // this method makes. Every cache is warm by the second tile, so `pipeline`,
    // `ensureFrame` and `ensureTarget` all return early without touching GL,
    // and `drawArrays`/`readPixels` are defined as silent no-ops after loss —
    // leaving `readback` holding the *previous* tile's pixels, which would then
    // be served for every remaining tile in the layer with no error anywhere.
    // Asking directly is the only way to see it.
    if (this.gl.isContextLost()) {
      this.dropContextState()
      return null
    }
    const layer = toGridTileLayer(source, options.planeIndex ?? 0)
    assertScalar(layer.frame)
    const side = tileSide(options)
    const projection = tileProjection(options, layer.bbox)
    if (!projection) {
      return { width: side, height: side, pixels: new Uint8ClampedArray(side * side * 4) }
    }

    const frame = layer.frame
    const pipeline = this.pipeline(frame.valueKind)
    if (!pipeline) return null
    const gpuFrame = this.ensureFrame(frame)
    if (!gpuFrame) return null
    if (!this.ensureTarget(side, side)) return null

    const gl = this.gl
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer)
    gl.viewport(0, 0, side, side)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.useProgram(pipeline.program)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer)
    const position = gl.getAttribLocation(pipeline.program, 'position')
    if (position >= 0) {
      gl.enableVertexAttribArray(position)
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)
    }

    this.uploadProjection(pipeline, projection)
    const anchor = layer.bboxAnchor ?? defaultBBoxAnchor(frame.valueKind)
    gl.uniform1i(this.uniform(pipeline, 'anchorCenter'), anchor === 'cell-center' ? 1 : 0)
    // No temporal blend in the tile path: both sampler pairs read one frame, and
    // `progress` of 0 makes the mix a no-op rather than a half-cost second read.
    gl.uniform1f(this.uniform(pipeline, 'progress'), 0)
    gl.uniform2f(
      this.uniform(pipeline, 'valueRange'),
      style.valueRange.lowerBound,
      style.valueRange.upperBound,
    )
    // Not optional, and silent when missed: an unset `vec2` uniform is (0, 0),
    // which `normalizedScalar`'s `!(displayRange.x < displayRange.y)` guard
    // reads as a corrupt range and answers with -1.0 — so every pixel of every
    // tile would come back fully transparent, with nothing logged anywhere.
    const displayRange = style.displayRange ?? style.valueRange
    gl.uniform2f(
      this.uniform(pipeline, 'displayRange'),
      displayRange.lowerBound,
      displayRange.upperBound,
    )
    gl.uniform1i(this.uniform(pipeline, 'scaleLog'), styleScale(style) === 'log' ? 1 : 0)
    gl.uniform1i(this.uniform(pipeline, 'coastal'), style.sampling === 'coastal' ? 1 : 0)
    gl.uniform1i(this.uniform(pipeline, 'useStencil'), 0)
    gl.uniform2f(this.uniform(pipeline, 'stencilUvOffset'), 0, 0)
    gl.uniform2f(this.uniform(pipeline, 'stencilUvScale'), 1, 1)

    const lut = this.ensureLut(tileLut(style, resolvedOpacity(style, options)))
    if (!lut) return null
    bindTexture(gl, UNIT_LUT, lut, this.uniform(pipeline, 'lut'))
    bindTexture(gl, UNIT_STENCIL, this.whiteStencil, this.uniform(pipeline, 'stencil'))
    bindTexture(gl, UNIT_VALUES, gpuFrame.values, this.uniform(pipeline, 'values0'))
    bindTexture(gl, UNIT_MASK, gpuFrame.mask, this.uniform(pipeline, 'mask0'))
    gl.uniform1i(this.uniform(pipeline, 'values1'), UNIT_VALUES)
    gl.uniform1i(this.uniform(pipeline, 'mask1'), UNIT_MASK)

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    return this.readTarget(side, side)
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    const gl = this.gl
    this.dropContextState()
    gl.deleteTexture(this.whiteStencil)
    gl.deleteFramebuffer(this.framebuffer)
    gl.deleteBuffer(this.buffer)
    this.canvas.width = 1
    this.canvas.height = 1
  }

  /**
   * Forget everything that belonged to the old context.
   *
   * Deleting a name from a lost context is a defined no-op, so this is about
   * the *cache*, not the GPU memory: a restored context hands back the same
   * `WebGLRenderingContext` object with all of its objects invalidated, and a
   * warm cache would keep serving those dead handles forever. Fields are nulled
   * rather than merely cleared so a later `ensureLut`/`ensureTarget` rebuilds
   * instead of binding a name the driver no longer knows.
   */
  private dropContextState(): void {
    const gl = this.gl
    for (const frame of this.frames.values()) {
      gl.deleteTexture(frame.values)
      gl.deleteTexture(frame.mask)
    }
    this.frames.clear()
    for (const pipeline of this.pipelines.values()) gl.deleteProgram(pipeline.program)
    this.pipelines.clear()
    if (this.lutTexture) gl.deleteTexture(this.lutTexture)
    if (this.colorTexture) gl.deleteTexture(this.colorTexture)
    this.lutTexture = null
    this.lutBytes = null
    this.colorTexture = null
    this.targetWidth = 0
    this.targetHeight = 0
  }

  private uploadProjection(pipeline: Pipeline, projection: TileProjection): void {
    const gl = this.gl
    gl.uniform2f(this.uniform(pipeline, 'tileU'), projection.uOrigin, projection.uSpan)
    gl.uniform2f(
      this.uniform(pipeline, 'tileMercArg'),
      projection.mercArgOrigin,
      projection.mercArgSpan,
    )
    gl.uniform2f(this.uniform(pipeline, 'tileLat'), projection.latNorth, projection.latInvSpan)
  }

  private pipeline(valueKind: GridValueKind): Pipeline | null {
    const cached = this.pipelines.get(valueKind)
    if (cached) return cached
    try {
      const program = createProgram(
        this.gl,
        vertexShader(),
        scalarFragmentShader(valueKind, 'mercator'),
      )
      const pipeline: Pipeline = { program, locations: new Map() }
      this.pipelines.set(valueKind, pipeline)
      return pipeline
    } catch {
      return null
    }
  }

  /** `null` is a legitimate answer: a driver may optimize a uniform away. */
  private uniform(pipeline: Pipeline, name: string): WebGLUniformLocation | null {
    const cached = pipeline.locations.get(name)
    if (cached !== undefined) return cached
    const location = this.gl.getUniformLocation(pipeline.program, name)
    pipeline.locations.set(name, location)
    return location
  }

  private ensureLut(bytes: Uint8Array): WebGLTexture | null {
    const gl = this.gl
    if (this.lutTexture && this.lutBytes && sameBytes(this.lutBytes, bytes)) return this.lutTexture
    gl.activeTexture(gl.TEXTURE0 + UNIT_LUT)
    if (!this.lutTexture) {
      const texture = gl.createTexture()
      if (!texture) return null
      this.lutTexture = texture
      gl.bindTexture(gl.TEXTURE_2D, texture)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    } else {
      gl.bindTexture(gl.TEXTURE_2D, this.lutTexture)
    }
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    try {
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        RAMP_LUT_COUNT,
        1,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        bytes,
      )
    } finally {
      // Restored on the throwing path too, matching `ensureFrame`. A leaked
      // alignment of 1 is not visibly wrong here and skews the next odd-width
      // plane upload somewhere else entirely.
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4)
    }
    this.lutBytes = bytes
    return this.lutTexture
  }

  private ensureFrame(frame: GridFrame): GpuFrame | null {
    const key = frameCacheKey(frame)
    const cached = this.frames.get(key)
    if (cached && cached.valueKind === frame.valueKind) {
      // Refresh LRU position.
      this.frames.delete(key)
      this.frames.set(key, cached)
      return cached
    }

    const gl = this.gl
    const values = frame.values
    const usable =
      frame.valueKind === 'float32' ? values instanceof Float32Array : values instanceof Uint16Array
    if (!usable) return null

    let valueTexture: WebGLTexture | null = null
    let maskTexture: WebGLTexture | null = null
    try {
      valueTexture = gl.createTexture()
      if (!valueTexture) throw new Error('value texture unavailable')
      gl.bindTexture(gl.TEXTURE_2D, valueTexture)
      setClampNearest(gl)
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
      if (values instanceof Float32Array) {
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.R32F,
          frame.width,
          frame.height,
          0,
          gl.RED,
          gl.FLOAT,
          values,
        )
      } else {
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.R16UI,
          frame.width,
          frame.height,
          0,
          gl.RED_INTEGER,
          gl.UNSIGNED_SHORT,
          values as Uint16Array,
        )
      }

      maskTexture = gl.createTexture()
      if (!maskTexture) throw new Error('mask texture unavailable')
      gl.bindTexture(gl.TEXTURE_2D, maskTexture)
      setClampNearest(gl)
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.R8UI,
        frame.width,
        frame.height,
        0,
        gl.RED_INTEGER,
        gl.UNSIGNED_BYTE,
        frame.mask,
      )
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4)
    } catch {
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4)
      if (valueTexture) gl.deleteTexture(valueTexture)
      if (maskTexture) gl.deleteTexture(maskTexture)
      return null
    }

    if (cached) {
      gl.deleteTexture(cached.values)
      gl.deleteTexture(cached.mask)
      this.frames.delete(key)
    }
    const gpuFrame: GpuFrame = {
      values: valueTexture,
      mask: maskTexture,
      valueKind: frame.valueKind,
    }
    this.frames.set(key, gpuFrame)
    this.evictFrames(key)
    return gpuFrame
  }

  private evictFrames(protectedKey: string): void {
    while (this.frames.size > this.maxGpuFrames) {
      let evicted = false
      for (const key of this.frames.keys()) {
        if (key === protectedKey) continue
        const frame = this.frames.get(key)
        if (!frame) continue
        this.gl.deleteTexture(frame.values)
        this.gl.deleteTexture(frame.mask)
        this.frames.delete(key)
        evicted = true
        break
      }
      if (!evicted) break
    }
  }

  private ensureTarget(width: number, height: number): boolean {
    const gl = this.gl
    if (this.colorTexture && width === this.targetWidth && height === this.targetHeight) return true
    if (this.colorTexture) gl.deleteTexture(this.colorTexture)
    this.colorTexture = null
    const texture = gl.createTexture()
    if (!texture) return false
    gl.bindTexture(gl.TEXTURE_2D, texture)
    setClampNearest(gl)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0)
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      gl.deleteTexture(texture)
      return false
    }
    this.colorTexture = texture
    this.targetWidth = width
    this.targetHeight = height
    const needed = width * height * 4
    if (this.readback.length !== needed) this.readback = new Uint8Array(needed)
    return true
  }

  /**
   * Read the FBO back, flipping rows on the way out.
   *
   * `readPixels` numbers rows from the bottom of the framebuffer and every
   * raster in this package is north-row-first, so the copy walks the source
   * backwards. Skipping the flip does not error — it renders every tile
   * upside down, which on a symmetric-looking field is a genuinely easy thing
   * to miss.
   */
  private readTarget(width: number, height: number): ReferenceRaster {
    const gl = this.gl
    gl.pixelStorei(gl.PACK_ALIGNMENT, 1)
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, this.readback)
    gl.pixelStorei(gl.PACK_ALIGNMENT, 4)
    const pixels = new Uint8ClampedArray(width * height * 4)
    const rowBytes = width * 4
    for (let row = 0; row < height; row += 1) {
      const source = (height - 1 - row) * rowBytes
      pixels.set(this.readback.subarray(source, source + rowBytes), row * rowBytes)
    }
    return { width, height, pixels }
  }
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return false
  }
  return true
}

let sharedRenderer: GridTileRenderer | null = null
let sharedRendererResolved = false

/**
 * The process-wide WebGL2 tile renderer, created on first use.
 *
 * `null` once and `null` forever: a runtime without OffscreenCanvas WebGL2 is
 * not going to grow it, and retrying the context creation per tile is how a
 * fallback path turns into a per-tile allocation storm.
 */
export function sharedGridTileRenderer(): GridTileRenderer | null {
  if (!sharedRendererResolved) {
    sharedRenderer = GridTileRenderer.create()
    sharedRendererResolved = true
  }
  return sharedRenderer
}

/** Release the shared renderer's GPU resources. Mostly for tests and teardown. */
export function destroySharedGridTileRenderer(): void {
  sharedRenderer?.destroy()
  sharedRenderer = null
  sharedRendererResolved = false
}

function rasterToCanvas(raster: ReferenceRaster): OffscreenCanvas {
  if (typeof OffscreenCanvas === 'undefined') {
    throw new TypeError(
      'renderGridTile needs OffscreenCanvas; use referenceRenderGridTile for raw pixels',
    )
  }
  const canvas = new OffscreenCanvas(raster.width, raster.height)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('OffscreenCanvas 2d context unavailable')
  const image = context.createImageData(raster.width, raster.height)
  image.data.set(raster.pixels)
  context.putImageData(image, 0, 0)
  return canvas
}

/**
 * A fully transparent tile, built exactly the way a drawn one is.
 *
 * The shortcut this replaces — `new OffscreenCanvas(side, side)`, never asking
 * for a context — looks equivalent and is not. A canvas whose context mode is
 * still "none" throws `InvalidStateError` from `transferToImageBitmap()`, so a
 * host doing anything beyond `drawImage` would fail on precisely the tiles that
 * happened to be culled and on nothing else. Two shapes of empty tile, told
 * apart by whether an optimization fired, is not a distinction any caller
 * should have to know about.
 */
export function blankTileCanvas(side: number): OffscreenCanvas {
  const width = tileSide({ z: 0, x: 0, y: 0, side })
  return rasterToCanvas({
    width,
    height: width,
    pixels: new Uint8ClampedArray(width * width * 4),
  })
}

/**
 * Bake one tile into an `OffscreenCanvas`.
 *
 * `options.side` is the tile's **pixel** side: a `@2x` request is a 512-pixel
 * tile at the same `z/x/y`, and {@link createGridTileImageSource} is what turns
 * a host's `(side, scale)` pair into that number.
 *
 * Always returns a canvas. A tile that misses the grid, or lands entirely on
 * nodata, comes back fully transparent rather than as `null` — see
 * {@link createGridTileImageSource} for why the difference matters to a host.
 *
 * @throws TypeError for an `rgb` frame (tile baking is scalar-only in v1) or a
 * runtime with no `OffscreenCanvas`.
 * @throws RangeError for a non-positive `side`.
 */
export function renderGridTile(
  source: GridTileSource,
  style: GridStyle,
  options: GridTileRenderOptions,
): OffscreenCanvas {
  const backend = options.backend ?? 'auto'
  if (backend !== 'cpu') {
    const renderer = options.renderer !== undefined ? options.renderer : sharedGridTileRenderer()
    const raster = renderer?.render(source, style, options) ?? null
    if (raster) return rasterToCanvas(raster)
    if (backend === 'webgl2') {
      throw new Error('WebGL2 tile rendering is unavailable in this runtime')
    }
  }
  return rasterToCanvas(referenceRenderGridTile(source, style, options))
}
