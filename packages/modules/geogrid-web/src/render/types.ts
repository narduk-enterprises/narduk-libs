import type {
  ColorStop,
  GridBBox,
  GridBBoxAnchor,
  GridFrame,
  GridSampling,
  GridScale,
  GridValueRange,
  GridViewport,
  RampStop,
} from '../core/models.js'
import type { TemporalRasterFrame } from '../core/decode/temporal.js'

export type GridRenderBackendKind = 'webgl2' | 'canvas2d'

export interface GridStyle {
  /**
   * Legacy stops keyed by raw data value.
   *
   * Now optional: a caller holding canonical stops has no legacy ramp to
   * invent. Still honored, and still the only thing 0.2.x callers pass — it is
   * converted with `normalizeWireStops`, which is what puts a log-scale ramp
   * where the server puts it.
   *
   * @deprecated Prefer {@link GridStyle.rampStops}.
   */
  ramp?: readonly ColorStop[]
  /** Canonical normalized-position stops. Wins over `ramp` when both are set. */
  rampStops?: readonly RampStop[]
  /**
   * The **wire/decode domain**: the range an `encoded-u16` frame was quantized
   * across, and the only range that can decode one back into display units.
   *
   * Never narrow this to stretch the picture. Doing so does not re-spread the
   * ramp, it mis-decodes the data — every sample comes back a different number
   * than the publisher wrote. {@link GridStyle.displayRange} is the stretch.
   */
  valueRange: GridValueRange
  /**
   * The **render stretch**: the range the ramp is spread over. Defaults to
   * {@link GridStyle.valueRange}, so a caller that never sets it renders exactly
   * what it always did.
   *
   * Mirrors GeoGridKit's `GridDatasetDescriptor.displayRange` /
   * `effectiveDisplayRange`. `core/stretch.ts` computes one from the data.
   */
  displayRange?: GridValueRange
  scale: GridScale | string
  opacity?: number
  /**
   * Coverage rule at holes and coastlines. Scalar uses it in both backends and
   * defaults to `soft`. Precolored RGB uses it in WebGL2 and defaults to
   * `coastal`; the Canvas2D RGB fallback retains its premultiplied-alpha image
   * resample regardless of this hint.
   */
  sampling?: GridSampling
}

export interface GridBackendRenderState {
  lower: GridFrame | TemporalRasterFrame
  upper: GridFrame | TemporalRasterFrame
  progress: number
  bbox: GridBBox
  /**
   * What `bbox` measures. Defaults from the frames' value kind — `cell-center`
   * for `float32`, `cell-edge` for the temporal dialect — so existing callers
   * keep the registration they have always had.
   *
   * WebGL2 applies an explicit anchor to scalar and RGB. Canvas2D applies it to
   * its scalar screen-space kernel; its historical RGB image resample remains
   * cell-edge anchored.
   */
  bboxAnchor?: GridBBoxAnchor
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
