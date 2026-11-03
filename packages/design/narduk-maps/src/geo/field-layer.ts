// A MapLibre custom layer that draws tiled frames on the GPU: numeric fields (terrarium, coloured
// through the catalog ramp) or colour pictures. Each tile is decoded from its exact bytes
// (./png.ts) into an RGBA8UI texture read with texelFetch, so there is no browser filtering,
// premultiplication or colour conversion anywhere; the shader does its own bilinear over the texels
// that have data. Playback cross-fades frame a into frame b in one pass, both opaque.
// A tile still loading borrows the nearest loaded ancestor, so panning and zooming never flash.
// A sparse layer (catalog `sparse`) does the same for a tile that does not exist: its finest zooms
// are only where a finer source is, and everywhere else the coarser tile above shows through.

import { bilinear, RAMP_SIZE } from './field'
import { type DecodedImage, decodeImage } from './png'
import {
  intersect,
  mercX,
  mercY,
  type TileId,
  tileKey,
  tilesCovering,
  type TileSource,
  tileZoomFor,
} from './tiles'

import type { CustomLayerInterface, CustomRenderMethodInput, Map as MlMap } from 'maplibre-gl'

const VERT = `#version 300 es
in vec2 a_unit;
uniform mat4 u_matrix;
uniform vec3 u_tile;
out vec2 v_local;
out vec2 v_merc;
void main() {
  v_local = a_unit;
  v_merc = u_tile.xy + a_unit * u_tile.z;
  gl_Position = u_matrix * vec4(v_merc, 0.0, 1.0);
}`

const FRAG = `#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;
in vec2 v_local;
in vec2 v_merc;
uniform usampler2D u_texA;
uniform usampler2D u_texB;
uniform sampler2D u_ramp;
uniform vec3 u_srcA;
uniform vec3 u_srcB;
uniform float u_t;
uniform vec2 u_range;
uniform float u_opacity;
uniform int u_mode;
uniform vec4 u_bbox;
uniform vec4 u_fadeOn;
uniform float u_fadeWidth;
out vec4 fragColor;

float terrarium(uvec4 p) {
  return float(p.r) * 256.0 + float(p.g) + float(p.b) / 256.0 - 32768.0;
}

// Bilinear over the texels that have data. Field mode: x = value, w = coverage.
// Image mode: premultiplied colour.
vec4 sampleTex(usampler2D tex, vec3 src) {
  ivec2 size = textureSize(tex, 0);
  vec2 p = src.xy + v_local * src.z - 0.5;
  vec2 f = fract(p);
  ivec2 i0 = ivec2(floor(p));
  vec4 acc = vec4(0.0);
  float wsum = 0.0;
  for (int j = 0; j < 2; j++) {
    for (int i = 0; i < 2; i++) {
      ivec2 c = clamp(i0 + ivec2(i, j), ivec2(0), size - 1);
      uvec4 px = texelFetch(tex, c, 0);
      float w = (i == 1 ? f.x : 1.0 - f.x) * (j == 1 ? f.y : 1.0 - f.y);
      if (u_mode == 0) {
        float m = px.a > 0u ? 1.0 : 0.0;
        acc.x += w * m * terrarium(px);
        wsum += w * m;
      } else {
        float a = float(px.a) / 255.0;
        acc += w * vec4(vec3(px.rgb) / 255.0 * a, a);
      }
    }
  }
  if (u_mode == 0) return vec4(wsum > 0.0 ? acc.x / wsum : 0.0, 0.0, 0.0, wsum);
  return acc;
}

vec4 fieldColor(vec4 s) {
  float x = clamp((s.x - u_range.x) / (u_range.y - u_range.x), 0.0, 1.0);
  vec4 c = texture(u_ramp, vec2((x * ${(RAMP_SIZE - 1).toFixed(1)} + 0.5) / ${RAMP_SIZE.toFixed(1)}, 0.5));
  // Anti-aliased data edge where coverage crosses one half (the coast, a gap).
  float edge = clamp((s.w - 0.5) / max(fwidth(s.w), 1e-3) + 0.5, 0.0, 1.0);
  float a = c.a * edge;
  return vec4(c.rgb * a, a);
}

void main() {
  vec4 sa = sampleTex(u_texA, u_srcA);
  vec4 sb = sampleTex(u_texB, u_srcB);
  vec4 ca = u_mode == 0 ? fieldColor(sa) : sa;
  vec4 cb = u_mode == 0 ? fieldColor(sb) : sb;
  vec4 c = mix(ca, cb, u_t);
  // Feather the product's own edges (never the edge of the world) instead of a hard cut.
  float fade = 1.0;
  fade *= mix(1.0, smoothstep(u_bbox.x, u_bbox.x + u_fadeWidth, v_merc.x), u_fadeOn.x);
  fade *= mix(1.0, smoothstep(u_bbox.y, u_bbox.y + u_fadeWidth, v_merc.y), u_fadeOn.y);
  fade *= mix(1.0, 1.0 - smoothstep(u_bbox.z - u_fadeWidth, u_bbox.z, v_merc.x), u_fadeOn.z);
  fade *= mix(1.0, 1.0 - smoothstep(u_bbox.w - u_fadeWidth, u_bbox.w, v_merc.y), u_fadeOn.w);
  fragColor = c * fade * u_opacity;
}`

export interface FieldArchive {
  bbox: [number, number, number, number]
  maxZoom: number
  minZoom: number
  source: TileSource
}

export interface FieldLayerOptions {
  bbox: [number, number, number, number]
  /** Each frame is one or more archives (several only for static multi-archive layers). */
  frames: FieldArchive[][]
  maxZoom: number
  minZoom: number
  mode: 'field' | 'image'
  opacity?: number
  /** Field mode: the stored-unit range the ramp spans, and the ramp texels. */
  ramp?: Uint8Array
  range?: [number, number]
  /** An absent tile shows its nearest ancestor (catalog `sparse`); otherwise it is no data. */
  sparse?: boolean
}

type TileState = 'loading' | 'ready' | 'empty' | 'error'

interface Entry {
  abort?: AbortController
  frame: number
  img?: DecodedImage
  retryAt?: number
  state: TileState
  t: TileId
  tex?: WebGLTexture
  used: number
}

interface Resolved {
  entry: Entry
  /** Texel origin and texels per tile-local unit inside the source texture. */
  src: [number, number, number]
  tex?: WebGLTexture
}

const MAX_ACTIVE = 6
const MAX_TILES = typeof window !== 'undefined' && window.innerWidth < 640 ? 160 : 320
const MAX_COVER = 64
const ANCESTORS = 6
const UPLOADS_PER_FRAME = 6
const RETRY_MS = 15_000

let errorsLogged = 0

interface Cover {
  x0: number
  x1: number
  y0: number
  y1: number
  z: number
}

/** The cover's tiles, centre first. */
function coverTiles(c: Cover): TileId[] {
  const cx = (c.x0 + c.x1) / 2
  const cy = (c.y0 + c.y1) / 2
  const tiles: TileId[] = []
  for (let x = c.x0; x <= c.x1; x++) for (let y = c.y0; y <= c.y1; y++) tiles.push({ z: c.z, x, y })
  return tiles.sort((p, q) => Math.hypot(p.x - cx, p.y - cy) - Math.hypot(q.x - cx, q.y - cy))
}

export class FieldLayer implements CustomLayerInterface {
  readonly id: string
  readonly type = 'custom' as const
  readonly renderingMode = '2d' as const

  /** Called (at most once per animation frame) when a tile resolves. */
  onProgress?: () => void
  /** Called after something first reaches the screen. */
  onFirstDraw?: () => void

  private o: FieldLayerOptions
  private map?: MlMap
  private gl?: WebGL2RenderingContext
  private program?: WebGLProgram
  private vao?: WebGLVertexArrayObject
  private vbo?: WebGLBuffer
  private rampTex?: WebGLTexture
  private emptyTex?: WebGLTexture
  private uniforms: Record<string, WebGLUniformLocation | null> = {}
  private entries = new Map<string, Entry>()
  private queue: Array<{ frame: number; t: TileId }> = []
  private active = 0
  private clock = 0
  private draw = { a: 0, b: 0, t: 0 }
  private wanted: number[] = [0]
  private cover?: Cover | null
  private progressRaf = 0
  private drewOnce = false
  private onMove = () => this.update()

  constructor(id: string, o: FieldLayerOptions) {
    this.id = id
    this.o = o
  }

  // ---------- MapLibre lifecycle ----------

  onAdd(map: MlMap, gl: WebGL2RenderingContext | WebGLRenderingContext): void {
    if (!(gl instanceof WebGL2RenderingContext)) throw new Error('WebGL2 is required')
    this.map = map
    this.gl = gl
    const program = gl.createProgram()!
    for (const [type, src] of [
      [gl.VERTEX_SHADER, VERT],
      [gl.FRAGMENT_SHADER, FRAG],
    ] as const) {
      const sh = gl.createShader(type)!
      gl.shaderSource(sh, src)
      gl.compileShader(sh)
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS))
        throw new Error(gl.getShaderInfoLog(sh) ?? 'shader')
      gl.attachShader(program, sh)
    }
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
      throw new Error(gl.getProgramInfoLog(program) ?? 'link')
    this.program = program
    for (const name of [
      'u_matrix',
      'u_tile',
      'u_texA',
      'u_texB',
      'u_ramp',
      'u_srcA',
      'u_srcB',
      'u_t',
      'u_range',
      'u_opacity',
      'u_mode',
      'u_bbox',
      'u_fadeOn',
      'u_fadeWidth',
    ])
      this.uniforms[name] = gl.getUniformLocation(program, name)
    this.vao = gl.createVertexArray()!
    this.vbo = gl.createBuffer()!
    gl.bindVertexArray(this.vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo)
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]),
      gl.STATIC_DRAW,
    )
    const loc = gl.getAttribLocation(program, 'a_unit')
    gl.enableVertexAttribArray(loc)
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
    gl.bindVertexArray(null)
    gl.bindBuffer(gl.ARRAY_BUFFER, null)
    this.emptyTex = this.makeIntTexture(gl, 1, 1, new Uint8Array(4))
    this.rampTex = gl.createTexture()!
    if (this.o.ramp) this.uploadRamp(this.o.ramp)
    map.on('move', this.onMove)
    map.on('resize', this.onMove)
    this.update()
  }

  onRemove(map: MlMap, gl: WebGL2RenderingContext | WebGLRenderingContext): void {
    const g = gl as WebGL2RenderingContext
    map.off('move', this.onMove)
    map.off('resize', this.onMove)
    cancelAnimationFrame(this.progressRaf)
    for (const e of this.entries.values()) {
      e.abort?.abort()
      if (e.tex) g.deleteTexture(e.tex)
    }
    this.entries.clear()
    this.queue = []
    if (this.rampTex) g.deleteTexture(this.rampTex)
    if (this.emptyTex) g.deleteTexture(this.emptyTex)
    if (this.vbo) g.deleteBuffer(this.vbo)
    if (this.vao) g.deleteVertexArray(this.vao)
    if (this.program) g.deleteProgram(this.program)
    this.gl = undefined
    this.map = undefined
  }

  // ---------- Inputs ----------

  /** Frame a under frame b at fraction t; `prefetch` frames are loaded but not drawn. */
  setDraw(a: number, b: number, t: number, prefetch: number[] = []) {
    this.draw = { a, b, t }
    const want = [a, b, ...prefetch].filter(
      (i, k, all) => i >= 0 && i < this.o.frames.length && all.indexOf(i) === k,
    )
    const changed = want.join() !== this.wanted.join()
    this.wanted = want
    if (changed) this.update()
    this.map?.triggerRepaint()
  }

  setOpacity(opacity: number) {
    this.o.opacity = opacity
    this.map?.triggerRepaint()
  }

  /**
   * Field mode: the stored-unit range the ramp spans, changed in place (no tile reload), e.g. a contrast stretch to
   * the values in view. The same colours spread over the new range; a legend should be drawn for it too.
   */
  setRange(range: [number, number]) {
    const [lo, hi] = range
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || !(hi > lo)) return
    this.o.range = [lo, hi]
    this.map?.triggerRepaint()
  }

  /** Every tile the current view needs for frame i has resolved (data, no data, or failed). */
  frameReady(i: number): boolean {
    const c = this.cover
    if (c === undefined) return false
    if (c === null) return true
    for (let x = c.x0; x <= c.x1; x++)
      for (let y = c.y0; y <= c.y1; y++) {
        const e = this.entries.get(this.key(i, { z: c.z, x, y }))
        if (!e || e.state === 'loading') return false
      }
    return true
  }

  /** Bytes of decoded tiles held (CPU copy; the GPU holds the same again). */
  get bytes(): number {
    let n = 0
    for (const e of this.entries.values()) n += e.img?.data.byteLength ?? 0
    return n
  }

  /**
   * The stored value under a point for frame i, from the same texels and bilinear the GPU used.
   * null = no data there; undefined = not loaded yet.
   */
  sample(lng: number, lat: number, frame: number): number | null | undefined {
    const c = this.cover
    if (!c) return c === null ? null : undefined
    const n = 2 ** c.z
    const t = { z: c.z, x: Math.floor(mercX(lng) * n), y: Math.floor(mercY(lat) * n) }
    const r = this.resolve(frame, t)
    if (!r) return undefined
    if (!r.entry.img) return null
    const lx = mercX(lng) * n - t.x
    const ly = mercY(lat) * n - t.y
    const s = bilinear(r.entry.img, r.src[0] + lx * r.src[2], r.src[1] + ly * r.src[2])
    return s.coverage >= 0.5 ? s.value : null
  }

  // ---------- Tiles ----------

  private key(frame: number, t: TileId) {
    return `${frame}|${tileKey(t)}`
  }

  private viewBox(): [number, number, number, number] | null {
    const map = this.map!
    const b = map.getBounds()
    return intersect([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()], this.o.bbox)
  }

  private update() {
    if (!this.map) return
    const box = this.viewBox()
    if (!box) {
      this.cover = null
    } else {
      let z = tileZoomFor(this.map.getZoom(), this.o.minZoom, this.o.maxZoom)
      let c = tilesCovering(box, z)
      while (c && z > this.o.minZoom && (c.x1 - c.x0 + 1) * (c.y1 - c.y0 + 1) > MAX_COVER) {
        z--
        c = tilesCovering(box, z)
      }
      this.cover = c ? { ...c, z } : null
    }
    this.enqueue()
    this.notify()
  }

  private enqueue() {
    const c = this.cover
    const wanted = new Set(this.wanted)
    // Drop work for frames nobody wants any more.
    for (const [k, e] of this.entries) {
      if (e.state === 'loading' && !wanted.has(e.frame)) {
        e.abort?.abort()
        this.entries.delete(k)
      }
    }
    this.queue = []
    if (!c) return
    const tiles = coverTiles(c)
    const now = performance.now()
    for (const frame of this.wanted) {
      // A coarse ancestor first for the frame on screen, so a cold view shows something at once.
      if (frame === this.draw.a) this.enqueueCoarse(frame, tiles, c.z)
      for (const t of tiles) {
        const e = this.entries.get(this.key(frame, t))
        if (!e || (e.state === 'error' && (e.retryAt ?? 0) < now)) this.queue.push({ frame, t })
        else {
          e.used = ++this.clock
          if (e.state === 'empty') this.enqueueParent(frame, t)
        }
      }
    }
    this.pump()
  }

  private enqueueCoarse(frame: number, tiles: TileId[], z: number) {
    const coarse = Math.max(this.o.minZoom, z - 3)
    if (coarse >= z) return
    const s = z - coarse
    const seen = new Set<string>()
    for (const t of tiles) {
      const a = { z: coarse, x: t.x >> s, y: t.y >> s }
      const k = this.key(frame, a)
      if (seen.has(k) || this.entries.has(k)) continue
      seen.add(k)
      this.queue.push({ frame, t: a })
    }
  }

  /**
   * A sparse layer's absent tile asks for the first ancestor not yet requested, which then stands
   * in for it (see resolve); an ancestor that is absent too passes the request further up.
   */
  private enqueueParent(frame: number, t: TileId) {
    if (!this.o.sparse) return
    for (let dz = 1; dz <= ANCESTORS && t.z - dz >= this.o.minZoom; dz++) {
      const a = { z: t.z - dz, x: t.x >> dz, y: t.y >> dz }
      const e = this.entries.get(this.key(frame, a))
      if (!e || (e.state === 'error' && (e.retryAt ?? 0) < performance.now())) {
        if (!this.queue.some(j => j.frame === frame && tileKey(j.t) === tileKey(a)))
          this.queue.push({ frame, t: a })
        return
      }
      if (e.state !== 'empty') return
    }
  }

  private archiveFor(frame: number, t: TileId): FieldArchive | undefined {
    const n = 2 ** t.z
    const w = (t.x / n) * 360 - 180
    const e = ((t.x + 1) / n) * 360 - 180
    const lat = (y: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI
    const box: [number, number, number, number] = [w, lat(t.y + 1), e, lat(t.y)]
    return this.o.frames[frame]?.find(
      a => t.z >= a.minZoom && t.z <= a.maxZoom && intersect(a.bbox, box) !== null,
    )
  }

  private pump() {
    while (this.active < MAX_ACTIVE && this.queue.length) {
      const job = this.queue.shift()!
      const key = this.key(job.frame, job.t)
      const existing = this.entries.get(key)
      if (existing && existing.state !== 'error') continue
      const archive = this.archiveFor(job.frame, job.t)
      if (!archive) {
        this.entries.set(key, { frame: job.frame, t: job.t, state: 'empty', used: ++this.clock })
        this.enqueueParent(job.frame, job.t)
        continue
      }
      const abort = new AbortController()
      const entry: Entry = {
        frame: job.frame,
        t: job.t,
        state: 'loading',
        used: ++this.clock,
        abort,
      }
      this.entries.set(key, entry)
      this.active++
      void this.load(entry, archive.source, abort.signal).finally(() => {
        this.active--
        this.pump()
      })
    }
  }

  private async load(entry: Entry, source: TileSource, signal: AbortSignal) {
    try {
      const data = await source.get(entry.t, signal)
      if (signal.aborted) return
      if (!data || data.byteLength === 0) {
        entry.state = 'empty'
        this.enqueueParent(entry.frame, entry.t)
      } else {
        entry.img = await decodeImage(data)
        entry.state = 'ready'
      }
    } catch (err) {
      if (signal.aborted) return
      entry.state = 'error'
      entry.retryAt = performance.now() + RETRY_MS
      if (errorsLogged++ < 5) console.warn('[narduk-maps] tile', tileKey(entry.t), err)
    }
    entry.abort = undefined
    this.evict()
    this.notify()
    this.map?.triggerRepaint()
  }

  private evict() {
    if (this.entries.size <= MAX_TILES) return
    const wanted = new Set(this.wanted)
    const c = this.cover
    const inView = (e: Entry) =>
      wanted.has(e.frame) &&
      !!c &&
      e.t.z === c.z &&
      e.t.x >= c.x0 &&
      e.t.x <= c.x1 &&
      e.t.y >= c.y0 &&
      e.t.y <= c.y1
    const victims = [...this.entries.entries()]
      .filter(([, e]) => e.state !== 'loading' && !inView(e))
      .sort((p, q) => p[1].used - q[1].used)
    for (const [k, e] of victims.slice(0, this.entries.size - MAX_TILES)) {
      if (e.tex) this.gl?.deleteTexture(e.tex)
      this.entries.delete(k)
    }
  }

  private notify() {
    if (this.progressRaf || !this.onProgress) return
    this.progressRaf = requestAnimationFrame(() => {
      this.progressRaf = 0
      this.onProgress?.()
    })
  }

  /** The loaded tile (or nearest loaded ancestor) that covers t for a frame. */
  private resolve(frame: number, t: TileId): Resolved | null {
    let absent: Entry | undefined
    for (let dz = 0; dz <= ANCESTORS && t.z - dz >= 0; dz++) {
      const a = { z: t.z - dz, x: t.x >> dz, y: t.y >> dz }
      const e = this.entries.get(this.key(frame, a))
      if (!e) continue
      if (e.state === 'empty') {
        // Sparse: an absent tile is not "no data here" while a tile above it may hold some.
        if (this.o.sparse && a.z > this.o.minZoom) {
          absent ??= e
          continue
        }
        return { entry: e, src: [0, 0, 0] }
      }
      if (e.state !== 'ready' || !e.img) continue
      const k = 2 ** dz
      const per = e.img.width / k
      e.used = ++this.clock
      return {
        entry: e,
        tex: e.tex,
        src: [(t.x - a.x * k) * per, (t.y - a.y * k) * per, per],
      }
    }
    // Every ancestor that has resolved is absent too, and none above is still on its way: no data.
    if (absent && !this.pendingAbove(frame, t)) return { entry: absent, src: [0, 0, 0] }
    return null
  }

  /** Whether some ancestor of t (within ANCESTORS, at or above minZoom) is loading, queued or to be retried. */
  private pendingAbove(frame: number, t: TileId): boolean {
    for (let dz = 1; dz <= ANCESTORS && t.z - dz >= this.o.minZoom; dz++) {
      const a = { z: t.z - dz, x: t.x >> dz, y: t.y >> dz }
      const e = this.entries.get(this.key(frame, a))
      if (e?.state === 'loading' || e?.state === 'error') return true
      if (!e && this.queue.some(j => j.frame === frame && tileKey(j.t) === tileKey(a))) return true
    }
    return false
  }

  // ---------- GPU ----------

  private makeIntTexture(gl: WebGL2RenderingContext, w: number, h: number, data: Uint8Array) {
    const tex = gl.createTexture()!
    // A scratch unit: uploads happen mid-draw, and units 0-2 hold the frames and the ramp.
    gl.activeTexture(gl.TEXTURE3)
    gl.bindTexture(gl.TEXTURE_2D, tex)
    // Exact bytes: no flip, no premultiply, tight rows. MapLibre re-applies its own state after a
    // custom layer renders (context.setDirty), so nothing here leaks into its drawing.
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8UI, w, h, 0, gl.RGBA_INTEGER, gl.UNSIGNED_BYTE, data)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.bindTexture(gl.TEXTURE_2D, null)
    return tex
  }

  private uploadRamp(rgba: Uint8Array) {
    const gl = this.gl
    if (!gl || !this.rampTex) return
    gl.activeTexture(gl.TEXTURE3)
    gl.bindTexture(gl.TEXTURE_2D, this.rampTex)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, RAMP_SIZE, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, rgba)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.bindTexture(gl.TEXTURE_2D, null)
  }

  private setFrameUniforms(gl: WebGL2RenderingContext, options: CustomRenderMethodInput) {
    const u = this.uniforms
    gl.uniformMatrix4fv(
      u.u_matrix!,
      false,
      options.defaultProjectionData.mainMatrix as Float32Array,
    )
    gl.uniform1i(u.u_mode!, this.o.mode === 'field' ? 0 : 1)
    gl.uniform1f(u.u_opacity!, this.o.opacity ?? 1)
    const range = this.o.range ?? [0, 1]
    gl.uniform2f(u.u_range!, range[0], range[1])
    const [w, s, e, n] = this.o.bbox
    gl.uniform4f(u.u_bbox!, mercX(w), mercY(n), mercX(e), mercY(s))
    gl.uniform4f(
      u.u_fadeOn!,
      w > -179.9 ? 1 : 0,
      n < 84 ? 1 : 0,
      e < 179.9 ? 1 : 0,
      s > -84 ? 1 : 0,
    )
    gl.uniform1f(u.u_fadeWidth!, Math.min(0.35, (e - w) * 0.03) / 360)
    gl.uniform1i(u.u_texA!, 0)
    gl.uniform1i(u.u_texB!, 1)
    gl.uniform1i(u.u_ramp!, 2)
  }

  private uploads = 0
  private uploadPending = false

  /** The texture for a resolved tile, uploading at most a few per frame so nothing hitches. */
  private texOf(gl: WebGL2RenderingContext, r: Resolved | null): WebGLTexture | undefined {
    if (!r) return undefined
    if (!r.entry.img) return this.emptyTex
    if (!r.entry.tex) {
      if (this.uploads >= UPLOADS_PER_FRAME) {
        this.uploadPending = true
        return undefined
      }
      this.uploads++
      const img = r.entry.img
      r.entry.tex = this.makeIntTexture(gl, img.width, img.height, img.data)
    }
    return r.entry.tex
  }

  private drawTile(gl: WebGL2RenderingContext, tile: TileId): boolean {
    const { a, b } = this.draw
    const ra = this.resolve(a, tile)
    const rb = b === a ? ra : this.resolve(b, tile)
    const ta = this.texOf(gl, ra)
    const tb = this.texOf(gl, rb)
    if (!ta && !tb) return false
    // A frame not loaded yet: show the other alone rather than fading to nothing.
    let t = a === b ? 0 : this.draw.t
    if (!ta) t = 1
    else if (!tb) t = 0
    const u = this.uniforms
    const size = 1 / 2 ** tile.z
    gl.uniform3f(u.u_tile!, tile.x * size, tile.y * size, size)
    gl.uniform3f(u.u_srcA!, ...(ta ? ra!.src : rb!.src))
    gl.uniform3f(u.u_srcB!, ...(tb ? rb!.src : ra!.src))
    gl.uniform1f(u.u_t!, t)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, ta ?? tb!)
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, tb ?? ta!)
    gl.drawArrays(gl.TRIANGLES, 0, 6)
    return true
  }

  render(gl: WebGL2RenderingContext, options: CustomRenderMethodInput): void {
    const c = this.cover
    if (!this.program || !c) return
    gl.useProgram(this.program)
    gl.bindVertexArray(this.vao!)
    this.setFrameUniforms(gl, options)
    gl.activeTexture(gl.TEXTURE2)
    gl.bindTexture(gl.TEXTURE_2D, this.rampTex!)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    this.uploads = 0
    this.uploadPending = false
    let drew = false
    for (const tile of coverTiles(c)) drew = this.drawTile(gl, tile) || drew
    gl.bindVertexArray(null)
    for (const unit of [gl.TEXTURE2, gl.TEXTURE1, gl.TEXTURE0]) {
      gl.activeTexture(unit)
      gl.bindTexture(gl.TEXTURE_2D, null)
    }
    if (this.uploadPending) this.map?.triggerRepaint()
    if (drew && !this.drewOnce) {
      this.drewOnce = true
      this.onFirstDraw?.()
    }
  }
}
