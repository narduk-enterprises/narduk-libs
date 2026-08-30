import { toGridFrame, defaultBBoxAnchor, frameCacheKey } from '../core/frame.js'
import { dataUvTransform } from '../core/math.js'
import {
  isUsableViewport,
  type GridBBox,
  type GridFrame,
  type GridValueKind,
  type GridViewport,
} from '../core/models.js'
import {
  bindTexture,
  createProgram,
  rgbFragmentShader,
  scalarFragmentShader,
  setClampNearest,
  vertexShader,
} from './gl.js'
import { RAMP_LUT_COUNT, styleLut, styleSampling } from './style.js'
import type {
  CreateBackendOptions,
  GridBackendRenderState,
  GridRenderBackend,
  GridStyle,
} from './types.js'

const DEFAULT_MAX_GPU_FRAMES = 8

const UNIT_VALUES_0 = 0
const UNIT_VALUES_1 = 1
const UNIT_MASK_0 = 2
const UNIT_MASK_1 = 3
const UNIT_GREEN_0 = 4
const UNIT_GREEN_1 = 5
const UNIT_BLUE_0 = 6
const UNIT_BLUE_1 = 7
const UNIT_STENCIL = 8
const UNIT_LUT = 9

interface GpuFrame {
  key: string
  contentKey: string
  valueKind: GridValueKind
  mask: WebGLTexture
  values: WebGLTexture[]
  width: number
  height: number
}

/**
 * A compiled program plus its uniform locations.
 *
 * There is one per `(mode, valueKind)` because a sampler's type is fixed at
 * compile time: `usampler2D` reads the temporal dialect's `R16UI` planes and
 * `sampler2D` reads the `/grid` dialect's `R32F` planes, and no uniform can
 * switch between them. Compiling lazily means an overlay that only ever shows
 * one dialect only ever pays for one program.
 */
interface Pipeline {
  program: WebGLProgram
  locations: Map<string, WebGLUniformLocation | null>
}

/**
 * WebGL2 backend for compact temporal/static grids.
 *
 * Color mapping, inter-frame blend, masking, coverage, and viewport UV happen
 * in one fragment pass. Scalar and precolored RGB both use the same 2×2
 * mask-aware shape as their CPU reference renderers.
 */
export class WebGL2GridBackend implements GridRenderBackend {
  readonly kind = 'webgl2' as const
  private readonly canvas: HTMLCanvasElement
  private readonly gl: WebGL2RenderingContext
  private readonly buffer: WebGLBuffer
  private readonly mode: 'scalar' | 'rgb'
  private readonly maxGpuFrames: number
  private readonly frames = new Map<string, GpuFrame>()
  private readonly pipelines = new Map<string, Pipeline>()
  private style: GridStyle
  private lutTexture: WebGLTexture | null = null
  private lutDirty = true
  private viewport: GridViewport | null = null
  private lastGoodViewport: GridViewport | null = null
  private opacity = 0.75
  private canvasWidth = 0
  private canvasHeight = 0
  private stencilTexture: WebGLTexture | null = null
  private stencilBBox: GridBBox | null = null
  private readonly whiteStencil: WebGLTexture
  private destroyed = false
  private hasDrawn = false

  static create(options: CreateBackendOptions): WebGL2GridBackend | null {
    if (typeof document === 'undefined') return null
    const canvas = document.createElement('canvas')
    canvas.className = options.className ?? 'temporal-canvas'
    canvas.setAttribute('aria-hidden', 'true')
    const gl = canvas.getContext('webgl2', {
      alpha: true,
      antialias: false,
      premultipliedAlpha: false,
    })
    if (!gl) return null
    try {
      return new WebGL2GridBackend(canvas, gl, options)
    } catch {
      return null
    }
  }

  private constructor(
    canvas: HTMLCanvasElement,
    gl: WebGL2RenderingContext,
    options: CreateBackendOptions,
  ) {
    this.canvas = canvas
    this.gl = gl
    this.mode = options.mode
    this.style = options.style
    this.maxGpuFrames = Math.max(2, options.maxGpuFrames ?? DEFAULT_MAX_GPU_FRAMES)
    this.opacity = options.style.opacity ?? 0.75
    this.canvas.style.opacity = String(this.opacity)
    const buffer = gl.createBuffer()
    if (!buffer) throw new Error('WebGL buffer unavailable')
    this.buffer = buffer
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    gl.disable(gl.DEPTH_TEST)
    gl.disable(gl.CULL_FACE)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
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

  element(): HTMLCanvasElement {
    return this.canvas
  }

  setOpacity(opacity: number): void {
    this.opacity = Math.max(0, Math.min(1, opacity))
    this.canvas.style.opacity = String(this.opacity)
  }

  setViewport(viewport: GridViewport | null): void {
    this.viewport = viewport
    if (isUsableViewport(viewport)) this.lastGoodViewport = viewport
  }

  setStyle(style: GridStyle): void {
    this.style = style
    if (style.opacity !== undefined) this.setOpacity(style.opacity)
    this.lutDirty = true
  }

  setCoastlineStencil(image: HTMLCanvasElement | null, stencilBBox: GridBBox | null): void {
    const gl = this.gl
    if (this.stencilTexture) {
      gl.deleteTexture(this.stencilTexture)
      this.stencilTexture = null
    }
    this.stencilBBox = stencilBBox
    if (!image || !stencilBBox) return
    const texture = gl.createTexture()
    if (!texture) return
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image)
    this.stencilTexture = texture
  }

  render(state: GridBackendRenderState): void {
    if (this.destroyed) return
    const lower = toGridFrame(state.lower)
    const upper = toGridFrame(state.upper)
    if (lower.renderMode !== this.mode || upper.renderMode !== this.mode) {
      this.clearIfDrawn()
      return
    }
    // A blend across dialects has no defined meaning — the two sides are not
    // even in the same units — and no shader can hold both sampler types.
    if (this.mode === 'scalar' && lower.valueKind !== upper.valueKind) {
      this.clearIfDrawn()
      return
    }

    const pipeline = this.pipeline(lower.valueKind)
    if (!pipeline) {
      this.clearIfDrawn()
      return
    }

    const protectedKeys = new Set([lower.key, upper.key])
    const lowerGpu = this.ensureFrame(lower, protectedKeys)
    const upperGpu = this.ensureFrame(upper, protectedKeys)
    if (!lowerGpu || !upperGpu) {
      this.clearIfDrawn()
      return
    }
    this.resize()
    const viewport = isUsableViewport(this.viewport) ? this.viewport : this.lastGoodViewport
    if (!isUsableViewport(viewport) || this.canvasWidth < 1 || this.canvasHeight < 1) {
      this.clearIfDrawn()
      return
    }

    const { uvOffsetX, uvOffsetY, uvScaleX, uvScaleY } = dataUvTransform(viewport, state.bbox)
    const anchor = state.bboxAnchor ?? defaultBBoxAnchor(lower.valueKind)

    const gl = this.gl
    gl.viewport(0, 0, this.canvasWidth, this.canvasHeight)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.useProgram(pipeline.program)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer)
    const position = gl.getAttribLocation(pipeline.program, 'position')
    if (position >= 0) {
      gl.enableVertexAttribArray(position)
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)
    }
    gl.uniform2f(this.uniform(pipeline, 'uvOffset'), uvOffsetX, uvOffsetY)
    gl.uniform2f(this.uniform(pipeline, 'uvScale'), uvScaleX, uvScaleY)
    gl.uniform1i(this.uniform(pipeline, 'anchorCenter'), anchor === 'cell-center' ? 1 : 0)
    gl.uniform1f(this.uniform(pipeline, 'progress'), Math.max(0, Math.min(1, state.progress)))
    gl.uniform1i(
      this.uniform(pipeline, 'coastal'),
      styleSampling(this.style, this.mode) === 'coastal' ? 1 : 0,
    )
    if (this.mode === 'scalar') this.uploadScalarStyle(pipeline)

    bindTexture(gl, UNIT_VALUES_0, lowerGpu.values[0]!, this.uniform(pipeline, 'values0'))
    bindTexture(gl, UNIT_VALUES_1, upperGpu.values[0]!, this.uniform(pipeline, 'values1'))
    bindTexture(gl, UNIT_MASK_0, lowerGpu.mask, this.uniform(pipeline, 'mask0'))
    bindTexture(gl, UNIT_MASK_1, upperGpu.mask, this.uniform(pipeline, 'mask1'))
    if (this.mode === 'rgb') {
      bindTexture(gl, UNIT_GREEN_0, lowerGpu.values[1]!, this.uniform(pipeline, 'green0'))
      bindTexture(gl, UNIT_GREEN_1, upperGpu.values[1]!, this.uniform(pipeline, 'green1'))
      bindTexture(gl, UNIT_BLUE_0, lowerGpu.values[2]!, this.uniform(pipeline, 'blue0'))
      bindTexture(gl, UNIT_BLUE_1, upperGpu.values[2]!, this.uniform(pipeline, 'blue1'))
    }
    this.bindStencil(pipeline, viewport)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    this.hasDrawn = true
  }

  private clearIfDrawn(): void {
    if (!this.hasDrawn || this.destroyed) return
    const gl = this.gl
    gl.viewport(0, 0, Math.max(1, this.canvasWidth), Math.max(1, this.canvasHeight))
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    this.hasDrawn = false
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    for (const frame of this.frames.values()) {
      frame.values.forEach((texture) => this.gl.deleteTexture(texture))
      this.gl.deleteTexture(frame.mask)
    }
    this.frames.clear()
    for (const pipeline of this.pipelines.values()) this.gl.deleteProgram(pipeline.program)
    this.pipelines.clear()
    if (this.lutTexture) this.gl.deleteTexture(this.lutTexture)
    if (this.stencilTexture) this.gl.deleteTexture(this.stencilTexture)
    this.gl.deleteTexture(this.whiteStencil)
    this.gl.deleteBuffer(this.buffer)
    this.canvas.remove()
  }

  private pipeline(valueKind: GridValueKind): Pipeline | null {
    const key = `${this.mode}:${this.mode === 'rgb' ? 'rgb' : valueKind}`
    const cached = this.pipelines.get(key)
    if (cached) return cached
    try {
      const program = createProgram(
        this.gl,
        vertexShader(),
        this.mode === 'rgb' ? rgbFragmentShader() : scalarFragmentShader(valueKind),
      )
      const pipeline: Pipeline = { program, locations: new Map() }
      this.pipelines.set(key, pipeline)
      return pipeline
    } catch {
      return null
    }
  }

  /**
   * `null` is a legitimate answer, not a failure: a driver may optimize out a
   * uniform the shader never reaches, and `gl.uniform*` on a null location is a
   * defined no-op. Throwing here — as this used to — turned a harmless
   * optimizer difference into a dead overlay.
   */
  private uniform(pipeline: Pipeline, name: string): WebGLUniformLocation | null {
    const cached = pipeline.locations.get(name)
    if (cached !== undefined) return cached
    const location = this.gl.getUniformLocation(pipeline.program, name)
    pipeline.locations.set(name, location)
    return location
  }

  private uploadScalarStyle(pipeline: Pipeline): void {
    const gl = this.gl
    gl.uniform2f(
      this.uniform(pipeline, 'valueRange'),
      this.style.valueRange.lowerBound,
      this.style.valueRange.upperBound,
    )
    // Two uniforms because they do two jobs: `valueRange` decodes an
    // `encoded-u16` sample, `displayRange` spreads the ramp. Uploading a
    // stretched range into `valueRange` would mis-decode every wire sample
    // instead of stretching the image.
    const displayRange = this.style.displayRange ?? this.style.valueRange
    gl.uniform2f(
      this.uniform(pipeline, 'displayRange'),
      displayRange.lowerBound,
      displayRange.upperBound,
    )
    gl.uniform1i(this.uniform(pipeline, 'scaleLog'), this.style.scale === 'log' ? 1 : 0)
    bindTexture(gl, UNIT_LUT, this.ensureLut(), this.uniform(pipeline, 'lut'))
  }

  /**
   * The ramp, as a 256×1 RGBA8 texture read with `LINEAR` filtering.
   *
   * This replaces a pair of uniform arrays capped at 16 stops — a cap the CDL
   * ramp already sat exactly on, so the next stop anyone added would have been
   * dropped silently. It also moves interpolation into position space, where
   * the server does it, and carries per-stop alpha, which the `vec3` uniform
   * could not.
   */
  private ensureLut(): WebGLTexture {
    const gl = this.gl
    if (this.lutTexture && !this.lutDirty) return this.lutTexture
    // Claim the LUT's own unit before binding anything. `bindTexture` below
    // would set it, but this method runs first (it is the argument being
    // evaluated), so without this the upload lands on whichever unit the last
    // frame happened to leave active and transiently displaces its texture.
    // Every such unit is rebound before the draw today, so this is guarding the
    // invariant rather than fixing a live bug — but the invariant is one draw
    // -order change away from mattering.
    gl.activeTexture(gl.TEXTURE0 + UNIT_LUT)
    if (!this.lutTexture) {
      const texture = gl.createTexture()
      if (!texture) throw new Error('WebGL LUT texture unavailable')
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
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      RAMP_LUT_COUNT,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      styleLut(this.style),
    )
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4)
    this.lutDirty = false
    return this.lutTexture
  }

  private bindStencil(pipeline: Pipeline, viewport: GridViewport): void {
    const gl = this.gl
    const hasStencil = Boolean(this.stencilTexture && this.stencilBBox)
    gl.uniform1i(this.uniform(pipeline, 'useStencil'), hasStencil ? 1 : 0)
    if (!hasStencil || !this.stencilTexture || !this.stencilBBox) {
      gl.uniform2f(this.uniform(pipeline, 'stencilUvOffset'), 0, 0)
      gl.uniform2f(this.uniform(pipeline, 'stencilUvScale'), 1, 1)
      bindTexture(gl, UNIT_STENCIL, this.whiteStencil, this.uniform(pipeline, 'stencil'))
      return
    }
    const span = viewport.span
    const viewportWest = viewport.center.longitude - span.longitudeDelta / 2
    const viewportNorth = viewport.center.latitude + span.latitudeDelta / 2
    const [west, south, east, north] = this.stencilBBox
    const width = Math.max(1e-9, east - west)
    const height = Math.max(1e-9, north - south)
    gl.uniform2f(
      this.uniform(pipeline, 'stencilUvOffset'),
      (viewportWest - west) / width,
      (north - viewportNorth) / height,
    )
    gl.uniform2f(
      this.uniform(pipeline, 'stencilUvScale'),
      span.longitudeDelta / width,
      span.latitudeDelta / height,
    )
    bindTexture(gl, UNIT_STENCIL, this.stencilTexture, this.uniform(pipeline, 'stencil'))
  }

  private ensureFrame(frame: GridFrame, protectedKeys: Set<string>): GpuFrame | null {
    const contentKey = frameCacheKey(frame)
    const cached = this.frames.get(frame.key)
    if (cached && cached.contentKey === contentKey && cached.valueKind === frame.valueKind) {
      this.frames.delete(frame.key)
      this.frames.set(frame.key, cached)
      return cached
    }
    if (cached) {
      cached.values.forEach((texture) => this.gl.deleteTexture(texture))
      this.gl.deleteTexture(cached.mask)
      this.frames.delete(frame.key)
    }

    const valuePlanes: Array<Uint16Array | Uint8Array | Float32Array> =
      this.mode === 'rgb'
        ? frame.channels
          ? [...frame.channels]
          : []
        : frame.valueKind === 'float32'
          ? frame.values instanceof Float32Array
            ? [frame.values]
            : []
          : frame.values instanceof Uint16Array
            ? [frame.values]
            : []
    if (
      (this.mode === 'rgb' && valuePlanes.length !== 3) ||
      (this.mode === 'scalar' && valuePlanes.length !== 1)
    ) {
      return null
    }

    const textures: WebGLTexture[] = []
    try {
      for (const data of valuePlanes) {
        const texture = this.createTexture(data!, frame.width, frame.height)
        if (!texture) throw new Error('texture create failed')
        textures.push(texture)
      }
      const mask = this.createMaskTexture(frame.mask, frame.width, frame.height)
      if (!mask) throw new Error('mask create failed')
      const gpuFrame: GpuFrame = {
        key: frame.key,
        contentKey,
        valueKind: frame.valueKind,
        mask,
        values: textures,
        width: frame.width,
        height: frame.height,
      }
      this.frames.set(frame.key, gpuFrame)
      this.evictFrames(protectedKeys)
      return gpuFrame
    } catch {
      textures.forEach((texture) => this.gl.deleteTexture(texture))
      return null
    }
  }

  /**
   * Every plane is read with `texelFetch`, which ignores filter state. Spatial
   * interpolation is done by hand so the companion mask can exclude a missing
   * texel before weights are renormalized; hardware bilinear cannot be told to
   * skip one. `NEAREST` makes that ownership explicit and keeps integer/float
   * texture completeness independent of optional filtering extensions.
   */
  private createTexture(
    data: Uint16Array | Uint8Array | Float32Array,
    width: number,
    height: number,
  ): WebGLTexture | null {
    const gl = this.gl
    const texture = gl.createTexture()
    if (!texture) return null
    gl.bindTexture(gl.TEXTURE_2D, texture)
    setClampNearest(gl)
    // Tightly packed plane rows are not 4-byte aligned when width is odd (R16)
    // or width % 4 != 0 (R8). Default UNPACK_ALIGNMENT=4 would skew the texture.
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    if (data instanceof Float32Array) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, width, height, 0, gl.RED, gl.FLOAT, data)
    } else if (data instanceof Uint16Array) {
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.R16UI,
        width,
        height,
        0,
        gl.RED_INTEGER,
        gl.UNSIGNED_SHORT,
        data,
      )
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, width, height, 0, gl.RED, gl.UNSIGNED_BYTE, data)
    }
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4)
    return texture
  }

  private createMaskTexture(data: Uint8Array, width: number, height: number): WebGLTexture | null {
    const gl = this.gl
    const texture = gl.createTexture()
    if (!texture) return null
    gl.bindTexture(gl.TEXTURE_2D, texture)
    setClampNearest(gl)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8UI, width, height, 0, gl.RED_INTEGER, gl.UNSIGNED_BYTE, data)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4)
    return texture
  }

  private evictFrames(protectedKeys: Set<string>): void {
    while (this.frames.size > this.maxGpuFrames) {
      let evicted = false
      for (const key of this.frames.keys()) {
        if (protectedKeys.has(key)) continue
        const frame = this.frames.get(key)
        if (!frame) continue
        frame.values.forEach((texture) => this.gl.deleteTexture(texture))
        this.gl.deleteTexture(frame.mask)
        this.frames.delete(key)
        evicted = true
        break
      }
      if (!evicted) break
    }
  }

  private resize(): void {
    const parent = this.canvas.parentElement
    if (!parent) return
    const rect = parent.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    const width = Math.max(1, Math.round(rect.width * dpr))
    const height = Math.max(1, Math.round(rect.height * dpr))
    if (width === this.canvasWidth && height === this.canvasHeight) return
    this.canvas.width = width
    this.canvas.height = height
    this.canvasWidth = width
    this.canvasHeight = height
    this.canvas.style.width = `${rect.width}px`
    this.canvas.style.height = `${rect.height}px`
  }
}
