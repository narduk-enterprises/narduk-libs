import {
  valueRangeFromTuple,
  type ColorStop,
  type GridBBox,
  type GridScale,
  type GridValueRange,
  type GridViewport,
} from '../core/models.js'
import type { TemporalRasterFrame } from '../core/decode/temporal.js'
import { createGridBackend } from '../render/factory.js'
import type { GridRenderBackend, GridRenderBackendKind, GridStyle } from '../render/types.js'

export interface GridOverlayStyleInput {
  ramp: readonly ColorStop[]
  valueRange: GridValueRange | readonly [number, number]
  scale: GridScale | string
  opacity?: number
}

export interface GridOverlayOptions {
  mode?: 'scalar' | 'rgb'
  prefer?: GridRenderBackendKind
  style: GridOverlayStyleInput
  className?: string
  maxGpuFrames?: number
}

export interface GridOverlay {
  element(): HTMLCanvasElement
  backend(): GridRenderBackendKind
  setViewport(viewport: GridViewport | null): void
  setStyle(style: Partial<GridOverlayStyleInput>): void
  setOpacity(opacity: number): void
  /** Single-frame display (static layer / farm). */
  setFrame(frame: TemporalRasterFrame, bbox: GridBBox): void
  /** Temporal blend (earthdata playback). */
  renderAt(
    lower: TemporalRasterFrame,
    upper: TemporalRasterFrame,
    progress: number,
    bbox: GridBBox,
  ): void
  setCoastlineStencil(image: HTMLCanvasElement | null, stencilBBox: GridBBox | null): void
  destroy(): void
}

function toStyle(input: GridOverlayStyleInput): GridStyle {
  const valueRange: GridValueRange = Array.isArray(input.valueRange)
    ? valueRangeFromTuple(input.valueRange as [number, number])
    : (input.valueRange as GridValueRange)
  return {
    ramp: input.ramp,
    valueRange,
    scale: input.scale,
    ...(input.opacity !== undefined ? { opacity: input.opacity } : {}),
  }
}

class GridOverlayImpl implements GridOverlay {
  private readonly backendImpl: GridRenderBackend
  private style: GridStyle
  private lastRender: {
    lower: TemporalRasterFrame
    upper: TemporalRasterFrame
    progress: number
    bbox: GridBBox
  } | null = null
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
      ramp: partial.ramp ?? this.style.ramp,
      valueRange: partial.valueRange ?? this.style.valueRange,
      scale: partial.scale ?? this.style.scale,
      ...(partial.opacity !== undefined
        ? { opacity: partial.opacity }
        : this.style.opacity !== undefined
          ? { opacity: this.style.opacity }
          : {}),
    }
    this.style = toStyle(merged)
    this.backendImpl.setStyle(this.style)
    this.repaint()
  }

  setOpacity(opacity: number): void {
    this.style = { ...this.style, opacity }
    this.backendImpl.setOpacity(opacity)
  }

  setFrame(frame: TemporalRasterFrame, bbox: GridBBox): void {
    this.renderAt(frame, frame, 0, bbox)
  }

  renderAt(
    lower: TemporalRasterFrame,
    upper: TemporalRasterFrame,
    progress: number,
    bbox: GridBBox,
  ): void {
    if (this.destroyed) return
    this.ensureLayoutObserver()
    this.lastRender = { lower, upper, progress, bbox }
    this.backendImpl.render({ lower, upper, progress, bbox })
  }

  setCoastlineStencil(image: HTMLCanvasElement | null, stencilBBox: GridBBox | null): void {
    this.backendImpl.setCoastlineStencil(image, stencilBBox)
    this.repaint()
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.layoutObserver?.disconnect()
    this.layoutObserver = null
    this.observedParent = null
    this.backendImpl.destroy()
  }

  private repaint(): void {
    if (!this.lastRender || this.destroyed) return
    this.backendImpl.render(this.lastRender)
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

export function createGridOverlay(options: GridOverlayOptions): GridOverlay {
  return new GridOverlayImpl(options)
}
