// ponytail-5 audit regression tests
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { areaSampleBoundsFromUv } from '../src/core/math.js'
import {
  referenceRenderRgbCompositionTile,
  type ReferenceRgbCompositionLayer,
} from '../src/core/reference-render.js'
import type { GridFrame, RampStop } from '../src/core/models.js'
import { GridTileRenderer, type GridTileLayer } from '../src/tile/baker.js'
import type { GridStyle } from '../src/render/types.js'

describe('geogrid #1: overview buckets drop pixels that lie inside a real cell', () => {
  it('areaSampleBoundsFromUv gives every pixel of a 2x2 grid drawn at 4x4 a non-empty bucket', () => {
    const empty: string[] = []
    for (let py = 0; py < 4; py += 1) {
      for (let px = 0; px < 4; px += 1) {
        const b = areaSampleBoundsFromUv(
          px / 4,
          py / 4,
          (px + 1) / 4,
          (py + 1) / 4,
          2,
          2,
          'cell-edge',
        )
        const area = (b.columnStop - b.columnStart) * (b.rowStop - b.rowStart)
        if (area <= 0) empty.push(`${px},${py}`)
      }
    }
    expect(empty).toEqual([])
  })

  it('renders a one-sided observed 2x2 grid fully opaque at 4x4 with supportModulatesWeight', () => {
    const layer: ReferenceRgbCompositionLayer = {
      baseChannels: [new Uint8Array(4), new Uint8Array(4), new Uint8Array(4)],
      observedChannels: [
        new Uint8Array(4).fill(200),
        new Uint8Array(4).fill(100),
        new Uint8Array(4).fill(50),
      ],
      confidence: new Uint8Array(4).fill(255),
      baseMask: new Uint8Array(4).fill(0),
      observedMask: new Uint8Array(4).fill(1),
      width: 2,
      height: 2,
    }
    const raster = referenceRenderRgbCompositionTile(
      layer,
      { observationWeight: 1, supportModulatesWeight: true, sampling: 'soft' },
      { width: 4, height: 4, anchor: 'cell-edge' },
    )
    const alphas: number[] = []
    for (let i = 3; i < raster.pixels.length; i += 4) alphas.push(raster.pixels[i]!)
    expect(alphas.filter((a) => a === 0).length).toBe(0)
  })
})

// --- geogrid #2: a restored WebGL context keeps serving the previous tile ---------------------
// Minimal stateful WebGL2 fake with spec semantics: after loss+restore every object created
// before the loss is invalid (draw/readPixels through it are INVALID_OPERATION no-ops).

class FakeGl {
  lost = false
  epoch = 0
  drawId = 0
  framePixel = 0
  boundFramebuffer: { epoch: number } | null = null
  usedProgram: { epoch: number } | null = null
  private codes = new Map<string, number>()
  constructor() {
    return new Proxy(this, {
      get: (target, prop: string) => {
        if (prop in target) return (target as never)[prop]
        if (/^[A-Z0-9_]+$/.test(prop)) {
          if (!target.codes.has(prop)) target.codes.set(prop, target.codes.size + 1)
          return target.codes.get(prop)
        }
        return () => {}
      },
    })
  }
  isContextLost() {
    return this.lost
  }
  createBuffer() {
    return { epoch: this.epoch }
  }
  createFramebuffer() {
    return { epoch: this.epoch }
  }
  createTexture() {
    return { epoch: this.epoch }
  }
  createShader() {
    return { epoch: this.epoch }
  }
  createProgram() {
    return { epoch: this.epoch }
  }
  getShaderParameter() {
    return true
  }
  getProgramParameter() {
    return true
  }
  getAttribLocation() {
    return 0
  }
  getUniformLocation() {
    return {}
  }
  getError() {
    return 0
  }
  checkFramebufferStatus() {
    return (this as unknown as Record<string, number>).FRAMEBUFFER_COMPLETE
  }
  bindFramebuffer(_t: number, fb: { epoch: number } | null) {
    this.boundFramebuffer = fb
  }
  useProgram(p: { epoch: number } | null) {
    this.usedProgram = p
  }
  drawArrays() {
    const ok =
      !this.lost &&
      this.boundFramebuffer?.epoch === this.epoch &&
      this.usedProgram?.epoch === this.epoch
    if (ok) this.framePixel = ++this.drawId
  }
  readPixels(
    _x: number,
    _y: number,
    _w: number,
    _h: number,
    _f: number,
    _t: number,
    out: Uint8Array,
  ) {
    if (this.lost || this.boundFramebuffer?.epoch !== this.epoch) return
    out.fill(this.framePixel)
  }
  canvas: { dispatch(type: string): void } | null = null
  loseAndRestore() {
    this.lost = true
    this.canvas?.dispatch('webglcontextlost')
    this.epoch += 1
    this.lost = false
    this.canvas?.dispatch('webglcontextrestored')
  }
}

const GRAY: RampStop[] = [
  { position: 0, rgba: [0, 0, 0, 255] },
  { position: 1, rgba: [255, 255, 255, 255] },
]

function gulfLayer(): GridTileLayer {
  const width = 8
  const frame: GridFrame = {
    key: 'ponytail5',
    width,
    height: width,
    renderMode: 'scalar',
    valueKind: 'float32',
    values: new Float32Array(width * width).fill(3),
    mask: new Uint8Array(width * width).fill(1),
  }
  return { frame, bbox: [-92, 28, -88, 32] }
}

const style: GridStyle = {
  rampStops: GRAY,
  valueRange: { lowerBound: 0, upperBound: 7 },
  scale: 'linear',
}

let fakeGl: FakeGl
const g = globalThis as Record<string, unknown>
let previous: unknown
beforeAll(() => {
  previous = g.OffscreenCanvas
  fakeGl = new FakeGl()
  g.OffscreenCanvas = class {
    width = 1
    height = 1
    private listeners = new Map<string, Array<(e: { preventDefault(): void }) => void>>()
    addEventListener(type: string, fn: (e: { preventDefault(): void }) => void) {
      this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn])
      fakeGl.canvas = this
    }
    dispatch(type: string) {
      for (const fn of this.listeners.get(type) ?? []) fn({ preventDefault() {} })
    }
    getContext() {
      return fakeGl
    }
  }
})
afterAll(() => {
  g.OffscreenCanvas = previous
})

describe('geogrid #2: restored WebGL context', () => {
  it('does not serve the previous tile after the context is lost and restored', () => {
    const renderer = GridTileRenderer.create()
    expect(renderer).not.toBeNull()
    const side = 8
    const first = renderer!.render(gulfLayer(), style, { z: 6, x: 16, y: 26, side })
    expect(first).not.toBeNull()
    const firstByte = first!.pixels[0]!
    expect(firstByte).toBeGreaterThan(0)

    fakeGl.loseAndRestore()
    const second = renderer!.render(gulfLayer(), style, { z: 6, x: 15, y: 26, side })
    // Either fall back to CPU (null) or return freshly drawn pixels; never the first tile's bytes.
    if (second !== null) expect(second.pixels[0]).not.toBe(firstByte)
  })
})
