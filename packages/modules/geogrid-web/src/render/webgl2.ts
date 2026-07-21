import { isUsableViewport, type GridBBox, type GridViewport } from '../core/models.js'
import type { TemporalRasterFrame } from '../core/decode/temporal.js'
import type {
  CreateBackendOptions,
  GridBackendRenderState,
  GridRenderBackend,
  GridStyle,
} from './types.js'

const MAX_RAMP_STOPS = 16
const DEFAULT_MAX_GPU_FRAMES = 8

interface GpuFrame {
  key: string
  mask: WebGLTexture
  values: WebGLTexture[]
  width: number
  height: number
}

/**
 * WebGL2 backend for compact temporal/static grids.
 * Color mapping, inter-frame blend, masking, and viewport UV happen in one fragment pass.
 */
export class WebGL2GridBackend implements GridRenderBackend {
  readonly kind = 'webgl2' as const
  private readonly canvas: HTMLCanvasElement
  private readonly gl: WebGL2RenderingContext
  private readonly program: WebGLProgram
  private readonly buffer: WebGLBuffer
  private readonly mode: 'scalar' | 'rgb'
  private readonly maxGpuFrames: number
  private readonly frames = new Map<string, GpuFrame>()
  private style: GridStyle
  private viewport: GridViewport | null = null
  private lastGoodViewport: GridViewport | null = null
  private opacity = 0.75
  private canvasWidth = 0
  private canvasHeight = 0
  private stencilTexture: WebGLTexture | null = null
  private stencilBBox: GridBBox | null = null
  private readonly whiteStencil: WebGLTexture
  private readonly stencilUnit = 8
  private destroyed = false

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
    this.program = createProgram(
      gl,
      vertexShader(),
      this.mode === 'rgb' ? rgbFragmentShader() : scalarFragmentShader(),
    )
    const buffer = gl.createBuffer()
    if (!buffer) throw new Error('WebGL buffer unavailable')
    this.buffer = buffer
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    gl.useProgram(this.program)
    const position = gl.getAttribLocation(this.program, 'position')
    if (position < 0) throw new Error('WebGL position attribute unavailable')
    gl.enableVertexAttribArray(position)
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)
    gl.disable(gl.DEPTH_TEST)
    gl.disable(gl.CULL_FACE)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
    const white = gl.createTexture()
    if (!white) throw new Error('WebGL stencil fallback texture unavailable')
    gl.bindTexture(gl.TEXTURE_2D, white)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]))
    this.whiteStencil = white
    this.uploadStyleUniforms()
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
    this.gl.useProgram(this.program)
    this.uploadStyleUniforms()
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
    if (state.lower.renderMode !== this.mode || state.upper.renderMode !== this.mode) return
    const lowerGpu = this.ensureFrame(state.lower, new Set([state.lower.date, state.upper.date]))
    const upperGpu = this.ensureFrame(state.upper, new Set([state.lower.date, state.upper.date]))
    if (!lowerGpu || !upperGpu) return
    this.resize()
    const viewport = isUsableViewport(this.viewport)
      ? this.viewport
      : this.lastGoodViewport
    if (!isUsableViewport(viewport)) return
    if (this.canvasWidth < 1 || this.canvasHeight < 1) return

    const span = viewport.span
    const viewportWest = viewport.center.longitude - span.longitudeDelta / 2
    const viewportNorth = viewport.center.latitude + span.latitudeDelta / 2
    const [west, south, east, north] = state.bbox
    const bboxWidth = Math.max(1e-9, east - west)
    const bboxHeight = Math.max(1e-9, north - south)
    const uvScaleX = span.longitudeDelta / bboxWidth
    const uvScaleY = span.latitudeDelta / bboxHeight
    const uvOffsetX = (viewportWest - west) / bboxWidth
    const uvOffsetY = (north - viewportNorth) / bboxHeight

    const gl = this.gl
    gl.viewport(0, 0, this.canvasWidth, this.canvasHeight)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.useProgram(this.program)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer)
    gl.uniform2f(uniform(gl, this.program, 'uvOffset'), uvOffsetX, uvOffsetY)
    gl.uniform2f(uniform(gl, this.program, 'uvScale'), uvScaleX, uvScaleY)
    gl.uniform1f(
      gl.getUniformLocation(this.program, 'progress'),
      Math.max(0, Math.min(1, state.progress)),
    )
    bindTexture(gl, 0, lowerGpu.values[0]!, uniform(gl, this.program, 'values0'))
    bindTexture(gl, 1, upperGpu.values[0]!, uniform(gl, this.program, 'values1'))
    bindTexture(gl, 2, lowerGpu.mask, uniform(gl, this.program, 'mask0'))
    bindTexture(gl, 3, upperGpu.mask, uniform(gl, this.program, 'mask1'))
    if (this.mode === 'rgb') {
      bindTexture(gl, 4, lowerGpu.values[1]!, uniform(gl, this.program, 'green0'))
      bindTexture(gl, 5, upperGpu.values[1]!, uniform(gl, this.program, 'green1'))
      bindTexture(gl, 6, lowerGpu.values[2]!, uniform(gl, this.program, 'blue0'))
      bindTexture(gl, 7, upperGpu.values[2]!, uniform(gl, this.program, 'blue1'))
    }
    this.bindStencil(viewport)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    for (const frame of this.frames.values()) {
      frame.values.forEach((texture) => this.gl.deleteTexture(texture))
      this.gl.deleteTexture(frame.mask)
    }
    this.frames.clear()
    if (this.stencilTexture) this.gl.deleteTexture(this.stencilTexture)
    this.gl.deleteTexture(this.whiteStencil)
    this.gl.deleteBuffer(this.buffer)
    this.gl.deleteProgram(this.program)
    this.canvas.remove()
  }

  private bindStencil(viewport: GridViewport): void {
    const gl = this.gl
    const hasStencil = Boolean(this.stencilTexture && this.stencilBBox)
    gl.uniform1i(uniform(gl, this.program, 'useStencil'), hasStencil ? 1 : 0)
    if (!hasStencil || !this.stencilTexture || !this.stencilBBox) {
      gl.uniform2f(uniform(gl, this.program, 'stencilUvOffset'), 0, 0)
      gl.uniform2f(uniform(gl, this.program, 'stencilUvScale'), 1, 1)
      bindTexture(gl, this.stencilUnit, this.whiteStencil, uniform(gl, this.program, 'stencil'))
      return
    }
    const span = viewport.span
    const viewportWest = viewport.center.longitude - span.longitudeDelta / 2
    const viewportNorth = viewport.center.latitude + span.latitudeDelta / 2
    const [west, , east, north] = this.stencilBBox
    const south = this.stencilBBox[1]
    const width = Math.max(1e-9, east - west)
    const height = Math.max(1e-9, north - south)
    const uvScaleX = span.longitudeDelta / width
    const uvScaleY = span.latitudeDelta / height
    const uvOffsetX = (viewportWest - west) / width
    const uvOffsetY = (north - viewportNorth) / height
    gl.uniform2f(uniform(gl, this.program, 'stencilUvOffset'), uvOffsetX, uvOffsetY)
    gl.uniform2f(uniform(gl, this.program, 'stencilUvScale'), uvScaleX, uvScaleY)
    bindTexture(gl, this.stencilUnit, this.stencilTexture, uniform(gl, this.program, 'stencil'))
  }

  private ensureFrame(frame: TemporalRasterFrame, protectedDates?: Set<string>): GpuFrame | null {
    const protectedKeys = protectedDates ?? new Set([frame.date])
    protectedKeys.add(frame.date)
    const cached = this.frames.get(frame.date)
    if (cached) {
      // Refresh insertion order for LRU-ish FIFO Map
      this.frames.delete(frame.date)
      this.frames.set(frame.date, cached)
      return cached
    }
    const valuePlanes: Array<Uint16Array | Uint8Array> =
      this.mode === 'rgb'
        ? frame.channels
          ? [...frame.channels]
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
    const textures = valuePlanes.map((data) =>
      this.createTexture(data!, frame.width, frame.height, this.mode === 'rgb'),
    )
    const mask = this.createMaskTexture(frame.mask, frame.width, frame.height)
    if (textures.some((texture) => !texture) || !mask) return null
    const gpuFrame: GpuFrame = {
      key: frame.date,
      mask,
      values: textures as WebGLTexture[],
      width: frame.width,
      height: frame.height,
    }
    this.frames.set(frame.date, gpuFrame)
    this.evictFrames(protectedKeys)
    return gpuFrame
  }

  private createTexture(
    data: Uint16Array | Uint8Array,
    width: number,
    height: number,
    rgb: boolean,
  ): WebGLTexture | null {
    const gl = this.gl
    const texture = gl.createTexture()
    if (!texture) return null
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, rgb ? gl.LINEAR : gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, rgb ? gl.LINEAR : gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    if (rgb) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, width, height, 0, gl.RED, gl.UNSIGNED_BYTE, data as Uint8Array)
    } else {
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.R16UI,
        width,
        height,
        0,
        gl.RED_INTEGER,
        gl.UNSIGNED_SHORT,
        data as Uint16Array,
      )
    }
    return texture
  }

  private createMaskTexture(data: Uint8Array, width: number, height: number): WebGLTexture | null {
    const gl = this.gl
    const texture = gl.createTexture()
    if (!texture) return null
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8UI, width, height, 0, gl.RED_INTEGER, gl.UNSIGNED_BYTE, data)
    return texture
  }

  private evictFrames(protectedDates: Set<string>): void {
    while (this.frames.size > this.maxGpuFrames) {
      let evicted = false
      for (const key of this.frames.keys()) {
        if (protectedDates.has(key)) continue
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

  private uploadStyleUniforms(): void {
    const gl = this.gl
    if (this.mode !== 'scalar') return
    gl.uniform2f(
      uniform(gl, this.program, 'valueRange'),
      this.style.valueRange.lowerBound,
      this.style.valueRange.upperBound,
    )
    gl.uniform1i(uniform(gl, this.program, 'scaleLog'), this.style.scale === 'log' ? 1 : 0)
    const stops = this.style.ramp.slice(0, MAX_RAMP_STOPS)
    gl.uniform1i(uniform(gl, this.program, 'rampCount'), stops.length)
    gl.uniform1fv(
      uniform(gl, this.program, 'rampValues'),
      stops.map((stop) => stop.value),
    )
    gl.uniform3fv(
      uniform(gl, this.program, 'rampColors'),
      stops.flatMap((stop) => [stop.r / 255, stop.g / 255, stop.b / 255]),
    )
  }
}

function uniform(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  name: string,
): WebGLUniformLocation {
  const location = gl.getUniformLocation(program, name)
  if (!location) throw new Error(`WebGL uniform unavailable: ${name}`)
  return location
}

function bindTexture(
  gl: WebGL2RenderingContext,
  unit: number,
  texture: WebGLTexture,
  location: WebGLUniformLocation,
): void {
  gl.activeTexture(gl.TEXTURE0 + unit)
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.uniform1i(location, unit)
}

function createProgram(
  gl: WebGL2RenderingContext,
  vertexSource: string,
  fragmentSource: string,
): WebGLProgram {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexSource)
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource)
  const program = gl.createProgram()
  if (!program) throw new Error('WebGL program unavailable')
  gl.attachShader(program, vertex)
  gl.attachShader(program, fragment)
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) || 'WebGL link failed')
  }
  gl.deleteShader(vertex)
  gl.deleteShader(fragment)
  return program
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

function scalarFragmentShader(): string {
  return `#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;
in vec2 vUv;
uniform usampler2D values0;
uniform usampler2D values1;
uniform usampler2D mask0;
uniform usampler2D mask1;
uniform float progress;
uniform vec2 uvOffset;
uniform vec2 uvScale;
uniform vec2 valueRange;
uniform int scaleLog;
uniform int rampCount;
uniform float rampValues[${MAX_RAMP_STOPS}];
uniform vec3 rampColors[${MAX_RAMP_STOPS}];
${stencilSnippet()}
out vec4 color;

float displayValue(float encoded) {
  float normalized = encoded / 65535.0;
  if (scaleLog == 1 && valueRange.x > 0.0 && valueRange.y > 0.0) {
    return exp2(log2(valueRange.x) + normalized * (log2(valueRange.y) - log2(valueRange.x)));
  }
  return valueRange.x + normalized * (valueRange.y - valueRange.x);
}

vec3 sampleSmooth(usampler2D values, usampler2D mask, vec2 uv) {
  vec2 size = vec2(textureSize(values, 0));
  vec2 pos = uv * size - 0.5;
  vec2 base = floor(pos);
  vec2 f = pos - base;
  float sum = 0.0;
  float weight = 0.0;
  float covSum = 0.0;
  float covTotal = 0.0;
  for (int dy = -1; dy <= 1; dy++) {
    for (int dx = -1; dx <= 1; dx++) {
      ivec2 texel = clamp(ivec2(base) + ivec2(dx, dy), ivec2(0), ivec2(size) - 1);
      vec2 offset = vec2(float(dx), float(dy)) - f;
      float w = max(0.0, 1.5 - abs(offset.x)) * max(0.0, 1.5 - abs(offset.y));
      bool valid = texelFetch(mask, texel, 0).r != uint(0);
      covSum += valid ? w : 0.0;
      covTotal += w;
      if (w > 0.0 && valid) {
        sum += w * float(texelFetch(values, texel, 0).r);
        weight += w;
      }
    }
  }
  return vec3(sum, weight, covSum / max(covTotal, 0.0001));
}

vec3 rampColor(float value) {
  if (rampCount <= 0) return vec3(0.12, 0.39, 0.71);
  if (value <= rampValues[0]) return rampColors[0];
  for (int i = 1; i < ${MAX_RAMP_STOPS}; i++) {
    if (i >= rampCount) break;
    if (value <= rampValues[i]) {
      float t = (value - rampValues[i - 1]) / max(0.0000001, rampValues[i] - rampValues[i - 1]);
      return mix(rampColors[i - 1], rampColors[i], t);
    }
  }
  return rampColors[max(0, rampCount - 1)];
}

void main() {
  vec2 uv = uvOffset + vUv * uvScale;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { color = vec4(0.0); return; }
  vec3 s0 = sampleSmooth(values0, mask0, uv);
  vec3 s1 = sampleSmooth(values1, mask1, uv);
  bool valid0 = s0.y > 0.0;
  bool valid1 = s1.y > 0.0;
  if (!valid0 && !valid1) { color = vec4(0.0); return; }
  float first = valid0 ? displayValue(s0.x / s0.y) : 0.0;
  float second = valid1 ? displayValue(s1.x / s1.y) : 0.0;
  if (!valid0) first = second;
  if (!valid1) second = first;
  float cov0 = valid0 ? s0.z : s1.z;
  float cov1 = valid1 ? s1.z : s0.z;
  float alpha = smoothstep(0.30, 0.70, mix(cov0, cov1, progress)) * stencilAlpha(vUv);
  if (alpha <= 0.0) { color = vec4(0.0); return; }
  color = vec4(rampColor(mix(first, second, progress)), alpha);
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
