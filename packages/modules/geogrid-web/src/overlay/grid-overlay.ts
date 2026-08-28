import {
  valueRangeFromTuple,
  type ColorStop,
  type GridBBox,
  type GridBBoxAnchor,
  type GridFrame,
  type GridSampling,
  type GridScale,
  type GridValueRange,
  type GridViewport,
  type RampStop,
} from '../core/models.js'
import { defaultBBoxAnchor, gridFrameFromScalarDataset } from '../core/frame.js'
import { gridBounds, type GridScalarDataset } from '../core/decode/grid.js'
import type { TemporalRasterFrame } from '../core/decode/temporal.js'
import { createGridBackend } from '../render/factory.js'
import type { GridRenderBackend, GridRenderBackendKind, GridStyle } from '../render/types.js'

export interface GridOverlayStyleInput {
  /** Legacy value-domain stops. Optional now that `rampStops` exists. */
  ramp?: readonly ColorStop[]
  /** Canonical normalized-position stops; wins over `ramp`. */
  rampStops?: readonly RampStop[]
  valueRange: GridValueRange | readonly [number, number]
  scale: GridScale | string
  opacity?: number
  /** Coverage rule at holes and coastlines. Defaults to `soft`. */
  sampling?: GridSampling
}

export interface GridOverlayOptions {
  mode?: 'scalar' | 'rgb'
  prefer?: GridRenderBackendKind
  style: GridOverlayStyleInput
  className?: string
  maxGpuFrames?: number
}

export interface SetScalarFrameOptions {
  /**
   * Geographic extent. Defaults to `gridBounds(dataset.header)`, which spans
   * cell centers — the `/grid` contract's own meaning of extent, and what
   * `header.bbox` carries when the publisher sets it.
   */
  bbox?: GridBBox
  /**
   * What `bbox` measures. Defaults to `cell-center`, matching the default
   * `bbox`. Pass `cell-edge` if you supplied an extent covering the raster's
   * outer edges instead — the two differ by half a cell, which shows up as a
   * coastline that does not quite register.
   */
  anchor?: GridBBoxAnchor
  /** Cache identity; defaults to a content fingerprint of the plane. */
  key?: string
}

export interface GridOverlay {
  element(): HTMLCanvasElement
  backend(): GridRenderBackendKind
  setViewport(viewport: GridViewport | null): void
  setStyle(style: Partial<GridOverlayStyleInput>): void
  setOpacity(opacity: number): void
  /** Single-frame display (static layer / farm). */
  setFrame(frame: TemporalRasterFrame | GridFrame, bbox: GridBBox): void
  /**
   * Display one plane of a decoded `/grid` dataset.
   *
   * The float32 dialect's front door. Nothing is copied: the plane and its mask
   * go to the GPU (or the CPU rasterizer) as decoded.
   */
  setScalarFrame(
    dataset: GridScalarDataset,
    planeIndex?: number,
    options?: SetScalarFrameOptions,
  ): void
  /** Temporal blend (earthdata playback). */
  renderAt(
    lower: TemporalRasterFrame | GridFrame,
    upper: TemporalRasterFrame | GridFrame,
    progress: number,
    bbox: GridBBox,
    anchor?: GridBBoxAnchor,
  ): void
  setCoastlineStencil(image: HTMLCanvasElement | null, stencilBBox: GridBBox | null): void
  destroy(): void
}

function toStyle(input: GridOverlayStyleInput): GridStyle {
  const valueRange: GridValueRange = Array.isArray(input.valueRange)
    ? valueRangeFromTuple(input.valueRange as [number, number])
    : (input.valueRange as GridValueRange)
  return {
    valueRange,
    scale: input.scale,
    ...(input.ramp !== undefined ? { ramp: input.ramp } : {}),
    ...(input.rampStops !== undefined ? { rampStops: input.rampStops } : {}),
    ...(input.opacity !== undefined ? { opacity: input.opacity } : {}),
    ...(input.sampling !== undefined ? { sampling: input.sampling } : {}),
  }
}

interface LastRender {
  lower: TemporalRasterFrame | GridFrame
  upper: TemporalRasterFrame | GridFrame
  progress: number
  bbox: GridBBox
  anchor?: GridBBoxAnchor
}

class GridOverlayImpl implements GridOverlay {
  private readonly backendImpl: GridRenderBackend
  private style: GridStyle
  private lastRender: LastRender | null = null
  private layoutObserver: ResizeObserver | null = null
  private observedParent: Element | null = null
  private destroyed = false

  constructor(options: GridOverlayOptions) {
    this.style = toStyle(options.style)
    this.backendImpl = createGridBackend({
      mode: options.mode ?? 'scalar',
      style: this.style,
      ...(options.prefer !== undefined ? { prefer: options.prefer } : {}),
      ...(options.className !== undefined ? { className: options.className } : {}),
      ...(options.maxGpuFrames !== undefined ? { maxGpuFrames: options.maxGpuFrames } : {}),
    })
  }

  element(): HTMLCanvasElement {
    return this.backendImpl.element()
  }

  backend(): GridRenderBackendKind {
    return this.backendImpl.kind
  }

  setViewport(viewport: GridViewport | null): void {
    this.ensureLayoutObserver()
    this.backendImpl.setViewport(viewport)
    this.repaint()
  }

  setStyle(partial: Partial<GridOverlayStyleInput>): void {
    const merged: GridOverlayStyleInput = {
      valueRange: partial.valueRange ?? this.style.valueRange,
      scale: partial.scale ?? this.style.scale,
      ...pick('ramp', partial.ramp, this.style.ramp),
      ...pick('rampStops', partial.rampStops, this.style.rampStops),
      ...pick('opacity', partial.opacity, this.style.opacity),
      ...pick('sampling', partial.sampling, this.style.sampling),
    }
    this.style = toStyle(merged)
    this.backendImpl.setStyle(this.style)
    this.repaint()
  }

  setOpacity(opacity: number): void {
    this.style = { ...this.style, opacity }
    this.backendImpl.setOpacity(opacity)
  }

  setFrame(frame: TemporalRasterFrame | GridFrame, bbox: GridBBox): void {
    this.renderAt(frame, frame, 0, bbox)
  }

  setScalarFrame(
    dataset: GridScalarDataset,
    planeIndex = 0,
    options: SetScalarFrameOptions = {},
  ): void {
    const frame = gridFrameFromScalarDataset(
      dataset,
      planeIndex,
      options.key !== undefined ? { key: options.key } : {},
    )
    const bbox = options.bbox ?? gridBounds(dataset.header)
    this.renderAt(frame, frame, 0, bbox, options.anchor ?? defaultBBoxAnchor(frame.valueKind))
  }

  renderAt(
    lower: TemporalRasterFrame | GridFrame,
    upper: TemporalRasterFrame | GridFrame,
    progress: number,
    bbox: GridBBox,
    anchor?: GridBBoxAnchor,
  ): void {
    if (this.destroyed) return
    this.ensureLayoutObserver()
    this.lastRender = {
      lower,
      upper,
      progress,
      bbox,
      ...(anchor !== undefined ? { anchor } : {}),
    }
    this.paint(this.lastRender)
  }

  setCoastlineStencil(image: HTMLCanvasElement | null, stencilBBox: GridBBox | null): void {
    this.backendImpl.setCoastlineStencil(image, stencilBBox)
    this.repaint()
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.lastRender = null
    this.layoutObserver?.disconnect()
    this.layoutObserver = null
    this.observedParent = null
    this.backendImpl.destroy()
  }

  private paint(render: LastRender): void {
    this.backendImpl.render({
      lower: render.lower,
      upper: render.upper,
      progress: render.progress,
      bbox: render.bbox,
      ...(render.anchor !== undefined ? { bboxAnchor: render.anchor } : {}),
    })
  }

  private repaint(): void {
    if (!this.lastRender || this.destroyed) return
    this.paint(this.lastRender)
  }

  private ensureLayoutObserver(): void {
    if (typeof ResizeObserver === 'undefined') return
    const parent = this.backendImpl.element().parentElement
    if (!parent || parent === this.observedParent) return
    this.layoutObserver?.disconnect()
    this.observedParent = parent
    this.layoutObserver = new ResizeObserver(() => this.repaint())
    this.layoutObserver.observe(parent)
  }
}

/**
 * Carry an optional field forward without ever writing `undefined` into it,
 * which `exactOptionalPropertyTypes` rejects and which would otherwise turn
 * "not specified" into "explicitly cleared".
 */
function pick<K extends string, V>(
  key: K,
  next: V | undefined,
  current: V | undefined,
): Record<K, V> | Record<string, never> {
  const value = next !== undefined ? next : current
  return value !== undefined ? ({ [key]: value } as Record<K, V>) : {}
}

export function createGridOverlay(options: GridOverlayOptions): GridOverlay {
  return new GridOverlayImpl(options)
}
