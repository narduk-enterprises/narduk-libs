/** Matches GeoGridKit `GridScale`. */
export type GridScale = 'linear' | 'log'

/** V1 host modes: scalar field + optional precolored RGB. Vector is future. */
export type GridRenderMode = 'scalar' | 'rgb'

/**
 * How a frame's scalar `values` plane is encoded.
 *
 * - `encoded-u16` — the temporal raster dialect: `0…65535` quantized across the
 *   layer's value range, decoded with {@link displayValueFromEncoded}.
 * - `float32` — the `/grid` dialect: raw display units already, missing cells
 *   carried as `NaN` and marked `0` in the companion mask.
 *
 * Meaningless on an `rgb` frame, which carries precolored `channels` instead.
 */
export type GridValueKind = 'encoded-u16' | 'float32'

/**
 * Which coverage rule a mask-aware sampler applies at a hole or a coastline.
 *
 * Both run the same 2×2 bilinear kernel over the finite neighbors only, with
 * the surviving weights renormalized, and differ solely in the alpha reported:
 *
 * - `soft` — a pixel is drawn only where **every** contributing neighbor is
 *   finite, so coverage is 1 or 0. A hole keeps a crisp edge and no pixel is
 *   ever painted out of a partially-invented neighborhood.
 * - `coastal` — coverage is the surviving weight sum, so the edge feathers over
 *   the last half cell instead of ending on a hard step. The *value* is still
 *   built only from real neighbors; only the alpha ramps.
 *
 * These are GeoGridKit's two Metal kernels under the names it gives them.
 * Scalar rendering defaults to `soft`; precolored RGB defaults to `coastal`
 * to retain the Canvas2D fallback's smooth alpha edge without inventing color.
 */
export type GridSampling = 'soft' | 'coastal'

/**
 * What a `bbox` measures against the sample grid — and the half-cell trap it
 * exists to keep out of the renderer.
 *
 * The estate's two grid dialects disagree, and the disagreement is exactly one
 * half cell, which is the sort of error that looks like nothing on a coarse
 * grid and like a misregistered coastline on a fine one:
 *
 * - `cell-edge` — the rectangle covers the raster's outer edges, so `uv = 0`
 *   sits half a cell *before* the first cell's center. The temporal raster
 *   manifest speaks this, and it is what the existing player has always drawn.
 * - `cell-center` — the rectangle spans first cell center to last cell center,
 *   so `uv = 0` **is** the first center. This is the `/grid` contract:
 *   `header.bbox` equals `gridBounds(header)` (the decoder's tests assert it),
 *   and GeoGridKit maps it that way in `scalarFragment`,
 *   `gridPosition = (lon - lon0) / deltaLon`.
 *
 * Defaulted from the frame's {@link GridValueKind} so ordinary callers never
 * have to name it, and overridable because a caller who has computed an edge
 * bbox for a `/grid` dataset is entitled to say so.
 */
export type GridBBoxAnchor = 'cell-center' | 'cell-edge'

/**
 * One renderable grid frame, in either value dialect.
 *
 * The render backends speak this rather than `TemporalRasterFrame` so that a
 * single path serves both the temporal player and a plain `/grid` fetch.
 * A temporal frame converts for free — `gridFrameFromTemporal` is a rename, not
 * a copy — and the backends accept either shape.
 *
 * `key` generalizes the temporal frame's `date`: a `/grid` dataset has no date,
 * and what a GPU cache actually needs to know is "which bytes are these", which
 * {@link frameContentKey} answers for both dialects.
 */
export interface GridFrame {
  key: string
  width: number
  height: number
  renderMode: GridRenderMode
  valueKind: GridValueKind
  values: Uint16Array | Uint8Array | Float32Array
  /** `1` where the cell carries a real value, `0` where it is missing. */
  mask: Uint8Array
  channels?: readonly [Uint8Array, Uint8Array, Uint8Array]
}

/** Matches GeoGridKit `GridValueRange` (array-coded on the wire as [lo, hi]). */
export interface GridValueRange {
  lowerBound: number
  upperBound: number
}

/** [west, south, east, north] degrees. Dateline-crossing bboxes are unsupported in v1. */
export type GridBBox = readonly [west: number, south: number, east: number, north: number]

export interface GridViewport {
  center: { latitude: number; longitude: number }
  span: { latitudeDelta: number; longitudeDelta: number }
}

/**
 * A ramp stop in the canonical model: a **normalized position** in `0…1` and
 * 8-bit RGBA. This is the shape narduk-data's `shared/colorramp.py` stores and
 * samples, and the shape the `./color` subpath's engine speaks throughout.
 *
 * Not to be confused with {@link ColorStop}, which carries a raw data value and
 * belongs to the deprecated `core/color.ts` sampler.
 */
export interface RampStop {
  position: number
  rgba: [r: number, g: number, b: number, a: number]
}

/**
 * A ramp stop keyed by raw data value with separate channel fields.
 *
 * @deprecated Reach for {@link RampStop} and the `./color` subpath. This shape
 * is the input to the legacy `core/color.ts` sampler and is kept working for
 * 0.1.x consumers.
 */
export interface ColorStop {
  value: number
  r: number
  g: number
  b: number
  a?: number
}

export interface ColorRamp {
  id?: string
  stops: readonly ColorStop[]
}

export function valueRangeFromTuple(range: readonly [number, number]): GridValueRange {
  return { lowerBound: range[0], upperBound: range[1] }
}

export function valueRangeToTuple(range: GridValueRange): [number, number] {
  return [range.lowerBound, range.upperBound]
}

export function isUsableViewport(viewport: GridViewport | null | undefined): viewport is GridViewport {
  if (!viewport) return false
  const { latitudeDelta, longitudeDelta } = viewport.span
  return (
    Number.isFinite(viewport.center.latitude) &&
    Number.isFinite(viewport.center.longitude) &&
    Number.isFinite(latitudeDelta) &&
    Number.isFinite(longitudeDelta) &&
    latitudeDelta > 0 &&
    longitudeDelta > 0
  )
}
