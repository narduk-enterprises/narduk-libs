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
import {
  GridStretchController,
  viewportBBox,
  type GridDisplayRangeListener,
  type GridPercentileStat,
  type GridRangeStretch,
  type GridStretchTimers,
} from '../core/stretch.js'
import type { TemporalRasterFrame } from '../core/decode/temporal.js'
import { createGridBackend } from '../render/factory.js'
import { styleScale } from '../render/style.js'
import type { GridRenderBackend, GridRenderBackendKind, GridStyle } from '../render/types.js'

export interface GridOverlayStyleInput {
  /** Legacy value-domain stops. Optional now that `rampStops` exists. */
  ramp?: readonly ColorStop[]
  /** Canonical normalized-position stops; wins over `ramp`. */
  rampStops?: readonly RampStop[]
  /**
   * The wire/decode domain. Not a stretch knob — narrowing it mis-decodes an
   * `encoded-u16` frame instead of re-spreading the ramp.
   */
  valueRange: GridValueRange | readonly [number, number]
  /**
   * The render stretch, or `null` to clear one and fall back to `valueRange`.
   *
   * Setting this by hand is fine and permanent-until-changed. It is *not* the
   * same as {@link GridOverlay.setStretch}: an active data-driven stretch
   * recomputes and will overwrite whatever was set here on its next pass.
   */
  displayRange?: GridValueRange | readonly [number, number] | null
  scale: GridScale | string
  opacity?: number
  /**
   * Coverage rule at holes and coastlines. Scalar uses it in both backends and
   * defaults to `soft`. RGB uses it in WebGL2 and defaults to `coastal`; the
   * Canvas2D RGB fallback keeps its premultiplied-alpha image resample.
   */
  sampling?: GridSampling
}

export interface GridOverlayOptions {
  mode?: 'scalar' | 'rgb'
  prefer?: GridRenderBackendKind
  style: GridOverlayStyleInput
  className?: string
  maxGpuFrames?: number
  /** Initial dynamic-range stretch. Defaults to `{ mode: 'fixed' }` — no stretch. */
  stretch?: GridRangeStretch | null
  /** Debounce for viewport-driven recompute, ms. Defaults to `250`. */
  stretchDebounceMs?: number
  /** Hysteresis as a fraction of the current display span. Defaults to `0.02`. */
  stretchHysteresis?: number
  /** Timer seam for the stretch controller. Defaults to the global timers. */
  stretchTimers?: GridStretchTimers
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
  /**
   * A percentile table the server published for this date, already parsed.
   *
   * Only a `date-percentile` stretch reads it, and only when it carries both
   * requested percentiles; otherwise that stretch scans the whole grid, which is
   * what GeoGridKit does unconditionally. See {@link GridPercentileStat}.
   */
  dateStatistics?: readonly GridPercentileStat[]
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

  /**
   * Choose how the display range is computed from the data.
   *
   * Recomputes immediately when paused. During playback the change is recorded
   * and applied on pause — see {@link GridOverlay.setPlaying}.
   */
  setStretch(stretch: GridRangeStretch | null): void
  /** The stretch currently in force. */
  currentStretch(): GridRangeStretch
  /**
   * The computed display range, or `null` when none is in force and the layer's
   * own `valueRange` is what the ramp is spread over.
   */
  currentDisplayRange(): GridValueRange | null
  /**
   * Observe applied display ranges. The range handed to the listener is the one
   * actually in force, so a stretch that came back unusable reports the
   * `valueRange` it fell back to with `meta.fallback === true`.
   *
   * Returns an unsubscribe function.
   */
  onDisplayRangeChange(listener: GridDisplayRangeListener): () => void
  /**
   * Freeze the stretch for playback.
   *
   * A range recomputed per animation frame animates the *ramp*, so the colors
   * move while the data does not. Everything requested while playing — viewport
   * moves, new frames, an explicit `setStretch` — is deferred to the pause.
   */
  setPlaying(playing: boolean): void
}

function toValueRange(input: GridValueRange | readonly [number, number]): GridValueRange {
  return Array.isArray(input)
    ? valueRangeFromTuple(input as [number, number])
    : (input as GridValueRange)
}

/**
 * Everything about a style **except** `displayRange`.
 *
 * The stretch controller is the single writer of that field. A hand-set
 * `displayRange` becomes a `manual` stretch instead of a direct write, so
 * `currentDisplayRange()` cannot disagree with what is on screen and the
 * controller's hysteresis cannot be comparing against a range it never
 * computed. See {@link GridOverlayImpl.setStyle}.
 */
function toStyle(input: GridOverlayStyleInput): GridStyle {
  return {
    valueRange: toValueRange(input.valueRange),
    scale: input.scale,
    ...(input.ramp !== undefined ? { ramp: input.ramp } : {}),
    ...(input.rampStops !== undefined ? { rampStops: input.rampStops } : {}),
    ...(input.opacity !== undefined ? { opacity: input.opacity } : {}),
    ...(input.sampling !== undefined ? { sampling: input.sampling } : {}),
  }
}

/** A hand-set `displayRange`, expressed as the stretch it actually is. */
function stretchFromDisplayRange(
  displayRange: GridValueRange | readonly [number, number] | null,
): GridRangeStretch | null {
  return displayRange == null ? null : { mode: 'manual', range: toValueRange(displayRange) }
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
  private readonly stretchController: GridStretchController
  private style: GridStyle
  private lastRender: LastRender | null = null
  private layoutObserver: ResizeObserver | null = null
  private observedParent: Element | null = null
  private destroyed = false
  /**
   * Set while a new dataset is being handed to the controller, so the style
   * update that may follow does not repaint the *previous* frame through the
   * *new* frame's range. The `renderAt` right after does the painting.
   */
  private adoptingSource = false

  constructor(options: GridOverlayOptions) {
    this.style = toStyle(options.style)
    this.backendImpl = createGridBackend({
      mode: options.mode ?? 'scalar',
      style: this.style,
      ...(options.prefer !== undefined ? { prefer: options.prefer } : {}),
      ...(options.className !== undefined ? { className: options.className } : {}),
      ...(options.maxGpuFrames !== undefined ? { maxGpuFrames: options.maxGpuFrames } : {}),
    })
    this.stretchController = new GridStretchController({
      valueRange: this.style.valueRange,
      scale: styleScale(this.style),
      ...(options.stretch !== undefined ? { stretch: options.stretch } : {}),
      ...(options.stretchDebounceMs !== undefined ? { debounceMs: options.stretchDebounceMs } : {}),
      ...(options.stretchHysteresis !== undefined ? { hysteresis: options.stretchHysteresis } : {}),
      ...(options.stretchTimers !== undefined ? { timers: options.stretchTimers } : {}),
    })
    // Registered first, so the style is already updated by the time any caller's
    // listener runs and reads `currentDisplayRange()`.
    this.stretchController.onDisplayRangeChange(() => {
      this.applyDisplayRange(this.stretchController.currentDisplayRange())
    })
    // An explicit `stretch` wins; otherwise a hand-set `style.displayRange` is
    // adopted as the `manual` stretch it amounts to. Seeding it through
    // `setStretch` rather than through the style is what makes it visible to
    // `currentDisplayRange()` from the first frame.
    const seed =
      options.stretch !== undefined
        ? options.stretch
        : stretchFromDisplayRange(options.style.displayRange ?? null)
    if (seed !== null) this.stretchController.setStretch(seed)
  }

  setStretch(stretch: GridRangeStretch | null): void {
    this.stretchController.setStretch(stretch)
  }

  currentStretch(): GridRangeStretch {
    return this.stretchController.currentStretch()
  }

  currentDisplayRange(): GridValueRange | null {
    return this.stretchController.currentDisplayRange()
  }

  onDisplayRangeChange(listener: GridDisplayRangeListener): () => void {
    return this.stretchController.onDisplayRangeChange(listener)
  }

  setPlaying(playing: boolean): void {
    this.stretchController.setPlaying(playing)
  }

  /**
   * Push a computed range into the style without routing back through
   * `setStyle`, which would re-notify the controller and loop.
   *
   * ## A known, accepted double repaint
   *
   * When `setStyle` changes the wire domain or the scale, the controller re-runs
   * and may land here mid-call — so that one `setStyle` can paint twice: once
   * from this method and once from `setStyle`'s own trailing `repaint()`. It is
   * left alone deliberately. Suppressing it means another in-flight flag like
   * `adoptingSource`, and each such flag is a state machine that can be wrong in
   * a way a dropped frame never is; the cost is one extra draw on an explicit
   * style change, which is not a per-frame path. Revisit only if a profile of a
   * real viewer says otherwise.
   */
  private applyDisplayRange(range: GridValueRange | null): void {
    if (this.destroyed) return
    const current = this.style.displayRange
    if (range === null) {
      if (current === undefined) return
      const { displayRange: _cleared, ...rest } = this.style
      this.style = rest
    } else {
      if (
        current !== undefined &&
        current.lowerBound === range.lowerBound &&
        current.upperBound === range.upperBound
      ) {
        return
      }
      this.style = { ...this.style, displayRange: range }
    }
    this.backendImpl.setStyle(this.style)
    if (!this.adoptingSource) this.repaint()
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
    this.stretchController.setViewport(viewport ? viewportBBox(viewport) : null)
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
    // The controller owns `displayRange`, so whatever it last applied is carried
    // across the rebuild rather than being reconstructed from the partial.
    const applied = this.style.displayRange
    this.style = {
      ...toStyle(merged),
      ...(applied !== undefined ? { displayRange: applied } : {}),
    }
    this.backendImpl.setStyle(this.style)
    // The wire domain and the scale are inputs to the stretch — the scale
    // decides the space a pad is applied in, and the wire domain is the
    // fallback a failed stretch reports. A change to either re-runs it.
    this.stretchController.setStyle(this.style.valueRange, styleScale(this.style))
    // A hand-set `displayRange` is a `manual` stretch, not a direct write.
    // `null` clears it back to the wire domain; `undefined` leaves whatever
    // stretch is running alone. Writing the field directly here is what used to
    // let `currentDisplayRange()` and the picture disagree.
    if (partial.displayRange !== undefined) {
      this.stretchController.setStretch(stretchFromDisplayRange(partial.displayRange))
    }
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
    const anchor = options.anchor ?? defaultBBoxAnchor(frame.valueKind)
    // The float32 `/grid` dialect is the stretch's only data source: it is the
    // one that carries the geometry (`lon0`/`dx`) a viewport intersection needs,
    // and it is the dialect GeoGridKit's `GridDataset` is. A temporal
    // `encoded-u16` frame set through `setFrame`/`renderAt` carries samples in
    // wire counts with no header, so it drives no stretch.
    //
    // The *effective* bbox goes with it, not the header's. A caller who
    // overrides the extent is telling the renderer where these cells are; a
    // stretch that kept sampling the header's rectangle would compute a
    // perfectly plausible range for cells nobody is looking at, and the error
    // grows without bound as the override moves away.
    this.adoptingSource = true
    try {
      this.stretchController.setSource({
        dataset,
        planeIndex,
        ...(options.bbox !== undefined ? { bounds: options.bbox, anchor } : {}),
        ...(options.dateStatistics !== undefined ? { dateStatistics: options.dateStatistics } : {}),
      })
    } finally {
      this.adoptingSource = false
    }
    this.renderAt(frame, frame, 0, bbox, anchor)
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
    this.stretchController.destroy()
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
