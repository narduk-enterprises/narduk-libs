import { gridBounds, type GridBinaryHeader, type GridScalarDataset } from './decode/grid.js'
import { viewportLatitudeFrame } from './math.js'
import type { GridBBox, GridBBoxAnchor, GridScale, GridValueRange, GridViewport } from './models.js'

/**
 * Dynamic display range — the *render* stretch, held apart from the wire domain.
 *
 * ## The distinction this module exists to keep
 *
 * A layer has two ranges and they are not the same thing:
 *
 * - **`valueRange`** is the **wire/decode domain**. It is what the publisher
 *   quantized an `encoded-u16` frame across, so it is the only range that can
 *   decode one back into display units. Narrowing it to "make the image pop"
 *   does not stretch the picture, it *mis-decodes the data*: every sample comes
 *   back as a different number than the publisher wrote. That failure mode is
 *   verified, not hypothetical — it is why this module exists rather than a
 *   one-line "just set valueRange" in the overlay.
 * - **`displayRange`** is the **render stretch**: the range the ramp is spread
 *   over. It defaults to `valueRange`, so a caller who never touches it sees
 *   exactly what it always saw.
 *
 * ## Cross-platform pin
 *
 * This is a mirror of GeoGridKit `Sources/GeoGridCore/Stretch.swift`
 * (`GridRangeStretch` + `GridStretchCalculator`, merged in GeoGridKit#19,
 * `b13d61d`). The four pinned properties, and the reason each is spelled the way
 * it is:
 *
 * 1. *Candidate cells* are the cells whose **centers** fall inside the
 *    intersection of the requested viewport and the grid's own bounds. Cell
 *    `(column, row)` has center `(lon0 + column * dx, lat0 + row * dy)`.
 * 2. *Stride subsampling* is deterministic, never random:
 *    `stride = max(1, ceil(sqrt(candidateCount / 65536)))`, applied on **both**
 *    axes. The square root is what makes the two-axis reading the only
 *    self-consistent one — it caps the sample population near 65536 cells.
 *    Striding one axis only would halve nothing and would disagree with Swift.
 * 3. *Percentiles* are Hyndman–Fan **type 7**, which is numpy's default:
 *    `r = p/100 * (n - 1)`, `i = floor(r)`, `f = r - i`,
 *    `v[i] + f * (v[i+1] - v[i])` over the ascending finite samples.
 * 4. *Padding* is applied in the **normalized space of the layer's own scale**:
 *    linearly for `linear` layers, in log space for `log` layers, so a 5% pad on
 *    a log layer widens by 5% of the decade span rather than 5% of the
 *    arithmetic span.
 *
 * Change one side only by changing both.
 */

/** Sample-population ceiling that sets the subsampling stride. */
export const GRID_STRETCH_TARGET_SAMPLE_COUNT = 65_536
/** Below this many finite samples a computed range is reported `insufficient`. */
export const GRID_STRETCH_MINIMUM_SAMPLE_COUNT = 4
export const GRID_STRETCH_DEFAULT_LOW_PERCENTILE = 2
export const GRID_STRETCH_DEFAULT_HIGH_PERCENTILE = 98

/** Display over the descriptor's own `valueRange` — no stretch at all. */
export interface GridFixedStretch {
  mode: 'fixed'
}

/** Display over an operator-chosen range. */
export interface GridManualStretch {
  mode: 'manual'
  range: GridValueRange
}

/** Display over the min/max of the sampled cells in the viewport. */
export interface GridViewportMinMaxStretch {
  mode: 'viewport-minmax'
  /** Fraction of the range's own span to widen by, in the layer's scale. Default `0`. */
  pad?: number
}

/** Display over the `lo`/`hi` percentiles of the sampled cells in the viewport. */
export interface GridViewportPercentileStretch {
  mode: 'viewport-percentile'
  lo: number
  hi: number
  /** Fraction of the range's own span to widen by, in the layer's scale. Default `0`. */
  pad?: number
}

/**
 * Display over the `lo`/`hi` percentiles of the **whole date's grid**.
 *
 * Deliberately viewport-independent, which is what makes it the stretch to pick
 * when a range must not move as the operator pans. See
 * {@link GridStretchInput.dateStatistics} for the server-published shortcut.
 */
export interface GridDatePercentileStretch {
  mode: 'date-percentile'
  lo: number
  hi: number
}

/** Mirror of GeoGridKit's `GridRangeStretch` enum. */
export type GridRangeStretch =
  | GridFixedStretch
  | GridManualStretch
  | GridViewportMinMaxStretch
  | GridViewportPercentileStretch
  | GridDatePercentileStretch

/** How much of the candidate cell population actually backed a computed range. */
export type GridStretchTier =
  /** Every candidate cell in the viewport∩grid intersection was read (stride 1). */
  | 'exact'
  /** The candidate population exceeded the sample target, so a deterministic
   * stride subsample backed the statistic. */
  | 'subsampled'
  /** Too few finite samples to produce a usable range; the caller should fall
   * back to the layer's `valueRange`. */
  | 'insufficient'

export interface GridStretchResult {
  range: GridValueRange
  tier: GridStretchTier
  sampleCount: number
}

/** One entry of a server-published percentile table for a date. */
export interface GridPercentileStat {
  percent: number
  value: number
}

export interface GridStretchInput {
  dataset: GridScalarDataset
  /**
   * `[west, south, east, north]`. `null`/omitted falls back to the grid's own
   * bounds, matching Swift's `viewport ?? dataset.header.bounds`.
   */
  viewport?: GridBBox | null
  /** The layer's own scale. Decides the space padding is applied in. */
  scale: GridScale
  planeIndex?: number
  /** Where the cells sit, when it is not what the header says. */
  geometry?: GridSampleGeometry
  /**
   * A percentile table the server published for this date, already parsed.
   *
   * Only `date-percentile` reads it, and only when the table carries **both**
   * requested percentiles exactly; otherwise the whole-grid scan runs, which is
   * what GeoGridKit does unconditionally. narduk-data publishes no such table
   * on `/grid` today (checked against `earth_data_pipeline` at 2026-08-28), so
   * this path is inert unless a caller supplies one — the wire shape, when one
   * exists, is the caller's business rather than this package's.
   */
  dateStatistics?: readonly GridPercentileStat[]
}

/** The estate default viewport stretch: 2nd–98th percentile, no padding. */
export function defaultViewportPercentileStretch(pad = 0): GridViewportPercentileStretch {
  return {
    mode: 'viewport-percentile',
    lo: GRID_STRETCH_DEFAULT_LOW_PERCENTILE,
    hi: GRID_STRETCH_DEFAULT_HIGH_PERCENTILE,
    pad,
  }
}

/**
 * `max(1, ceil(sqrt(count / 65536)))`, and it is applied to **both** axes.
 *
 * Stated as the literal formula, ceiling included: a candidate population one
 * cell over the target strides by 2. Rounding that edge down would be a silent
 * divergence from the Swift original for no benefit.
 */
export function stretchStride(candidateCount: number): number {
  if (!(candidateCount > 0)) return 1
  const raw = Math.ceil(Math.sqrt(candidateCount / GRID_STRETCH_TARGET_SAMPLE_COUNT))
  if (!Number.isFinite(raw) || !(raw > 1)) return 1
  return raw
}

/**
 * Hyndman–Fan type 7 quantile of an **ascending** sample.
 *
 * The caller sorts. That is the Swift contract too (`percentile(sorted:percent:)`),
 * and it is load-bearing for the sampler, which sorts once and probes twice.
 *
 * ## A `NaN` percentile is documented, not pinned
 *
 * The clamp below is written as two comparisons rather than as Swift's
 * `percent.clamped(to: 0 ... 100)`, and the two disagree on a `NaN` *percent*:
 * every comparison against `NaN` is false, so this returns the sample's last
 * element, while Swift's `clamped` is not specified for a value that is
 * unordered with respect to both bounds. Nothing in either codebase can produce
 * a `NaN` percent — the stretch modes carry literal numbers — so this is a
 * divergence on unreachable input, recorded here rather than papered over with a
 * guard that would suggest it were reachable. A `NaN` *sample* cannot occur
 * either: {@link sampleGridValues} drops non-finite cells before sorting.
 */
export function percentileHF7(sorted: ArrayLike<number>, percent: number): number {
  const count = sorted.length
  if (count < 1) return Number.NaN
  const first = sorted[0] as number
  if (count < 2) return first
  const last = sorted[count - 1] as number

  const clampedPercent = percent < 0 ? 0 : percent > 100 ? 100 : percent
  const rank = (clampedPercent / 100) * (count - 1)
  const lowerIndex = Math.floor(rank)
  if (!(lowerIndex < count - 1)) return last
  const fraction = rank - lowerIndex
  const lowerValue = sorted[lowerIndex] as number
  return lowerValue + fraction * ((sorted[lowerIndex + 1] as number) - lowerValue)
}

/**
 * Widen a range by `pad` (a fraction of its own span) in the normalized space of
 * `scale`. A non-positive pad, or a log pad on a non-positive range, returns the
 * range untouched.
 *
 * Natural `log`/`exp` rather than the `log10` the color engine is pinned to.
 * The two are algebraically identical here — the base cancels, because `pad` is
 * a fraction of the span in the same base — and choosing Swift's operand order
 * and Swift's base is the closest this can get to it.
 *
 * "Closest", not "identical": `log` and `exp` are transcendental, and V8's
 * implementations are not required to agree with the platform libm Swift links
 * bit for bit. A padded bound can therefore differ from Swift's in the last few
 * ULP. That is inside every tolerance either side asserts, and it is the reason
 * the padding parity table is checked to 1e-12 rather than to equality — the
 * closed-form structure is pinned, the last bit of a transcendental is not.
 */
export function paddedRange(range: GridValueRange, pad: number, scale: GridScale): GridValueRange {
  const { lowerBound, upperBound } = range
  if (!(pad > 0) || !Number.isFinite(lowerBound) || !Number.isFinite(upperBound)) return range
  if (scale === 'log') {
    if (!(lowerBound > 0) || !(upperBound > 0)) return range
    const lowerLog = Math.log(lowerBound)
    const upperLog = Math.log(upperBound)
    const span = upperLog - lowerLog
    if (!(span > 0)) return range
    return {
      lowerBound: Math.exp(lowerLog - span * pad),
      upperBound: Math.exp(upperLog + span * pad),
    }
  }
  const span = upperBound - lowerBound
  if (!(span > 0)) return range
  return { lowerBound: lowerBound - span * pad, upperBound: upperBound + span * pad }
}

/** {@link paddedRange}, carrying a result's tier and sample count through. */
export function paddedResult(
  result: GridStretchResult,
  pad: number,
  scale: GridScale,
): GridStretchResult {
  return { ...result, range: paddedRange(result.range, pad, scale) }
}

/** An inclusive index range on one grid axis. */
export interface GridIndexRange {
  lower: number
  upper: number
}

/**
 * Inclusive index range of the cells whose **centers** fall within
 * `lowerBound…upperBound` on one axis, or `null` when none do.
 *
 * `center(index) = origin + index * delta`, so the two coordinate bounds map to
 * two index bounds whose order flips with the sign of `delta` — which every real
 * grid has on the latitude axis, since rows run north to south.
 */
export function gridIndexRange(
  origin: number,
  delta: number,
  count: number,
  lowerBound: number,
  upperBound: number,
): GridIndexRange | null {
  if (
    !(count > 0) ||
    delta === 0 ||
    !Number.isFinite(delta) ||
    !Number.isFinite(origin) ||
    !Number.isFinite(lowerBound) ||
    !Number.isFinite(upperBound) ||
    !(lowerBound <= upperBound)
  ) {
    return null
  }

  const firstEdge = (lowerBound - origin) / delta
  const secondEdge = (upperBound - origin) / delta
  const lowEdge = Math.min(firstEdge, secondEdge)
  const highEdge = Math.max(firstEdge, secondEdge)

  const lower = Math.max(0, Math.ceil(lowEdge))
  const upper = Math.min(count - 1, Math.floor(highEdge))
  if (!(lower <= upper)) return null
  return { lower, upper }
}

export interface GridSample {
  /** The finite values of the stride-subsampled candidate cells, unsorted. */
  values: number[]
  /** The per-axis stride that produced them. */
  stride: number
}

/**
 * Where a grid's cells sit on the globe: `center(col, row) = (lon0 + col * dx,
 * lat0 + row * dy)`.
 *
 * Normally read straight off the header. It is separable because a renderer may
 * be told to place the same plane somewhere else — `setScalarFrame`'s `bbox`
 * option exists precisely for that — and a stretch sampled through the header
 * while the picture is drawn through an override is sampling a different
 * rectangle than the operator is looking at. The error is unbounded in the size
 * of the override, and invisible: the stretch still returns a plausible range,
 * just of the wrong cells.
 */
export interface GridSampleGeometry {
  lon0: number
  lat0: number
  dx: number
  dy: number
}

/** The geometry a decoded grid declares for itself. */
export function headerSampleGeometry(header: GridBinaryHeader): GridSampleGeometry {
  return { lon0: header.lon0, lat0: header.lat0, dx: header.dx, dy: header.dy }
}

/**
 * The geometry implied by placing a `width * height` plane inside `bounds`.
 *
 * `cell-center` spans first center to last center, so the step divides `count - 1`
 * gaps; `cell-edge` covers the outer edges, so it divides `count` cells and the
 * first center sits half a step inside. Getting that wrong is the same half-cell
 * misregistration {@link GridBBoxAnchor} exists to keep out of the renderer.
 *
 * A single-cell axis has no step to derive — every rectangle is consistent with
 * it — so the fallback keeps whatever the header declared rather than inventing
 * a zero, which `gridIndexRange` would reject outright.
 */
export function boundsSampleGeometry(
  bounds: GridBBox,
  width: number,
  height: number,
  anchor: GridBBoxAnchor,
  fallback: GridSampleGeometry,
): GridSampleGeometry {
  const [west, south, east, north] = bounds
  const centerAnchored = anchor === 'cell-center'
  const lonSpan = east - west
  const latSpan = south - north
  const dx = centerAnchored ? lonSpan / Math.max(1, width - 1) : lonSpan / Math.max(1, width)
  const dy = centerAnchored ? latSpan / Math.max(1, height - 1) : latSpan / Math.max(1, height)
  const usableX = width > 1 && Number.isFinite(dx) && dx !== 0
  const usableY = height > 1 && Number.isFinite(dy) && dy !== 0
  return {
    lon0: usableX ? (centerAnchored ? west : west + dx / 2) : fallback.lon0,
    lat0: usableY ? (centerAnchored ? north : north + dy / 2) : fallback.lat0,
    dx: usableX ? dx : fallback.dx,
    dy: usableY ? dy : fallback.dy,
  }
}

/** The cell-center extent a geometry covers — the twin of `gridBounds`. */
export function sampleGeometryBounds(
  geometry: GridSampleGeometry,
  width: number,
  height: number,
): GridBBox {
  const lastLon = geometry.lon0 + Math.max(width - 1, 0) * geometry.dx
  const lastLat = geometry.lat0 + Math.max(height - 1, 0) * geometry.dy
  return [
    Math.min(geometry.lon0, lastLon),
    Math.min(geometry.lat0, lastLat),
    Math.max(geometry.lon0, lastLon),
    Math.max(geometry.lat0, lastLat),
  ]
}

/**
 * Collect the finite values of the stride-subsampled candidate cells.
 *
 * `null` when the viewport misses the grid entirely, the plane is absent or
 * mis-shaped, or every candidate cell is a gap.
 *
 * ## The one place this is not a literal port
 *
 * Swift's sampler tests `value.isFinite` and nothing else, because GeoGridKit's
 * decoder never honors a numeric `nodata` sentinel — `GridHeader.missing` is a
 * `String` it stores and never applies. This decoder *does* honor one: the
 * per-plane `mask` is `0` both for `NaN` and for a cell equal to a numeric
 * sentinel the publisher named. Consulting the mask is therefore identical to
 * Swift on every grid whose `missing` is `NaN` (which is what the estate's
 * publishers write, and what `parseMissing` defaults to), and strictly more
 * correct on one that names a real sentinel — a sentinel like `-9999` would
 * otherwise drag a percentile floor to a number nobody measured.
 *
 * The mask is therefore **required**, not advisory: a plane without a
 * same-length mask samples as nothing at all rather than falling back to a bare
 * `isFinite` test. `decodeGridBinary` always builds one, so this only bites a
 * caller assembling a `GridScalarDataset` by hand — and for that caller, "you
 * forgot the mask" is a better answer than a silently different gap rule.
 *
 * @param geometry Where the cells sit, when it is not what the header says.
 * See {@link GridSampleGeometry}.
 */
export function sampleGridValues(
  dataset: GridScalarDataset,
  bbox: GridBBox,
  planeIndex = 0,
  geometry?: GridSampleGeometry,
): GridSample | null {
  const { header, planes, masks } = dataset
  const plane = planes[planeIndex]
  const mask = masks[planeIndex]
  const cellCount = header.width * header.height
  if (!plane || !mask || plane.length !== cellCount || mask.length !== cellCount) return null

  const place = geometry ?? headerSampleGeometry(header)
  const [west, south, east, north] = bbox
  const columns = gridIndexRange(place.lon0, place.dx, header.width, west, east)
  const rows = gridIndexRange(place.lat0, place.dy, header.height, south, north)
  if (!columns || !rows) return null

  const candidateCount = (columns.upper - columns.lower + 1) * (rows.upper - rows.lower + 1)
  const stride = stretchStride(candidateCount)
  const values: number[] = []

  for (let row = rows.lower; row <= rows.upper; row += stride) {
    const rowOffset = row * header.width
    for (let column = columns.lower; column <= columns.upper; column += stride) {
      const index = rowOffset + column
      if (!mask[index]) continue
      const value = plane[index] as number
      if (Number.isFinite(value)) values.push(value)
    }
  }

  if (values.length === 0) return null
  return { values, stride }
}

function tierFor(
  sampleCount: number,
  stride: number,
  lowerBound: number,
  upperBound: number,
): GridStretchTier {
  if (sampleCount < GRID_STRETCH_MINIMUM_SAMPLE_COUNT || !(upperBound > lowerBound)) {
    return 'insufficient'
  }
  return stride > 1 ? 'subsampled' : 'exact'
}

export interface GridPercentileOptions {
  low?: number
  high?: number
  planeIndex?: number
  /** Where the cells sit, when it is not what the header says. */
  geometry?: GridSampleGeometry
}

/** Hyndman–Fan type 7 percentiles of the sampled cells in `bbox`. */
export function gridPercentiles(
  dataset: GridScalarDataset,
  bbox: GridBBox,
  options: GridPercentileOptions = {},
): GridStretchResult | null {
  const low = options.low ?? GRID_STRETCH_DEFAULT_LOW_PERCENTILE
  const high = options.high ?? GRID_STRETCH_DEFAULT_HIGH_PERCENTILE
  const sample = sampleGridValues(dataset, bbox, options.planeIndex ?? 0, options.geometry)
  if (!sample) return null

  const sorted = sample.values.sort(ascending)
  const lowerBound = percentileHF7(sorted, Math.min(low, high))
  const upperBound = percentileHF7(sorted, Math.max(low, high))
  return {
    range: { lowerBound, upperBound },
    tier: tierFor(sorted.length, sample.stride, lowerBound, upperBound),
    sampleCount: sorted.length,
  }
}

/** Min/max of the sampled cells in `bbox`, on the same sampling contract. */
export function gridExtremes(
  dataset: GridScalarDataset,
  bbox: GridBBox,
  planeIndex = 0,
  geometry?: GridSampleGeometry,
): GridStretchResult | null {
  const sample = sampleGridValues(dataset, bbox, planeIndex, geometry)
  if (!sample) return null

  // Reduced rather than `Math.min(...values)`: the spread form blows the
  // argument-count limit and throws a RangeError somewhere past ~100k samples,
  // and the sample ceiling is 65536 *per axis pair* — one viewport short of it.
  let lowerBound = Number.POSITIVE_INFINITY
  let upperBound = Number.NEGATIVE_INFINITY
  for (const value of sample.values) {
    if (value < lowerBound) lowerBound = value
    if (value > upperBound) upperBound = value
  }
  return {
    range: { lowerBound, upperBound },
    tier: tierFor(sample.values.length, sample.stride, lowerBound, upperBound),
    sampleCount: sample.values.length,
  }
}

function ascending(a: number, b: number): number {
  return a - b
}

function statAt(stats: readonly GridPercentileStat[], percent: number): number | null {
  for (const stat of stats) {
    if (stat.percent === percent && Number.isFinite(stat.value)) return stat.value
  }
  return null
}

/**
 * Resolve a stretch to a concrete display range.
 *
 * `null` when the stretch needs data it cannot get — `fixed`, or a data-driven
 * stretch with no candidate cells. The caller then keeps the layer's own
 * `valueRange`, which is also what a returned `insufficient` tier asks for.
 */
export function stretchDisplayRange(
  stretch: GridRangeStretch,
  input: GridStretchInput,
): GridStretchResult | null {
  const { dataset, scale } = input
  const planeIndex = input.planeIndex ?? 0
  const geometry = input.geometry
  // The grid's own extent, measured through the geometry actually in force —
  // otherwise a caller who relocated the plane gets a viewport-less fallback
  // rectangle that names cells the renderer is not drawing.
  const gridBBox = geometry
    ? sampleGeometryBounds(geometry, dataset.header.width, dataset.header.height)
    : gridBounds(dataset.header)

  switch (stretch.mode) {
    case 'fixed':
      return null
    case 'manual':
      return { range: stretch.range, tier: 'exact', sampleCount: 0 }
    case 'viewport-minmax': {
      const result = gridExtremes(dataset, input.viewport ?? gridBBox, planeIndex, geometry)
      return result ? paddedResult(result, stretch.pad ?? 0, scale) : null
    }
    case 'viewport-percentile': {
      const result = gridPercentiles(dataset, input.viewport ?? gridBBox, {
        low: stretch.lo,
        high: stretch.hi,
        planeIndex,
        ...(geometry !== undefined ? { geometry } : {}),
      })
      return result ? paddedResult(result, stretch.pad ?? 0, scale) : null
    }
    case 'date-percentile': {
      const stats = input.dateStatistics
      if (stats && stats.length > 0) {
        const lowerBound = statAt(stats, Math.min(stretch.lo, stretch.hi))
        const upperBound = statAt(stats, Math.max(stretch.lo, stretch.hi))
        if (lowerBound !== null && upperBound !== null) {
          // A published table can be wrong. An inverted or zero-width pair is
          // reported `insufficient` — the same answer a degenerate scan gets —
          // so the caller falls back to `valueRange` instead of the renderer
          // blanking the layer on a bad row someone else wrote.
          return {
            range: { lowerBound, upperBound },
            tier: upperBound > lowerBound ? 'exact' : 'insufficient',
            sampleCount: 0,
          }
        }
      }
      // No published table, or one that does not carry both requested
      // percentiles: read the whole date's grid, which is what Swift does
      // unconditionally. The viewport is deliberately ignored on this path.
      return gridPercentiles(dataset, gridBBox, {
        low: stretch.lo,
        high: stretch.hi,
        planeIndex,
        ...(geometry !== undefined ? { geometry } : {}),
      })
    }
  }
}

/**
 * A viewport's own `[west, south, east, north]` rectangle.
 *
 * The north and south edges are the ones a Web-Mercator basemap shows. The
 * host's centre is the Mercator midpoint of the view, so they are not
 * `centre ± latitudeDelta / 2` (narduk-libs#930).
 */
export function viewportBBox(viewport: GridViewport): GridBBox {
  const halfLon = viewport.span.longitudeDelta / 2
  const { north, south } = viewportLatitudeFrame(viewport)
  return [viewport.center.longitude - halfLon, south, viewport.center.longitude + halfLon, north]
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

/** Debounce applied to viewport-driven recomputes, in milliseconds. */
export const GRID_STRETCH_DEBOUNCE_MS = 250
/**
 * Hysteresis threshold: a viewport recompute is applied only when an endpoint
 * moves more than this fraction of the **current** display span.
 */
export const GRID_STRETCH_HYSTERESIS = 0.02

/** What prompted a display range to change. */
export type GridStretchReason = 'stretch' | 'viewport' | 'source' | 'style' | 'playback'

export interface GridDisplayRangeMeta {
  tier: GridStretchTier
  sampleCount: number
  stretch: GridRangeStretch
  reason: GridStretchReason
  /**
   * `true` when no usable stretch is in force and the layer's own `valueRange`
   * is what the reported range is.
   */
  fallback: boolean
}

export type GridDisplayRangeListener = (range: GridValueRange, meta: GridDisplayRangeMeta) => void

/** The data a stretch is computed from. */
export interface GridStretchSource {
  dataset: GridScalarDataset
  planeIndex?: number
  /**
   * The extent the renderer is actually placing this plane in, when that is not
   * `gridBounds(header)`. Supply it whenever the render bbox was overridden, or
   * the stretch samples a different rectangle than the operator is looking at.
   */
  bounds?: GridBBox
  /** What {@link GridStretchSource.bounds} measures. Defaults to `cell-center`. */
  anchor?: GridBBoxAnchor
  dateStatistics?: readonly GridPercentileStat[]
}

export interface GridStretchControllerOptions {
  /** The layer's wire domain — the fallback whenever a stretch yields nothing. */
  valueRange: GridValueRange
  scale: GridScale
  stretch?: GridRangeStretch | null
  /** Defaults to {@link GRID_STRETCH_DEBOUNCE_MS}. */
  debounceMs?: number
  /** Defaults to {@link GRID_STRETCH_HYSTERESIS}. */
  hysteresis?: number
  /** Injection seam for tests and non-DOM hosts. Defaults to the global timers. */
  timers?: GridStretchTimers
}

export interface GridStretchTimers {
  setTimeout: (handler: () => void, timeout: number) => unknown
  clearTimeout: (handle: unknown) => void
}

const FIXED_STRETCH: GridFixedStretch = { mode: 'fixed' }

/**
 * The viewport-idle recompute loop, held apart from the DOM so it can be tested.
 *
 * `GridOverlay` owns one of these and wires its own viewport, frames, and style
 * into it; nothing here touches a canvas, a `ResizeObserver`, or a GL context.
 *
 * ## The three behaviors that are not obvious, and why each is there
 *
 * - **250 ms debounce.** A recompute walks tens of thousands of cells. Doing
 *   that on every frame of a pan turns a smooth gesture into a slideshow, so it
 *   runs when the viewport goes idle instead.
 * - **2% hysteresis.** Even at idle, a percentile over a moving sample wanders
 *   by fractions of a percent. Applying every wander repaints the layer and
 *   makes the colors visibly breathe while the operator holds still, so a
 *   viewport-driven range is applied only when an endpoint actually moves.
 *   An explicit `setStretch`, a new frame, or a style change bypasses it — those
 *   are the operator or the data asking, not drift.
 * - **Frozen during playback.** A stretch recomputed per animation frame makes
 *   the ramp itself animate, which is exactly the illusion of change the
 *   pipeline refuses to publish: the colors move while the data does not.
 *   Everything requested during playback — a viewport move, a new frame, even
 *   an explicit `setStretch` — is deferred and applied on pause.
 */
export class GridStretchController {
  private valueRange: GridValueRange
  private scale: GridScale
  private stretch: GridRangeStretch
  private readonly debounceMs: number
  private readonly hysteresis: number
  private readonly timers: GridStretchTimers

  private source: GridStretchSource | null = null
  private viewport: GridBBox | null = null
  private playing = false
  private pendingReason: GridStretchReason | null = null
  private timer: unknown = null
  private applied: GridStretchResult | null = null
  private readonly listeners = new Set<GridDisplayRangeListener>()
  private destroyed = false

  constructor(options: GridStretchControllerOptions) {
    this.valueRange = options.valueRange
    this.scale = options.scale
    this.stretch = options.stretch ?? FIXED_STRETCH
    this.debounceMs = options.debounceMs ?? GRID_STRETCH_DEBOUNCE_MS
    this.hysteresis = options.hysteresis ?? GRID_STRETCH_HYSTERESIS
    this.timers = options.timers ?? {
      setTimeout: (handler, timeout) => globalThis.setTimeout(handler, timeout),
      clearTimeout: (handle) => {
        globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>)
      },
    }
  }

  /** The stretch currently in force. */
  currentStretch(): GridRangeStretch {
    return this.stretch
  }

  /**
   * The computed display range, or `null` when the layer's own `valueRange` is
   * what the renderer should stretch over.
   */
  currentDisplayRange(): GridValueRange | null {
    return this.applied ? this.applied.range : null
  }

  /** The full result behind {@link currentDisplayRange}, tier and sample count included. */
  currentResult(): GridStretchResult | null {
    return this.applied
  }

  /** The range actually in force: the computed stretch, or the wire domain. */
  effectiveDisplayRange(): GridValueRange {
    return this.applied ? this.applied.range : this.valueRange
  }

  onDisplayRangeChange(listener: GridDisplayRangeListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  setStretch(stretch: GridRangeStretch | null): void {
    if (this.destroyed) return
    this.stretch = stretch ?? FIXED_STRETCH
    this.request('stretch')
  }

  setSource(source: GridStretchSource | null): void {
    if (this.destroyed) return
    this.source = source
    this.request('source')
  }

  setViewport(bbox: GridBBox | null): void {
    if (this.destroyed) return
    this.viewport = bbox
    this.request('viewport')
  }

  setStyle(valueRange: GridValueRange, scale: GridScale): void {
    if (this.destroyed) return
    const unchanged =
      valueRange.lowerBound === this.valueRange.lowerBound &&
      valueRange.upperBound === this.valueRange.upperBound &&
      scale === this.scale
    this.valueRange = valueRange
    this.scale = scale
    if (unchanged) return
    this.request('style')
  }

  /**
   * Freeze or thaw the stretch.
   *
   * Going to `true` cancels any scheduled recompute; going back to `false`
   * runs whatever was requested while frozen, immediately and without
   * hysteresis, because the operator has stopped and is now looking at it.
   */
  setPlaying(playing: boolean): void {
    if (this.destroyed || playing === this.playing) return
    this.playing = playing
    if (playing) {
      // A pan that has not finished debouncing yet is still a request. Dropping
      // the timer without recording it lost that request forever — pan, hit play
      // inside 250 ms, pause, and the range never recomputed, silently
      // contradicting the freeze contract this method documents.
      if (this.timer !== null && this.pendingReason === null) this.pendingReason = 'viewport'
      this.cancelTimer()
      return
    }
    if (this.pendingReason !== null) {
      const reason = this.pendingReason
      this.pendingReason = null
      this.recompute(reason === 'viewport' ? 'playback' : reason, false)
    }
  }

  /** Run a scheduled recompute now. Exposed for tests and for explicit flushes. */
  flush(): void {
    if (this.destroyed || this.timer === null) return
    this.cancelTimer()
    this.recompute('viewport', true)
  }

  destroy(): void {
    this.destroyed = true
    this.cancelTimer()
    this.listeners.clear()
    this.source = null
    // Otherwise `currentDisplayRange()` keeps reporting a range computed from a
    // dataset this controller has let go of — a stale answer that reads exactly
    // like a live one.
    this.applied = null
    this.pendingReason = null
  }

  private request(reason: GridStretchReason): void {
    if (this.playing) {
      // `viewport` is the only reason that can lose. A pan made during playback
      // must not outrank — or mislabel — an explicit request made after it, and
      // between two explicit requests the later one is what was actually asked
      // for.
      if (reason !== 'viewport' || this.pendingReason === null) {
        this.pendingReason = reason
      }
      return
    }
    if (reason === 'viewport') {
      this.cancelTimer()
      this.timer = this.timers.setTimeout(() => {
        this.timer = null
        this.recompute('viewport', true)
      }, this.debounceMs)
      return
    }
    // An explicit change supersedes a debounced pan rather than racing it.
    this.cancelTimer()
    this.recompute(reason, false)
  }

  private cancelTimer(): void {
    if (this.timer === null) return
    this.timers.clearTimeout(this.timer)
    this.timer = null
  }

  /**
   * The stretch's answer for the current source, viewport, and scale.
   *
   * `manual` is answered before the source is consulted, because it does not
   * need one — Swift's dispatch takes a dataset and ignores it for that case,
   * and requiring one here would mean an operator-set range could not take
   * effect until a frame happened to arrive.
   */
  private resolve(): GridStretchResult | null {
    if (this.stretch.mode === 'manual') {
      return { range: this.stretch.range, tier: 'exact', sampleCount: 0 }
    }
    const source = this.source
    if (source === null) return null
    const geometry =
      source.bounds !== undefined
        ? boundsSampleGeometry(
            source.bounds,
            source.dataset.header.width,
            source.dataset.header.height,
            source.anchor ?? 'cell-center',
            headerSampleGeometry(source.dataset.header),
          )
        : undefined
    return stretchDisplayRange(this.stretch, {
      dataset: source.dataset,
      viewport: this.viewport,
      scale: this.scale,
      ...(source.planeIndex !== undefined ? { planeIndex: source.planeIndex } : {}),
      ...(geometry !== undefined ? { geometry } : {}),
      ...(source.dateStatistics !== undefined ? { dateStatistics: source.dateStatistics } : {}),
    })
  }

  private recompute(reason: GridStretchReason, applyHysteresis: boolean): void {
    if (this.destroyed) return
    const next = usable(this.resolve())

    if (
      next &&
      applyHysteresis &&
      this.applied &&
      !movedEnough(this.applied.range, next.range, this.hysteresis)
    ) {
      return
    }
    if (sameResult(this.applied, next)) return

    this.applied = next
    const range = next ? next.range : this.valueRange
    const meta: GridDisplayRangeMeta = {
      tier: next ? next.tier : 'insufficient',
      sampleCount: next ? next.sampleCount : 0,
      stretch: this.stretch,
      reason,
      fallback: next === null,
    }
    for (const listener of [...this.listeners]) listener(range, meta)
  }
}

/**
 * A result the renderer can actually stretch over.
 *
 * `insufficient` is the calculator saying "too few finite samples to mean
 * anything" — Swift's own comment tells the caller to fall back to `valueRange`,
 * and that is what returning `null` here does. A degenerate or non-finite range
 * is rejected on the same grounds; it would blank the layer.
 */
function usable(result: GridStretchResult | null): GridStretchResult | null {
  if (!result || result.tier === 'insufficient') return null
  const { lowerBound, upperBound } = result.range
  if (!Number.isFinite(lowerBound) || !Number.isFinite(upperBound)) return null
  if (!(lowerBound < upperBound)) return null
  return result
}

function sameResult(a: GridStretchResult | null, b: GridStretchResult | null): boolean {
  if (a === null || b === null) return a === b
  return (
    a.range.lowerBound === b.range.lowerBound &&
    a.range.upperBound === b.range.upperBound &&
    a.tier === b.tier &&
    a.sampleCount === b.sampleCount
  )
}

/**
 * Whether either endpoint moved by more than `threshold` of the current span.
 *
 * The span is the *current* one, not the candidate's: the question being asked
 * is "is this a visible change to what the operator is looking at now".
 */
function movedEnough(current: GridValueRange, next: GridValueRange, threshold: number): boolean {
  const span = current.upperBound - current.lowerBound
  if (!(span > 0)) return true
  const limit = span * threshold
  return (
    Math.abs(next.lowerBound - current.lowerBound) > limit ||
    Math.abs(next.upperBound - current.upperBound) > limit
  )
}
