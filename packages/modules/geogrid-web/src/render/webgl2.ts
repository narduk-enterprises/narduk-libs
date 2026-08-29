import { toGridFrame, defaultBBoxAnchor, frameCacheKey } from '../core/frame.js'
import { dataUvTransform } from '../core/math.js'
import {
  isUsableViewport,
  type GridBBox,
  type GridFrame,
  type GridValueKind,
  type GridViewport,
} from '../core/models.js'
import { RAMP_LUT_COUNT, styleLut } from './style.js'
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
 * in one fragment pass, through the same 2×2 NaN-aware kernel the CPU reference
 * renderer runs.
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
    gl.uniform1i(this.uniform(pipeline, 'coastal'), this.style.sampling === 'coastal' ? 1 : 0)
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
   * `R32F` with `NEAREST` filtering is core WebGL2 and needs no extension:
   * `OES_texture_float_linear` only gates *filtered* reads, and every sample
   * here is a `texelFetch`, which ignores filter state entirely. Filtering is
   * done by hand precisely so a missing neighbor can be skipped — hardware
   * bilinear cannot be told to drop a texel.
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
    // Filtering is per-use, not per-texture-format, and the distinction is load
    // -bearing: the rgb pass samples its color planes with `texture()` and has
    // always relied on hardware `LINEAR` magnification (documented in 0.1.1),
    // while every scalar plane is read with `texelFetch` — which ignores filter
    // state — precisely so a missing neighbor can be skipped by hand. Collapsing
    // both onto `NEAREST` costs truecolor layers their smoothing and shows up as
    // blocky imagery, not as an error.
    // Keyed on the format actually uploaded below, not on the mode alone:
    // `R8` is normalized and filterable, while `R16UI`/`R32F` are not (an
    // integer texture with a LINEAR filter is *incomplete* and samples black,
    // and R32F needs OES_texture_float_linear). Only the rgb pass's `R8` color
    // planes qualify.
    const filterable = this.mode === 'rgb' && data instanceof Uint8Array
    setClampFilter(gl, filterable ? gl.LINEAR : gl.NEAREST)
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

function setClampFilter(gl: WebGL2RenderingContext, filter: number): void {
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
}

function setClampNearest(gl: WebGL2RenderingContext): void {
  setClampFilter(gl, gl.NEAREST)
}

function bindTexture(
  gl: WebGL2RenderingContext,
  unit: number,
  texture: WebGLTexture,
  location: WebGLUniformLocation | null,
): void {
  gl.activeTexture(gl.TEXTURE0 + unit)
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.uniform1i(location, unit)
}

/**
 * Compile and link, leaking nothing on the failure paths.
 *
 * `pipeline()` swallows the throw and falls back to drawing nothing, so a
 * shader that fails to compile on some driver would otherwise leak a shader
 * object — and its sibling, and possibly the program — on every single render
 * attempt, for as long as the overlay lives.
 */
function createProgram(
  gl: WebGL2RenderingContext,
  vertexSource: string,
  fragmentSource: string,
): WebGLProgram {
  let vertex: WebGLShader | null = null
  let fragment: WebGLShader | null = null
  let program: WebGLProgram | null = null
  try {
    vertex = compileShader(gl, gl.VERTEX_SHADER, vertexSource)
    fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource)
    program = gl.createProgram()
    if (!program) throw new Error('WebGL program unavailable')
    gl.attachShader(program, vertex)
    gl.attachShader(program, fragment)
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(program) || 'WebGL link failed'
      gl.deleteProgram(program)
      program = null
      throw new Error(log)
    }
    return program
  } catch (error: unknown) {
    if (program) gl.deleteProgram(program)
    throw error
  } finally {
    // Safe once attached: deletion is deferred until the program releases them.
    if (vertex) gl.deleteShader(vertex)
    if (fragment) gl.deleteShader(fragment)
  }
}

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)
  if (!shader) throw new Error('WebGL shader unavailable')
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader) || 'WebGL compile failed')
  }
  return shader
}

function vertexShader(): string {
  return `#version 300 es
in vec2 position;
out vec2 vUv;
void main() {
  vUv = vec2((position.x + 1.0) * 0.5, (1.0 - position.y) * 0.5);
  gl_Position = vec4(position, 0.0, 1.0);
}`
}

function stencilSnippet(): string {
  return `
uniform sampler2D stencil;
uniform int useStencil;
uniform vec2 stencilUvOffset;
uniform vec2 stencilUvScale;

float stencilAlpha(vec2 screenUv) {
  if (useStencil == 0) return 1.0;
  vec2 suv = stencilUvOffset + screenUv * stencilUvScale;
  if (suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0) return 0.0;
  return texture(stencil, suv).a;
}
`
}

/**
 * The scalar pass, in whichever value dialect the frames arrived in.
 *
 * The only textual difference between the two variants is the sampler type;
 * `float(texelFetch(...).r)` is well-formed for both a `uint` and a `float`
 * channel, and `displayValue` is the identity for `float32` because those
 * samples are already in display units.
 */
/**
 * The scalar fragment source, exported so its **structure** can be asserted.
 *
 * There is no GL context in a Node test and this package takes no dependency to
 * invent one, so the alternative to a structural check is no check at all — and
 * the thing most worth checking is exactly the thing a reviewer cannot see by
 * reading: whether this shader normalizes over `displayRange` while decoding
 * over `valueRange`, and whether it guards both the way the CPU reference does.
 * `tests/display-range-render.test.ts` asserts that. Full pixel parity against a
 * real GPU remains the browser leg's job.
 *
 * Not re-exported from the package barrel: this is a seam for the repository's
 * own tests, not API.
 */
export function scalarFragmentShader(valueKind: GridValueKind): string {
  const float32 = valueKind === 'float32'
  const sampler = float32 ? 'sampler2D' : 'usampler2D'
  const decode = float32
    ? `float displayValue(float raw) { return raw; }`
    : `float displayValue(float encoded) {
  float normalized = encoded / 65535.0;
  if (scaleLog == 1 && valueRange.x > 0.0 && valueRange.y > 0.0) {
    return exp2(log2(valueRange.x) + normalized * (log2(valueRange.y) - log2(valueRange.x)));
  }
  return valueRange.x + normalized * (valueRange.y - valueRange.x);
}`

  return `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
precision highp usampler2D;
in vec2 vUv;
uniform ${sampler} values0;
uniform ${sampler} values1;
uniform usampler2D mask0;
uniform usampler2D mask1;
uniform sampler2D lut;
uniform float progress;
uniform vec2 uvOffset;
uniform vec2 uvScale;
uniform vec2 valueRange;
uniform vec2 displayRange;
uniform int scaleLog;
uniform int coastal;
uniform int anchorCenter;
${stencilSnippet()}
out vec4 color;

${decode}

/** uv -> texel-center space; the two anchors differ by exactly half a cell. */
vec2 gridPosition(vec2 uv, vec2 size) {
  return anchorCenter == 1 ? uv * (size - 1.0) : uv * size - 0.5;
}

/**
 * The 2x2 NaN-aware kernel. Literal port of GeoGridKit's
 * sampleScalarBilinearSoft / sampleScalarBilinearCoastal.
 *
 * A missing texel is skipped rather than substituted, and the surviving weights
 * are renormalized. The mask decides, never isnan(): under fast-math several
 * drivers fold x != x to false, and every hole would then sample as garbage.
 * Note the value is never even read for a masked-out texel, so a NaN in an R32F
 * plane cannot leak into the sum through a zero weight.
 *
 * Returns vec3(value, coverage, weightSum).
 */
vec3 sampleScalar(${sampler} values, usampler2D mask, vec2 pos) {
  vec2 size = vec2(textureSize(values, 0));
  vec2 maxPos = size - 1.0;
  vec2 p = clamp(pos, vec2(0.0), maxPos);
  vec2 base = floor(p);
  vec2 f = p - base;
  ivec2 i0 = ivec2(base);
  ivec2 i1 = ivec2(min(base + 1.0, maxPos));

  float w[4];
  w[0] = (1.0 - f.x) * (1.0 - f.y);
  w[1] = f.x * (1.0 - f.y);
  w[2] = (1.0 - f.x) * f.y;
  w[3] = f.x * f.y;
  ivec2 texels[4];
  texels[0] = ivec2(i0.x, i0.y);
  texels[1] = ivec2(i1.x, i0.y);
  texels[2] = ivec2(i0.x, i1.y);
  texels[3] = ivec2(i1.x, i1.y);

  float valueSum = 0.0;
  float weightSum = 0.0;
  float missingWeight = 0.0;
  for (int i = 0; i < 4; i++) {
    if (w[i] <= 0.0) continue;
    if (texelFetch(mask, texels[i], 0).r != uint(0)) {
      valueSum += w[i] * float(texelFetch(values, texels[i], 0).r);
      weightSum += w[i];
    } else {
      missingWeight += w[i];
    }
  }
  if (weightSum <= 0.0) return vec3(0.0);
  float cov = coastal == 1 ? weightSum : (missingWeight > 0.0 ? 0.0 : 1.0);
  return vec3(valueSum / weightSum, cov, weightSum);
}

/**
 * Port of normalizedScalar; -1.0 stands for "outside the sampling domain".
 *
 * Normalizes over displayRange, never valueRange -- the stretch is a render
 * decision and the wire domain has already done its one job in displayValue
 * above. Both are guarded, and both collapse onto the same numbers on an
 * unstretched layer, so the CPU reference's twin guard stays a mirror.
 * (No backticks in here: this whole shader lives inside a template literal.)
 */
float normalizedScalar(float value) {
  // Negated less-than rather than greater-or-equal, so a NaN bound is rejected
  // too: every comparison against NaN is false, so !(x < y) is true where
  // x >= y is false. An inverted range used to fall straight through here and
  // render the ramp backwards. The CPU guard is written the same way, on
  // purpose, so both paths agree on a corrupt range rather than one painting.
  if (!(valueRange.x < valueRange.y)) return -1.0;
  if (!(displayRange.x < displayRange.y)) return -1.0;
  if (scaleLog == 1) {
    if (value <= 0.0 || displayRange.x <= 0.0 || displayRange.y <= 0.0) return -1.0;
    return clamp(
      (log2(value) - log2(displayRange.x)) / (log2(displayRange.y) - log2(displayRange.x)),
      0.0,
      1.0);
  }
  return clamp((value - displayRange.x) / (displayRange.y - displayRange.x), 0.0, 1.0);
}

void main() {
  vec2 uv = uvOffset + vUv * uvScale;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { color = vec4(0.0); return; }
  vec3 s0 = sampleScalar(values0, mask0, gridPosition(uv, vec2(textureSize(values0, 0))));
  vec3 s1 = sampleScalar(values1, mask1, gridPosition(uv, vec2(textureSize(values1, 0))));
  bool valid0 = s0.y > 0.0;
  bool valid1 = s1.y > 0.0;
  if (!valid0 && !valid1) { color = vec4(0.0); return; }

  // Blend in sample space (encoded for the u16 dialect, display units for
  // float32), then decode once — the log wire quantization is only linear there.
  float raw0 = valid0 ? s0.x : s1.x;
  float raw1 = valid1 ? s1.x : s0.x;
  float normalized = normalizedScalar(displayValue(mix(raw0, raw1, progress)));
  // Negated, so a NaN is caught: NaN < 0.0 is false and would otherwise let a
  // NaN through to index the LUT. The mask prevents that for any frame this
  // package decoded, but GridFrame is a public type -- a caller can hand over a
  // mask claiming a NaN cell is real, and clamp() on a NaN is not defined to
  // rescue it. Costs one token and needs no isnan().
  if (!(normalized >= 0.0)) { color = vec4(0.0); return; }

  float cov0 = valid0 ? s0.y : s1.y;
  float cov1 = valid1 ? s1.y : s0.y;
  float coverage = mix(cov0, cov1, progress);
  if (coastal == 1) coverage = smoothstep(0.0, 0.55, coverage);

  vec4 ramp = texture(lut, vec2(normalized, 0.5));
  float alpha = ramp.a * coverage * stencilAlpha(vUv);
  if (alpha <= 0.0) { color = vec4(0.0); return; }
  color = vec4(ramp.rgb, alpha);
}`
}

function rgbFragmentShader(): string {
  return `#version 300 es
precision highp float;
precision highp usampler2D;
in vec2 vUv;
uniform sampler2D values0;
uniform sampler2D values1;
uniform usampler2D mask0;
uniform usampler2D mask1;
uniform sampler2D green0;
uniform sampler2D green1;
uniform sampler2D blue0;
uniform sampler2D blue1;
uniform float progress;
uniform vec2 uvOffset;
uniform vec2 uvScale;
${stencilSnippet()}
out vec4 color;

vec3 rgbAt(sampler2D r, sampler2D g, sampler2D b, vec2 uv) {
  return vec3(texture(r, uv).r, texture(g, uv).r, texture(b, uv).r);
}

void main() {
  vec2 uv = uvOffset + vUv * uvScale;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { color = vec4(0.0); return; }
  bool valid0 = texture(mask0, uv).r != uint(0);
  bool valid1 = texture(mask1, uv).r != uint(0);
  if (!valid0 && !valid1) { color = vec4(0.0); return; }
  vec3 first = rgbAt(values0, green0, blue0, uv);
  vec3 second = rgbAt(values1, green1, blue1, uv);
  if (!valid0) first = second;
  if (!valid1) second = first;
  float alpha = stencilAlpha(vUv);
  if (alpha <= 0.0) { color = vec4(0.0); return; }
  color = vec4(mix(first, second, progress), alpha);
}`
}
