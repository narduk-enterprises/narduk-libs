/**
 * Zoom-adaptive presentation for map pins.
 *
 * A map that answers "where is fishable water" wants its markers to stay
 * individual and shrink as the camera pulls out, rather than collapsing into
 * cluster bubbles that answer "how many". Below the size where a symbol can be
 * read at all it becomes a haloed dot, and the least distinctive classes drop
 * out entirely so the remaining ones stay legible.
 *
 * The obvious implementation rewrites every marker's `innerHTML` and `cssText`
 * on every `region-change-end`. With a few thousand pins that is a few thousand
 * subtree rebuilds per gesture, and it can only run at the *end* of a gesture,
 * so the markers pop rather than scale.
 *
 * This controller splits the problem in two, which is the whole idea:
 *
 * - **Continuous.** Size between thresholds is one number, published as CSS
 *   custom properties on a single container element. A zoom gesture costs two
 *   property writes per frame for *any* number of pins, creates no elements,
 *   destroys none, and writes no `innerHTML`. Consumers scale with `transform`,
 *   which the compositor handles without layout or paint.
 * - **Structural.** Dot/symbol mode and rank culling change only at thresholds,
 *   and they depend on `(class, zoom)` -- never on the individual pin. So the
 *   latched state lives per *class*, a frame costs O(classes) to recompute, and
 *   only a class that actually crossed a threshold touches its members. The
 *   change event names exactly those keys, batched into one frame.
 *
 * Every threshold is latched with hysteresis, so hovering at a boundary zoom
 * cannot thrash a class between dot and symbol or in and out of the cull.
 *
 * The controller composes with {@link MapKitAnnotationRegistry} rather than
 * replacing it: consumers keep registering annotations there, and this owns
 * presentation over those annotations by key. Pin markup stays app-owned -- the
 * controller reports which keys need repainting and what they should look like,
 * and never writes marker HTML itself.
 *
 * ## What MapKit JS actually gives you
 *
 * MapKit JS publishes three documented *bracket* pairs and no continuous camera
 * event: `region-change-start` / `region-change-end` (any region change,
 * programmatic included), `zoom-start` / `zoom-end`, and `scroll-start` /
 * `scroll-end` (both user-interaction only). The end of each pair fires after
 * momentum has settled, not on gesture release. There is no `region-change`
 * tick; the only continuous event anywhere in the API is `dragging`, which is
 * about annotation drags. So scaling *during* a pinch is only possible by
 * reading the camera once per animation frame between the brackets, which is
 * what `beginGesture()` / `endGesture()` drive.
 *
 * Zoom itself is derived rather than read: `mapkit.Map` exposes no public
 * `zoomLevel` and no `camera`. {@link mapKitZoomForSpan} inverts the documented
 * `region.span.longitudeDelta` against the element width; see its own note for
 * why `cameraDistance` is the worse source.
 *
 * Culling uses `annotation.visible`, which is Apple's own documented advice for
 * this exact problem -- "if there's a dense cluster of annotations at low zoom
 * levels, it's good practice to hide some annotations" -- and, unlike
 * `removeAnnotations()`, it leaves the host object and its DOM element intact
 * so the pin is not rebuilt when it comes back.
 *
 * One caveat worth knowing on MapKit JS 5: a map carrying a `TileOverlay` snaps
 * to integral zoom levels there, so the camera reports whole numbers and the
 * continuous path degrades to the same steps a `'step'` curve would produce.
 * MapKit JS 6 removed that snapping.
 *
 * Nothing here touches a DOM global at import time, and the container and
 * annotation surfaces are declared structurally, so the whole state machine can
 * be exercised in Node with plain objects.
 *
 * @example
 * ```ts
 * const scaling = createMapKitPinScalingController({
 *   annotations: registry,
 *   classes: { buoy: { rank: 4 }, 'oil-gas-platform': { rank: 2 } },
 *   container: mapWrapper,
 *   onChange: (event) => {
 *     for (const key of event.changed) paintPin(key, scaling.presentationFor(key)!)
 *   },
 *   readZoom: () => zoomFromRegion(map),
 * })
 *
 * map.addEventListener('zoom-start', () => scaling.beginGesture())
 * map.addEventListener('zoom-end', () => scaling.endGesture())
 * map.addEventListener('region-change-end', () => scaling.sample())
 * ```
 */
import { defaultMapKitFrameScheduler } from './timers.js'

import type { MapKitFrameScheduler } from './timers.js'

/* -------------------------------------------------------------- size curve */

/** One anchor of a size curve: the pin size in CSS pixels at that zoom. */
export interface MapKitPinSizeStop {
  readonly sizePx: number
  readonly zoom: number
}

/** Pure zoom -> CSS-pixel size. Consumers may supply any function. */
export type MapKitPinSizeCurve = (zoom: number) => number

/**
 * How a curve behaves between its anchors.
 *
 * `'linear'` is the default and the one to reach for: the anchor sizes are hit
 * exactly at the anchor zooms, and a pinch produces a continuously growing pin
 * instead of a pop at each integer zoom. `'step'` reproduces the classic
 * `if (zoom <= 5) return 5` ladder exactly, for a consumer who rasterises
 * artwork at a fixed set of sizes and wants the curve to agree with it.
 */
export type MapKitPinSizeInterpolation = 'linear' | 'step'

/**
 * The shipped curve: barely-there at ocean-basin zooms, full chart symbol from
 * z10 in. Below z5 and above z10 it is flat.
 */
export const defaultMapKitPinSizeStops: readonly MapKitPinSizeStop[] = [
  { sizePx: 5, zoom: 5 },
  { sizePx: 8, zoom: 6 },
  { sizePx: 14, zoom: 7 },
  { sizePx: 18, zoom: 8 },
  { sizePx: 22, zoom: 9 },
  { sizePx: 26, zoom: 10 },
]

/** Below this size a symbol has no room to read, so it draws as a dot. */
export const DEFAULT_MAPKIT_PIN_DOT_BELOW_PX = 12

/**
 * Build a pure zoom -> size function from ascending anchors.
 *
 * The returned closure holds two parallel number arrays rather than the stop
 * objects, and scans them linearly: a curve has a handful of anchors, and a
 * scan over numbers beats a binary search over objects at that size while
 * allocating nothing per call. It is called once per frame per distinct curve,
 * so it must stay allocation-free.
 *
 * @throws RangeError when the stops are empty, non-finite, negatively sized, or
 * not strictly ascending by zoom.
 */
export function createMapKitPinSizeCurve(
  stops: readonly MapKitPinSizeStop[] = defaultMapKitPinSizeStops,
  options: { interpolation?: MapKitPinSizeInterpolation } = {},
): MapKitPinSizeCurve {
  const zooms: number[] = []
  const sizes: number[] = []

  for (const stop of stops) {
    if (!Number.isFinite(stop.zoom) || !Number.isFinite(stop.sizePx)) {
      throw new RangeError('pin size stops need finite zoom and sizePx values')
    }
    if (stop.sizePx < 0) throw new RangeError('pin size stops need a non-negative sizePx')
    const previous = zooms[zooms.length - 1]
    if (previous !== undefined && stop.zoom <= previous) {
      throw new RangeError('pin size stops must ascend by zoom')
    }
    zooms.push(stop.zoom)
    sizes.push(stop.sizePx)
  }

  const last = zooms.length - 1
  if (last < 0) throw new RangeError('a pin size curve needs at least one stop')

  const stepped = options.interpolation === 'step'
  const first = sizes[0]!
  const top = sizes[last]!

  return (zoom: number): number => {
    // A non-finite zoom means "not measured yet"; the smallest size is the safe
    // reading, because it cannot make a crowded map unreadable.
    if (!Number.isFinite(zoom) || zoom <= zooms[0]!) return first
    if (zoom >= zooms[last]!) return top

    for (let index = 1; index <= last; index++) {
      const upper = zooms[index]!
      if (zoom > upper) continue
      if (stepped) return sizes[index]!
      const lower = zooms[index - 1]!
      const lowerSize = sizes[index - 1]!
      return lowerSize + (sizes[index]! - lowerSize) * ((zoom - lower) / (upper - lower))
    }
    return top
  }
}

/** {@link createMapKitPinSizeCurve} over {@link defaultMapKitPinSizeStops}. */
export const defaultMapKitPinSizeCurve: MapKitPinSizeCurve = createMapKitPinSizeCurve()

/* ------------------------------------------------------------- rank culling */

/**
 * The lowest class rank that survives a given zoom. Non-increasing in zoom:
 * pulling out raises the bar, so the least distinctive classes drop first.
 */
export type MapKitPinRankFloor = (zoom: number) => number

/** The shipped floor: everything from z7 in, the top two at z6, the top at z5. */
export function defaultMapKitPinRankFloor(zoom: number): number {
  if (zoom <= 5) return 3
  if (zoom <= 6) return 2
  return 1
}

/* -------------------------------------------------------------- hysteresis */

/**
 * Index of the band `value` falls in, latched so a crossing needs overshoot.
 *
 * `boundaries` ascend; index `0` is below the first, index `boundaries.length`
 * is above the last. Climbing to the next band requires clearing its boundary
 * by `hysteresis`, and falling out of a band requires dropping below the
 * boundary that produced it by the same amount, so a value parked on a boundary
 * stays where it is.
 *
 * A `current` of `null` means "not classified yet" and resolves with no
 * deadband, which is what makes the first reading land on the true band instead
 * of climbing conservatively from zero.
 */
export function latchedStepIndex(
  boundaries: readonly number[],
  value: number,
  current: number | null,
  hysteresis = 0,
): number {
  const deadband = current === null ? 0 : Math.max(0, hysteresis)
  let index = current === null ? 0 : Math.min(Math.max(current, 0), boundaries.length)

  while (index < boundaries.length && value >= boundaries[index]! + deadband) index += 1
  while (index > 0 && value < boundaries[index - 1]! - deadband) index -= 1
  return index
}

/** A pin draws as its full symbol, or as a plain dot when there is no room. */
export type MapKitPinMode = 'dot' | 'symbol'

/**
 * Dot/symbol mode for a rendered size, latched so a size parked on the
 * threshold cannot flip back and forth.
 *
 * A `dotBelowPx` of `0` (or anything non-positive) means the class never
 * collapses -- that is how a launch pin or a selected target stays a symbol at
 * every zoom.
 */
export function latchedPinMode(
  sizePx: number,
  dotBelowPx: number,
  current: MapKitPinMode | null,
  hysteresisPx = 0,
): MapKitPinMode {
  if (!(dotBelowPx > 0)) return 'symbol'
  const deadband = current === null ? 0 : Math.max(0, hysteresisPx)
  if (current === 'dot') return sizePx >= dotBelowPx + deadband ? 'symbol' : 'dot'
  return sizePx < dotBelowPx - deadband ? 'dot' : 'symbol'
}

/**
 * The zoom a culling test should be asked at so both transitions need overshoot.
 *
 * Culling is a predicate over zoom rather than a scalar band, so the deadband is
 * applied to the *question* instead of the answer: ask a visible pin whether it
 * survives slightly further out, and a hidden one whether it qualifies slightly
 * further in. Because {@link MapKitPinRankFloor} is non-increasing, that makes
 * both directions require real movement, and it collapses to two probe zooms
 * per frame no matter how many pins there are.
 */
export function cullProbeZoom(zoom: number, visible: boolean | null, hysteresis: number): number {
  if (visible === null) return zoom
  const deadband = Math.max(0, hysteresis)
  return visible ? zoom + deadband : zoom - deadband
}

/* ------------------------------------------------------------ zoom reading */

export interface MapKitZoomForSpanOptions {
  /** `map.region.span.longitudeDelta`, in degrees. */
  readonly longitudeDelta: number
  /** Web-mercator tile edge. Default `256`. */
  readonly tileSizePx?: number
  /** Rendered width of the map element in CSS pixels. */
  readonly widthPx: number
}

/**
 * Web-mercator zoom for a MapKit region span.
 *
 * MapKit JS exposes no public `zoomLevel` and no `camera` property, so zoom has
 * to be derived. `map.region` is the documented camera state and its
 * `longitudeDelta` is the viewport width in degrees; one tile spans
 * `360 / 2**z` degrees and `tileSizePx` pixels, so the rendered width fixes `z`.
 * This is the same `worldSize(z) = 256 * 2**z` convention MapKit uses
 * internally.
 *
 * Longitude rather than latitude, and span rather than `cameraDistance`, for
 * the same reason: in web mercator the x pixel position is linear in longitude
 * at every latitude, so this ratio is latitude-invariant. `cameraDistance` is a
 * metric distance, and converting it needs both a `cos(lat)`-style correction
 * and MapKit's own field-of-view constant -- neither of which is public API.
 *
 * Returns `null` for input that cannot produce a zoom, which is the normal
 * reading before the map has laid out.
 */
export function mapKitZoomForSpan(options: MapKitZoomForSpanOptions): number | null {
  const tileSizePx = options.tileSizePx ?? 256
  const { longitudeDelta, widthPx } = options
  if (!Number.isFinite(longitudeDelta) || longitudeDelta <= 0) return null
  if (!Number.isFinite(widthPx) || widthPx <= 0) return null
  if (!Number.isFinite(tileSizePx) || tileSizePx <= 0) return null
  return Math.log2((360 * widthPx) / (tileSizePx * longitudeDelta))
}

/* -------------------------------------------------------------- controller */

/** Published on the container: the base curve's size as a `px` length. */
export const MAPKIT_PIN_SIZE_PROPERTY = '--mapkit-pin-size'

/** Published on the container: size / `referenceSizePx`, unitless. */
export const MAPKIT_PIN_SCALE_PROPERTY = '--mapkit-pin-scale'

/**
 * Per-class presentation.
 *
 * `rank` is the only required field, and it is compared against the rank floor:
 * a class ranked below the floor for the current zoom is culled. Give the
 * classes a user would look for last the lowest ranks.
 */
export interface MapKitPinClassConfig {
  /**
   * Size below which this class collapses to a dot. Defaults to the
   * controller's `dotBelowPx`. Set `0` for a class that must always draw its
   * symbol -- a launch point, a route target.
   */
  readonly dotBelowPx?: number
  /** Hard floor: the class is culled below this zoom whatever its rank. */
  readonly minZoom?: number
  /** Higher survives further out. Compared against {@link MapKitPinRankFloor}. */
  readonly rank: number
  /**
   * Curve for this class alone. Publishes `--mapkit-pin-size-<class>` and
   * `--mapkit-pin-scale-<class>` alongside the base properties, so the class id
   * must be a valid CSS identifier.
   */
  readonly sizeCurve?: MapKitPinSizeCurve
}

/** Deadbands, in the units of the thing each one latches. */
export interface MapKitPinScalingHysteresis {
  /** Around `dotBelowPx`, in CSS pixels. Default `1.5`. */
  readonly dotPx?: number
  /** Around the rank floor and `minZoom`, in zoom levels. Default `0.25`. */
  readonly rankZoom?: number
  /** Around the `sizeStep` boundaries, in zoom levels. Default `0.15`. */
  readonly stepZoom?: number
}

/** What a pin should look like right now. */
export interface MapKitPinPresentation {
  readonly classId: string
  readonly mode: MapKitPinMode
  /** Exempt from culling and from dot mode. */
  readonly selected: boolean
  /** Rendered size in CSS pixels, from this pin's class curve. */
  readonly sizePx: number
  readonly visible: boolean
}

/**
 * - `pins`: the tracked set changed.
 * - `selection`: a pin was selected or deselected.
 * - `paint`: deferred repaints were released by `flushDeferred()`.
 * - `refresh`: the consumer forced a recompute.
 * - `gesture`: a frame of the gesture poll loop.
 * - `sample`: a one-off zoom reading.
 */
export type MapKitPinScalingReason =
  'gesture' | 'paint' | 'pins' | 'refresh' | 'sample' | 'selection'

export interface MapKitPinScalingChangeEvent {
  /**
   * Keys whose structural presentation changed and that are worth repainting
   * now. Usually empty during a zoom gesture: between thresholds only the
   * container properties move, and nothing needs rebuilding.
   *
   * A culled pin is never named here -- there is nothing on screen to repaint,
   * and it re-enters `changed` the moment its class becomes visible again. So a
   * dot/symbol crossing that happens while a class is hidden costs nothing.
   */
  readonly changed: ReadonlySet<string>
  /** Structural changes withheld because `shouldPaint` refused the key. */
  readonly deferred: number
  readonly reason: MapKitPinScalingReason
  /** Base-curve size / `referenceSizePx`; the published `--mapkit-pin-scale`. */
  readonly scale: number
  /** Base-curve size in CSS pixels; the published `--mapkit-pin-size`. */
  readonly sizePx: number
  /** Latched index into `stepZooms`, for consumers rasterising at fixed sizes. */
  readonly sizeStep: number
  readonly zoom: number
}

export type MapKitPinScalingListener = (event: MapKitPinScalingChangeEvent) => void

/**
 * The structural subset of the element carrying the published properties. A
 * real `HTMLElement` satisfies it, and so does a plain test double.
 */
export interface MapKitPinScalingStyleTarget {
  style: {
    removeProperty: (name: string) => unknown
    setProperty: (name: string, value: string) => void
  }
}

/**
 * Live annotations addressed by key. {@link MapKitAnnotationRegistry} satisfies
 * it, which is how the two compose without either one owning the other.
 */
export interface MapKitPinAnnotationSource<TAnnotation> {
  get: (key: string) => TAnnotation | undefined
}

/** One tracked pin: its key and the class whose presentation it follows. */
export interface MapKitPinDescriptor {
  readonly classId: string
  readonly key: string
}

/** What one `reconcile()` did to the tracked set. */
export interface MapKitPinScalingReconcileResult {
  added: number
  removed: number
  /** Key present before and after, in the same class. */
  unchanged: number
  /** Key present before and after, moved to a different class. */
  updated: number
}

export interface MapKitPinScalingOptions<TAnnotation = unknown> {
  /** Live annotations by key; a `MapKitAnnotationRegistry` fits directly. */
  annotations?: MapKitPinAnnotationSource<TAnnotation>
  cancelAnimationFrame?: MapKitFrameScheduler['cancelAnimationFrame']
  /** Per-class presentation, keyed by the `classId` a pin is tracked under. */
  classes?: Readonly<Record<string, MapKitPinClassConfig>>
  /** Element the custom properties are published on. Usually the map wrapper. */
  container?: MapKitPinScalingStyleTarget
  /**
   * Used for a `classId` that was never declared. The default is never culled:
   * silently hiding data because a class id was misspelled is the worse failure.
   */
  defaultClass?: MapKitPinClassConfig
  /** Dot threshold for classes that do not set their own. Default `12`. */
  dotBelowPx?: number
  hysteresis?: MapKitPinScalingHysteresis
  onChange?: MapKitPinScalingListener
  rankFloor?: MapKitPinRankFloor
  /**
   * Current zoom, or `null` while it cannot be read. Polled once per frame
   * during a gesture; without it the controller must be driven by `sample(zoom)`
   * and the gesture loop stays idle.
   */
  readZoom?: () => number | null
  /**
   * The size the consumer's markup is authored at, which `--mapkit-pin-scale`
   * is relative to. Defaults to the base curve's size at the top `stepZooms`
   * entry, so authored-at-full-size markup scales down and never up.
   */
  referenceSizePx?: number
  requestAnimationFrame?: MapKitFrameScheduler['requestAnimationFrame']
  /** Applied when a pin is culled or restored. Default: writes `.visible`. */
  setVisible?: (annotation: TAnnotation, visible: boolean) => void
  /**
   * Whether a changed key is worth repainting right now -- normally a viewport
   * test. A refused key is counted in `deferred` and released by
   * `flushDeferred()`, so a class flip repaints what the user can see and defers
   * the rest. Culling still applies immediately; only the repaint waits.
   */
  shouldPaint?: (key: string) => boolean
  sizeCurve?: MapKitPinSizeCurve
  /** Boundaries of the latched `sizeStep`. Default: the shipped stop zooms. */
  stepZooms?: readonly number[]
}

const DEFAULT_DOT_HYSTERESIS_PX = 1.5
const DEFAULT_RANK_HYSTERESIS_ZOOM = 0.25
const DEFAULT_STEP_HYSTERESIS_ZOOM = 0.15
// The explicit class spells out exactly what a CSS identifier may contain. The
// autofix (/^[A-Z][\w-]*$/i) is equivalent, but it rewrites a runtime literal,
// which this fold deliberately does not do.
// eslint-disable-next-line regexp/prefer-w, regexp/use-ignore-case -- narduk-libs#138
const CSS_IDENTIFIER = /^[A-Za-z][A-Za-z0-9_-]*$/
const EMPTY_KEYS: ReadonlySet<string> = new Set<string>()

/** Precedence when several causes coalesce into one frame; highest wins. */
const REASON_RANK: Readonly<Record<MapKitPinScalingReason, number>> = {
  gesture: 1,
  paint: 4,
  pins: 5,
  refresh: 2,
  sample: 0,
  selection: 3,
}

/** Live latched state for one class. Shared by every pin in it. */
interface PinClassState {
  readonly config: MapKitPinClassConfig
  readonly dotBelowPx: number
  readonly keys: Set<string>
  /** `null` until the first classification, which runs without a deadband. */
  mode: MapKitPinMode | null
  readonly referenceSizePx: number
  /** `''` for classes on the base curve, `-<id>` for a class with its own. */
  readonly scopeSuffix: string
  readonly sizeCurve: MapKitPinSizeCurve
  sizePx: number
  visible: boolean | null
}

function formatScale(value: number): string {
  return value.toFixed(3)
}

function formatSize(value: number): string {
  return `${value.toFixed(2)}px`
}

/**
 * Zoom-adaptive size, dot/symbol mode, and rank culling over a live pin set.
 *
 * The properties that make it usable with thousands of pins, and that the tests
 * pin down:
 *
 * - A frame that crosses no threshold writes two CSS custom properties and
 *   nothing else, whatever the pin count.
 * - A frame at an unchanged zoom with no pending structural cause reads the
 *   zoom and stops there: no writes, no event, and no allocation of its own.
 * - A frame that crosses a threshold touches only the classes that crossed it,
 *   and within them only their own pins.
 * - Presentation state is derived, not stored per pin, so a pin costs one map
 *   entry and one set entry and can never go stale.
 */
export class MapKitPinScalingController<TAnnotation = unknown> {
  readonly #annotations: MapKitPinAnnotationSource<TAnnotation> | undefined
  readonly #cancelFrame: MapKitFrameScheduler['cancelAnimationFrame']
  readonly #classes = new Map<string, PinClassState>()
  readonly #configs: Readonly<Record<string, MapKitPinClassConfig>>
  readonly #container: MapKitPinScalingStyleTarget | undefined
  /** Keys this controller has actually written `visible = false` on. */
  readonly #culled = new Set<string>()
  readonly #defaultClass: MapKitPinClassConfig
  readonly #deferred = new Set<string>()
  readonly #dotBelowPx: number
  readonly #dotHysteresisPx: number
  readonly #entries = new Map<string, string>()
  readonly #onChange: MapKitPinScalingListener | undefined
  /** Keys needing individual attention next frame: new, reclassified, reselected. */
  readonly #pendingKeys = new Set<string>()
  readonly #published = new Map<string, string>()
  readonly #rankFloor: MapKitPinRankFloor
  readonly #rankHysteresisZoom: number
  readonly #readZoom: (() => number | null) | undefined
  readonly #referenceSizePx: number
  readonly #requestFrame: MapKitFrameScheduler['requestAnimationFrame']
  /** Reused per frame so a gesture frame that crosses nothing allocates no set. */
  readonly #scratch = new Set<string>()
  readonly #selected = new Set<string>()
  readonly #setVisible: (annotation: TAnnotation, visible: boolean) => void
  readonly #shouldPaint: ((key: string) => boolean) | undefined
  readonly #sizeCurve: MapKitPinSizeCurve
  readonly #stepHysteresisZoom: number
  readonly #stepZooms: readonly number[]

  #destroyed = false
  #dirty = false
  #frameHandle: number | null = null
  #gesture = false
  #pendingZoom: number | null = null
  #reason: MapKitPinScalingReason = 'sample'
  #scale = 1
  #sizePx: number
  #sizeStep: number | null = null
  #zoom: number | null = null

  constructor(options: MapKitPinScalingOptions<TAnnotation> = {}) {
    this.#annotations = options.annotations
    this.#cancelFrame =
      options.cancelAnimationFrame ?? defaultMapKitFrameScheduler.cancelAnimationFrame
    this.#configs = options.classes ?? {}
    this.#container = options.container
    this.#defaultClass = options.defaultClass ?? { rank: Number.MAX_SAFE_INTEGER }
    this.#dotBelowPx = options.dotBelowPx ?? DEFAULT_MAPKIT_PIN_DOT_BELOW_PX
    this.#onChange = options.onChange
    this.#rankFloor = options.rankFloor ?? defaultMapKitPinRankFloor
    this.#readZoom = options.readZoom
    this.#requestFrame =
      options.requestAnimationFrame ?? defaultMapKitFrameScheduler.requestAnimationFrame
    this.#setVisible = options.setVisible ?? defaultVisibilityWriter<TAnnotation>()
    this.#shouldPaint = options.shouldPaint
    this.#sizeCurve = options.sizeCurve ?? defaultMapKitPinSizeCurve
    this.#stepZooms = options.stepZooms ?? defaultMapKitPinSizeStops.map((stop) => stop.zoom)

    const hysteresis = options.hysteresis ?? {}
    this.#dotHysteresisPx = Math.max(0, hysteresis.dotPx ?? DEFAULT_DOT_HYSTERESIS_PX)
    this.#rankHysteresisZoom = Math.max(0, hysteresis.rankZoom ?? DEFAULT_RANK_HYSTERESIS_ZOOM)
    this.#stepHysteresisZoom = Math.max(0, hysteresis.stepZoom ?? DEFAULT_STEP_HYSTERESIS_ZOOM)

    // The top step zoom is where every curve has already flattened out, so it
    // is the size the consumer's markup is authored at.
    const topZoom = this.#stepZooms[this.#stepZooms.length - 1] ?? 0
    this.#referenceSizePx = options.referenceSizePx ?? this.#sizeCurve(topZoom)
    // A curve answers its smallest size for an unmeasured zoom, which is the
    // safe reading to report before the map has been sampled once.
    this.#sizePx = this.#sizeCurve(Number.NaN)
    this.#scale = this.#referenceSizePx > 0 ? this.#sizePx / this.#referenceSizePx : 1
  }

  get destroyed(): boolean {
    return this.#destroyed
  }

  /** Structural changes withheld by `shouldPaint`, waiting for `flushDeferred()`. */
  get deferredCount(): number {
    return this.#deferred.size
  }

  /** Whether a gesture poll is running. */
  get gesturing(): boolean {
    return this.#gesture
  }

  /** Base-curve size / `referenceSizePx`. */
  get scale(): number {
    return this.#scale
  }

  /** Base-curve size in CSS pixels. */
  get sizePx(): number {
    return this.#sizePx
  }

  /** Latched index into `stepZooms`; `-1` before the first reading. */
  get sizeStep(): number {
    return this.#sizeStep ?? -1
  }

  /** Tracked pin count. */
  get size(): number {
    return this.#entries.size
  }

  /** The last zoom actually applied, or `null` before the first reading. */
  get zoom(): number | null {
    return this.#zoom
  }

  /** What `key` should look like right now, or `undefined` if untracked. */
  presentationFor(key: string): MapKitPinPresentation | undefined {
    const classId = this.#entries.get(key)
    if (classId === undefined) return undefined
    const state = this.#classes.get(classId)
    if (!state) return undefined
    const selected = this.#selected.has(key)
    return {
      classId,
      mode: selected ? 'symbol' : (state.mode ?? 'symbol'),
      selected,
      sizePx: state.sizePx,
      visible: selected || (state.visible ?? true),
    }
  }

  /** Track one pin. Re-tracking a key under a different class reclassifies it. */
  track(key: string, classId: string): void {
    if (this.#destroyed) return
    requirePinKey(key)
    const previous = this.#entries.get(key)
    if (previous === classId) return
    if (previous !== undefined) this.#classes.get(previous)?.keys.delete(key)

    const state = this.#classFor(classId)
    state.keys.add(key)
    this.#entries.set(key, classId)
    // The initial cull is applied on the next frame, not here: a consumer
    // normally reconciles this controller and the annotation registry in the
    // same pass, so the annotation may not exist yet.
    this.#pendingKeys.add(key)
    this.#markDirty('pins')
  }

  /** Stop tracking one pin. A no-op for unknown keys; leaves the annotation be. */
  untrack(key: string): void {
    if (this.#destroyed) return
    const classId = this.#entries.get(key)
    if (classId === undefined) return
    this.#entries.delete(key)
    this.#classes.get(classId)?.keys.delete(key)
    this.#selected.delete(key)
    this.#deferred.delete(key)
    this.#pendingKeys.delete(key)
    this.#culled.delete(key)
    this.#markDirty('pins')
  }

  /**
   * Sync the tracked set to exactly `pins`, the way the annotation registry
   * syncs the annotation set. Call it with the same cadence as
   * `registry.reconcile()`; it is the only O(pins) call in the controller.
   */
  reconcile(pins: Iterable<MapKitPinDescriptor>): MapKitPinScalingReconcileResult {
    const result: MapKitPinScalingReconcileResult = {
      added: 0,
      removed: 0,
      unchanged: 0,
      updated: 0,
    }
    if (this.#destroyed) return result

    const desired = new Set<string>()
    for (const pin of pins) {
      requirePinKey(pin.key)
      if (desired.has(pin.key)) throw new Error(`duplicate pin key "${pin.key}" in reconcile()`)
      desired.add(pin.key)

      const previous = this.#entries.get(pin.key)
      if (previous === pin.classId) {
        result.unchanged += 1
        continue
      }
      if (previous === undefined) result.added += 1
      else result.updated += 1
      this.track(pin.key, pin.classId)
    }

    for (const key of [...this.#entries.keys()]) {
      if (desired.has(key)) continue
      this.untrack(key)
      result.removed += 1
    }

    return result
  }

  /** Exempt `key` from culling and from dot mode until it is deselected. */
  select(key: string): void {
    this.#setSelected(key, true)
  }

  /** Drop the exemption, returning `key` to its class presentation. */
  deselect(key: string): void {
    this.#setSelected(key, false)
  }

  /** Replace the whole selection in one pass. */
  setSelection(keys: Iterable<string>): void {
    if (this.#destroyed) return
    const next = new Set(keys)
    for (const key of this.#selected) if (!next.has(key)) this.#setSelected(key, false)
    for (const key of next) this.#setSelected(key, true)
  }

  isSelected(key: string): boolean {
    return this.#selected.has(key)
  }

  /**
   * Record a zoom reading and schedule a frame. With no argument the zoom comes
   * from `readZoom`. Many calls before the frame runs collapse into one update.
   */
  sample(zoom?: number): void {
    if (this.#destroyed) return
    if (zoom !== undefined) this.#pendingZoom = zoom
    this.#noteReason('sample')
    this.#schedule()
  }

  /**
   * Start following the zoom continuously.
   *
   * MapKit JS brackets a gesture with `region-change-start` / `region-change-end`
   * and publishes no documented event in between, so the only way to scale
   * *during* a pinch or a wheel zoom is to read the camera once per animation
   * frame while the gesture is in flight. That is what this starts, and
   * `endGesture()` is what stops it -- there is no polling at rest.
   *
   * Without a `readZoom` there is nothing to poll, so the loop stays idle and
   * the controller degrades to whatever `sample()` is given, which is
   * end-of-gesture snapping when it is called from `region-change-end`.
   */
  beginGesture(): void {
    if (this.#destroyed || this.#gesture) return
    this.#gesture = true
    if (!this.#readZoom) return
    this.#noteReason('gesture')
    this.#schedule()
  }

  /** Stop following, and take one final reading of where the camera landed. */
  endGesture(): void {
    if (this.#destroyed || !this.#gesture) return
    this.#gesture = false
    this.sample()
  }

  /** Recompute on the next frame even though the zoom has not moved. */
  refresh(): void {
    if (this.#destroyed) return
    this.#markDirty('refresh')
  }

  /**
   * Re-test the keys `shouldPaint` refused and emit the ones that now pass.
   * Call it after a pan, where pins enter the viewport without the zoom moving.
   */
  flushDeferred(): void {
    if (this.#destroyed || this.#deferred.size === 0) return
    const released = new Set<string>()
    for (const key of [...this.#deferred]) {
      if (this.#shouldPaint && !this.#shouldPaint(key)) continue
      this.#deferred.delete(key)
      released.add(key)
    }
    if (released.size === 0) return
    this.#emit(released, 'paint')
  }

  /** Run the pending update now instead of waiting for the frame. */
  flushNow(): void {
    if (this.#destroyed) return
    this.#cancelFrameIfPending()
    this.#update()
  }

  /** Drop the pending frame and any pending cause, without updating. */
  cancel(): void {
    this.#cancelFrameIfPending()
    this.#pendingZoom = null
    this.#pendingKeys.clear()
    this.#dirty = false
  }

  /**
   * Stop the gesture loop, remove the published properties, restore the pins
   * this controller culled, and make the controller inert. Idempotent.
   *
   * Only culled pins are touched -- the controller hid them, so it un-hides
   * them -- and nothing else about the annotations is changed: their lifecycle
   * belongs to the registry, not here.
   */
  destroy(): void {
    if (this.#destroyed) return
    this.#destroyed = true
    this.#gesture = false
    this.#cancelFrameIfPending()

    for (const key of this.#culled) {
      const annotation = this.#annotations?.get(key)
      if (annotation !== undefined) this.#setVisible(annotation, true)
    }

    if (this.#container) {
      for (const property of this.#published.keys()) this.#container.style.removeProperty(property)
    }

    this.#published.clear()
    this.#culled.clear()
    this.#classes.clear()
    this.#entries.clear()
    this.#selected.clear()
    this.#deferred.clear()
    this.#pendingKeys.clear()
  }

  /* ------------------------------------------------------------- internals */

  #classFor(classId: string): PinClassState {
    const existing = this.#classes.get(classId)
    if (existing) return existing

    const config = this.#configs[classId] ?? this.#defaultClass
    const scoped = config.sizeCurve !== undefined
    if (scoped && !CSS_IDENTIFIER.test(classId)) {
      throw new Error(
        `pin class "${classId}" declares its own sizeCurve, so its id must be a CSS identifier`,
      )
    }

    const sizeCurve = config.sizeCurve ?? this.#sizeCurve
    const topZoom = this.#stepZooms[this.#stepZooms.length - 1] ?? 0
    const state: PinClassState = {
      config,
      dotBelowPx: config.dotBelowPx ?? this.#dotBelowPx,
      keys: new Set<string>(),
      mode: null,
      referenceSizePx: scoped ? sizeCurve(topZoom) : this.#referenceSizePx,
      scopeSuffix: scoped ? `-${classId}` : '',
      sizeCurve,
      sizePx: sizeCurve(Number.NaN),
      visible: null,
    }
    this.#classes.set(classId, state)
    // A class first seen after the map already has a zoom must not wait for the
    // next threshold crossing to be classified.
    this.#dirty = true
    return state
  }

  #setSelected(key: string, selected: boolean): void {
    if (this.#destroyed) return
    if (!this.#entries.has(key)) return
    if (this.#selected.has(key) === selected) return
    if (selected) this.#selected.add(key)
    else this.#selected.delete(key)
    this.#pendingKeys.add(key)
    this.#markDirty('selection')
  }

  #markDirty(reason: MapKitPinScalingReason): void {
    this.#dirty = true
    this.#noteReason(reason)
    this.#schedule()
  }

  #noteReason(reason: MapKitPinScalingReason): void {
    if (REASON_RANK[reason] > REASON_RANK[this.#reason]) this.#reason = reason
  }

  #schedule(): void {
    if (this.#destroyed || this.#frameHandle !== null) return
    this.#frameHandle = this.#requestFrame(() => {
      this.#frameHandle = null
      this.#update()
      // The loop re-arms itself from inside the frame, so it runs exactly once
      // per frame while a gesture is live and never at rest.
      if (this.#gesture && this.#readZoom) this.#schedule()
    })
  }

  #cancelFrameIfPending(): void {
    if (this.#frameHandle === null) return
    this.#cancelFrame(this.#frameHandle)
    this.#frameHandle = null
  }

  #update(): void {
    if (this.#destroyed) return

    let zoom = this.#pendingZoom
    this.#pendingZoom = null
    if (zoom === null && this.#readZoom) zoom = this.#readZoom()
    if (zoom === null || !Number.isFinite(zoom)) zoom = this.#zoom
    if (zoom === null) return

    const zoomMoved = zoom !== this.#zoom
    // The steady state: nothing moved and nothing is pending, so the frame
    // stops here having written nothing, allocated nothing, and emitted
    // nothing.
    if (!zoomMoved && !this.#dirty) return

    const reason = this.#reason
    // A live gesture is the standing cause of every frame it drives; a
    // structural cause still outranks it when one lands mid-gesture.
    this.#reason = this.#gesture ? 'gesture' : 'sample'
    this.#dirty = false
    this.#zoom = zoom

    this.#sizePx = this.#sizeCurve(zoom)
    this.#scale = this.#referenceSizePx > 0 ? this.#sizePx / this.#referenceSizePx : 1
    this.#sizeStep = latchedStepIndex(
      this.#stepZooms,
      zoom,
      this.#sizeStep,
      this.#stepHysteresisZoom,
    )

    this.#publish(MAPKIT_PIN_SIZE_PROPERTY, formatSize(this.#sizePx))
    this.#publish(MAPKIT_PIN_SCALE_PROPERTY, formatScale(this.#scale))

    // Two probe zooms cover every pin: one asks a visible class whether it still
    // survives further out, the other asks a hidden class whether it qualifies
    // further in. The floor is evaluated twice per frame, not once per pin.
    const floorWhenVisible = this.#rankFloor(cullProbeZoom(zoom, true, this.#rankHysteresisZoom))
    const floorWhenHidden = this.#rankFloor(cullProbeZoom(zoom, false, this.#rankHysteresisZoom))

    this.#scratch.clear()
    for (const state of this.#classes.values()) {
      this.#updateClass(state, zoom, floorWhenVisible, floorWhenHidden)
    }

    // Pending keys settle after the classes do, so a pin tracked or reselected
    // this frame adopts its class's freshly latched state rather than waiting
    // for the next threshold crossing.
    if (this.#pendingKeys.size > 0) {
      // A pin whose annotation does not exist yet keeps its place in the queue
      // rather than being silently dropped, so it settles on a later frame.
      let retry: string[] | null = null
      for (const key of this.#pendingKeys) {
        if (this.#settlePendingKey(key)) continue
        retry ??= []
        retry.push(key)
      }
      this.#pendingKeys.clear()
      if (retry) for (const key of retry) this.#pendingKeys.add(key)
    }

    if (this.#scratch.size === 0 && !zoomMoved) return
    this.#emit(this.#scratch.size === 0 ? EMPTY_KEYS : new Set(this.#scratch), reason)
  }

  /**
   * Give one pin its class's settled presentation. Returns `false` when the
   * annotation was not there to write to, which keeps the key queued.
   */
  #settlePendingKey(key: string): boolean {
    const classId = this.#entries.get(key)
    if (classId === undefined) return true
    const state = this.#classes.get(classId)
    if (!state) return true
    const visible = this.#selected.has(key) || (state.visible ?? true)
    const settled = this.#applyVisibility(key, visible)
    if (visible) this.#scratch.add(key)
    return settled
  }

  #updateClass(
    state: PinClassState,
    zoom: number,
    floorWhenVisible: number,
    floorWhenHidden: number,
  ): void {
    const sizePx = state.sizeCurve === this.#sizeCurve ? this.#sizePx : state.sizeCurve(zoom)
    state.sizePx = sizePx
    if (state.scopeSuffix !== '') {
      this.#publish(`${MAPKIT_PIN_SIZE_PROPERTY}${state.scopeSuffix}`, formatSize(sizePx))
      const scale = state.referenceSizePx > 0 ? sizePx / state.referenceSizePx : 1
      this.#publish(`${MAPKIT_PIN_SCALE_PROPERTY}${state.scopeSuffix}`, formatScale(scale))
    }

    const previousMode = state.mode
    const previousVisible = state.visible
    const mode = latchedPinMode(sizePx, state.dotBelowPx, previousMode, this.#dotHysteresisPx)

    // `probe` is the zoom the culling question is asked at; the two hot answers
    // are already computed for the frame, and only a class being classified for
    // the first time needs its own call.
    const probe = cullProbeZoom(zoom, previousVisible, this.#rankHysteresisZoom)
    const floor =
      previousVisible === null
        ? this.#rankFloor(probe)
        : previousVisible
          ? floorWhenVisible
          : floorWhenHidden
    const minZoom = state.config.minZoom
    const visible = state.config.rank >= floor && (minZoom === undefined || probe >= minZoom)

    state.mode = mode
    state.visible = visible
    if (mode === previousMode && visible === previousVisible) return

    const visibilityChanged = visible !== previousVisible
    // A mode change inside a class that is culled and staying culled is latent:
    // nothing is on screen to repaint, and the change is picked up by the
    // visibility transition that eventually brings the class back.
    if (!visible && !visibilityChanged) return

    const hasPending = this.#pendingKeys.size > 0
    for (const key of state.keys) {
      // A selected pin is exempt from both, so a class flip does not touch it,
      // and a pending key is settled individually once every class has latched.
      if (this.#selected.has(key)) continue
      if (hasPending && this.#pendingKeys.has(key)) continue
      // A pin whose annotation is not built yet is queued for a later frame;
      // the pending pass below picks it up in this one first.
      if (visibilityChanged && !this.#applyVisibility(key, visible)) {
        this.#pendingKeys.add(key)
      }
      if (visible) this.#scratch.add(key)
    }
  }

  /**
   * Write `visible` only when this controller is actually changing it. A pin is
   * assumed visible when first tracked, so registering thousands of pins into
   * classes that are all on screen writes nothing at all, and the culled set
   * stays proportional to what is hidden rather than to the pin count.
   *
   * Returns whether the pin is settled. The state is recorded only once the
   * write lands, so a pin tracked before its annotation exists reports `false`
   * and is retried rather than silently counting as done. A controller with no
   * annotation source has nothing to write and is always settled.
   */
  #applyVisibility(key: string, visible: boolean): boolean {
    if (visible === !this.#culled.has(key)) return true
    if (!this.#annotations) return true
    const annotation = this.#annotations.get(key)
    if (annotation === undefined) return false
    this.#setVisible(annotation, visible)
    if (visible) this.#culled.delete(key)
    else this.#culled.add(key)
    return true
  }

  #publish(property: string, value: string): void {
    if (this.#published.get(property) === value) return
    this.#published.set(property, value)
    this.#container?.style.setProperty(property, value)
  }

  #emit(changed: ReadonlySet<string>, reason: MapKitPinScalingReason): void {
    let painted: Set<string> | null = null
    if (this.#shouldPaint && changed.size > 0) {
      painted = new Set<string>()
      for (const key of changed) {
        if (this.#shouldPaint(key)) {
          painted.add(key)
          this.#deferred.delete(key)
        } else {
          this.#deferred.add(key)
        }
      }
    }

    const delivered = painted ?? changed
    this.#onChange?.({
      changed: delivered.size === 0 ? EMPTY_KEYS : delivered,
      deferred: this.#deferred.size,
      reason,
      scale: this.#scale,
      sizePx: this.#sizePx,
      sizeStep: this.#sizeStep ?? -1,
      zoom: this.#zoom ?? Number.NaN,
    })
  }
}

function requirePinKey(key: string): void {
  if (!key.trim()) throw new Error('pin key is required')
}

/**
 * MapKit annotations expose `visible`; setting it `false` takes the annotation
 * out of the map's render and collision work rather than merely hiding it,
 * which is the point of culling.
 */
function defaultVisibilityWriter<TAnnotation>(): (
  annotation: TAnnotation,
  visible: boolean,
) => void {
  return (annotation, visible) => {
    ;(annotation as { visible?: boolean }).visible = visible
  }
}

/** Create a {@link MapKitPinScalingController}. */
export function createMapKitPinScalingController<TAnnotation = unknown>(
  options: MapKitPinScalingOptions<TAnnotation> = {},
): MapKitPinScalingController<TAnnotation> {
  return new MapKitPinScalingController(options)
}
