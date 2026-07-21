import type { ColorStop, GridBBox, GridScale, GridValueRange, GridViewport } from '../core/models.js'
import type { TemporalRasterFrame } from '../core/decode/temporal.js'

export type GridRenderBackendKind = 'webgl2' | 'canvas2d'

export interface GridStyle {
  ramp: readonly ColorStop[]
  valueRange: GridValueRange
  scale: GridScale | string
  opacity?: number
}

export interface GridBackendRenderState {
  lower: TemporalRasterFrame
  upper: TemporalRasterFrame
  progress: number
  bbox: GridBBox
}

export interface GridRenderBackend {
  kind: GridRenderBackendKind
  element(): HTMLCanvasElement
  setOpacity(opacity: number): void
  setViewport(viewport: GridViewport | null): void
  setStyle(style: GridStyle): void
  setCoastlineStencil(image: HTMLCanvasElement | null, stencilBBox: GridBBox | null): void
  render(state: GridBackendRenderState): void
  destroy(): void
}

export interface CreateBackendOptions {
  mode: 'scalar' | 'rgb'
  style: GridStyle
  className?: string
  maxGpuFrames?: number
}
