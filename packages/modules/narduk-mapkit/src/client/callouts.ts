/**
 * Anchored callouts for map annotations, as a controller-owned overlay layer.
 *
 * ## Why an overlay and not MapKit's callout delegate
 *
 * MapKit JS has a native callout hook -- set `calloutEnabled` on an annotation
 * and give it a `callout` delegate with `calloutElementForAnnotation()` and
 * `calloutAnchorOffsetForAnnotation()`. It anchors and shows the callout for
 * you, and it is the right answer for a static bubble of text. It was rejected
 * here for four reasons, in order of how much they hurt:
 *
 * 1. **MapKit owns the element's lifetime and never says when it ends.** The
 *    delegate is asked for an element each time the callout appears and the
 *    element is discarded on dismissal, with no teardown callback and no
 *    update hook. A framework subtree mounted into that element -- a Vue
 *    Teleport, a React portal -- is orphaned rather than unmounted, and its
 *    effects, watchers, and listeners leak. This controller instead promises
 *    `render(item, host) => cleanup`, so the consumer's own unmount always runs.
 * 2. **One callout, ever.** A native callout belongs to `map.selectedAnnotation`
 *    and MapKit permits a single selection, so comparing two markers side by
 *    side is not expressible. `mode: 'multi'` here opens as many as the
 *    consumer wants.
 * 3. **The anchor offset is computed once and never revisited.** There is no
 *    edge-avoidance: a marker near the top of the viewport gets a callout that
 *    is clipped by the map's own bounds rather than flipped below the pin.
 * 4. **It needs the `mapkit` global.** A delegate-based controller could not
 *    live in this package's framework-agnostic, Worker-safe core.
 *
 * The cost of the overlay is that positioning is ours: a coordinate is
 * projected to a point every time the camera moves, and the callout is written
 * back with a transform. That is one projection and one style write per open
 * callout per animation frame, coalesced through a single frame scheduler --
 * never a listener or a frame loop per callout.
 *
 * ## Shape
 *
 * The controller appends one absolutely-positioned layer to the consumer's map
 * container and one frame per open callout inside it. The layer is
 * `pointer-events: none` so the map stays draggable between callouts; each
 * frame re-enables pointer events for itself.
 *
 * ```text
 * container (position: relative)
 *   layer      [data-mapkit-callout-layer]   inset 0, pointer-events: none
 *     frame    [data-mapkit-callout="key"]   transform: translate(x, y)
 *       caret  [data-mapkit-callout-caret]
 *       host   [data-mapkit-callout-content] <- render() writes here
 * ```
 *
 * Nothing here touches a DOM global at import time, and the element,
 * document, and map surfaces are declared structurally, so the whole state
 * machine and all of the positioning math run in Node against plain objects.
 *
 * @example
 * ```ts
 * const callouts = createMapKitCalloutController<Buoy>({
 *   container: mapWrapper,
 *   map,
 *   projectCoordinate: (point) =>
 *     map.convertCoordinateToPointOnPage(new mapkit.Coordinate(point.lat, point.lng)),
 *   render: (context, host) => {
 *     host.innerHTML = `<h3>${context.item.name}</h3>`
 *     return () => { host.innerHTML = '' }
 *   },
 * })
 *
 * callouts.open({ coordinate: buoy, item: buoy, key: buoy.id })
 * ```
 */
import { createMapKitRenderScheduler } from './render.js'
import { defaultMapKitFrameScheduler } from './timers.js'

import type { MapKitFrameScheduler } from './timers.js'
import type { MapKitPoint } from '../types.js'

/** A 2D point in CSS pixels. */
export interface MapKitCalloutPoint {
  x: number
  y: number
}

export interface MapKitCalloutSize {
  height: number
  width: number
}

/** The subset of a `DOMRect` the controller reads. */
export interface MapKitCalloutRect extends MapKitCalloutSize {
  left: number
  top: number
}

/** Which side of the anchor the callout sits on. */
export type MapKitCalloutPlacement = 'above' | 'below' | 'left' | 'right'

/** `'single'` closes the open callout when another opens; `'multi'` does not. */
export type MapKitCalloutMode = 'multi' | 'single'

/** Whether an open came from `open()` or from `toggle()`. */
export type MapKitCalloutOpenReason = 'open' | 'toggle'

/**
 * - `api`: `close()`, `closeAll()`, or `toggle()` on an open key.
 * - `deselect`: the map deselected the annotation the callout belongs to.
 * - `destroy`: `destroy()` tore an open callout down.
 * - `escape`: the user pressed Escape.
 * - `map-click`: a click landed on the map outside every open callout.
 * - `pan`: the camera started moving and `closeOnPan` is on.
 * - `replaced`: `'single'` mode, and another callout took its place.
 */
export type MapKitCalloutCloseReason =
  'api' | 'deselect' | 'destroy' | 'escape' | 'map-click' | 'pan' | 'replaced'

export interface MapKitCalloutEvent<TItem = unknown> {
  readonly item: TItem
  readonly key: string
  /** `'update'` is a re-open of an already-open key. */
  readonly phase: 'close' | 'open' | 'update'
  readonly reason: MapKitCalloutCloseReason | MapKitCalloutOpenReason
}

export type MapKitCalloutListener<TItem = unknown> = (event: MapKitCalloutEvent<TItem>) => void

/** Where the callout ended up, and what it took to get it there. */
export interface MapKitCalloutLayout {
  /** Caret centre, relative to the callout box's own top-left corner. */
  readonly caret: MapKitCalloutPoint
  /** The box was pushed back inside the container's bounds. */
  readonly clamped: boolean
  /** The preferred placement had no room and the opposite side was used. */
  readonly flipped: boolean
  readonly placement: MapKitCalloutPlacement
  /** The box slid along the cross axis to keep away from an edge. */
  readonly shifted: boolean
  /** `false` when the anchor projects outside the container; the box is hidden. */
  readonly visible: boolean
  /** Container-relative left edge of the callout box. */
  readonly x: number
  /** Container-relative top edge of the callout box. */
  readonly y: number
}

export interface MapKitCalloutLayoutInput {
  /** Container-relative point the caret points at. */
  anchor: MapKitCalloutPoint
  /** The container's own size, in CSS pixels. */
  bounds: MapKitCalloutSize
  /** Caret extent; also the minimum distance the caret keeps from a corner. */
  caretSize: number
  /** Minimum distance the box keeps from every container edge. */
  edgePadding: number
  /** Try the opposite side when the preferred one has less room. */
  flip: boolean
  /** Distance between the anchor and the near edge of the box. */
  gap: number
  placement: MapKitCalloutPlacement
  /** The measured size of the callout box. */
  size: MapKitCalloutSize
}

const OPPOSITE_PLACEMENT: Readonly<Record<MapKitCalloutPlacement, MapKitCalloutPlacement>> = {
  above: 'below',
  below: 'above',
  left: 'right',
  right: 'left',
}

function clamp(value: number, min: number, max: number): number {
  // `min` deliberately wins when the box is larger than the space it must fit
  // in, so an oversized callout pins to the top-left edge instead of the
  // bottom-right one.
  return Math.max(min, Math.min(max, value))
}

function isVertical(placement: MapKitCalloutPlacement): boolean {
  return placement === 'above' || placement === 'below'
}

/**
 * Place one callout box against an anchor, inside a container.
 *
 * Three corrections happen, in this order, and each is reported separately so
 * a consumer (or a test) can tell them apart:
 *
 * 1. **flip** -- the main axis. `'above'` becomes `'below'` when the preferred
 *    side cannot hold the box and the opposite side has more room. Choosing
 *    the roomier side rather than only a side that fits means a callout taller
 *    than the whole map still lands on its best side.
 * 2. **shift** -- the cross axis. The box slides along the anchor's other axis
 *    to stay `edgePadding` away from both edges, and the caret slides the
 *    opposite way so it keeps pointing at the anchor.
 * 3. **clamp** -- both axes, last resort. A box that is simply larger than the
 *    container is pinned inside it rather than allowed to overflow.
 *
 * Pure: no DOM, no clock, no controller state.
 */
export function layoutMapKitCallout(input: MapKitCalloutLayoutInput): MapKitCalloutLayout {
  const { anchor, bounds, caretSize, edgePadding, flip, gap, size } = input
  const vertical = isVertical(input.placement)

  const spaceBefore = (vertical ? anchor.y : anchor.x) - edgePadding - gap
  const spaceAfter =
    (vertical ? bounds.height - anchor.y : bounds.width - anchor.x) - edgePadding - gap
  const mainExtent = vertical ? size.height : size.width
  const prefersBefore = input.placement === 'above' || input.placement === 'left'
  const preferred = prefersBefore ? spaceBefore : spaceAfter
  const alternate = prefersBefore ? spaceAfter : spaceBefore

  const flipped = flip && preferred < mainExtent && alternate > preferred
  const placement = flipped ? OPPOSITE_PLACEMENT[input.placement] : input.placement
  const before = placement === 'above' || placement === 'left'

  const mainAnchor = vertical ? anchor.y : anchor.x
  const mainRaw = before ? mainAnchor - gap - mainExtent : mainAnchor + gap
  const crossAnchor = vertical ? anchor.x : anchor.y
  const crossExtent = vertical ? size.width : size.height
  const crossBound = vertical ? bounds.width : bounds.height
  const crossRaw = crossAnchor - crossExtent / 2

  const crossMax = crossBound - crossExtent - edgePadding
  const cross = clamp(crossRaw, edgePadding, crossMax)
  const mainBound = vertical ? bounds.height : bounds.width
  const main = clamp(mainRaw, edgePadding, mainBound - mainExtent - edgePadding)

  // The caret slides along the cross axis by exactly what the box shifted, so
  // it keeps pointing at the anchor, and stops `caretSize` short of each
  // corner so it never straddles a rounded edge.
  const caretCross = clamp(
    crossAnchor - cross,
    caretSize,
    Math.max(caretSize, crossExtent - caretSize),
  )
  const caretMain = before ? mainExtent : 0

  return {
    caret: vertical ? { x: caretCross, y: caretMain } : { x: caretMain, y: caretCross },
    clamped: main !== mainRaw,
    flipped,
    placement,
    shifted: cross !== crossRaw,
    visible:
      anchor.x >= 0 && anchor.x <= bounds.width && anchor.y >= 0 && anchor.y <= bounds.height,
    x: vertical ? cross : main,
    y: vertical ? main : cross,
  }
}

/**
 * The structural subset of the inline style objects the controller writes.
 *
 * Every property is a plain `string`, so a real `CSSStyleDeclaration`
 * satisfies it and so does `{ ... }` in a Node test.
 */
export interface MapKitCalloutStyle {
  height: string
  left: string
  pointerEvents: string
  position: string
  top: string
  transform: string
  visibility: string
  width: string
  zIndex: string
}

/**
 * The structural subset of an element the controller creates, positions, and
 * hands to `render()`.
 *
 * The listener parameter is `any` for the same reason it is in the pointer
 * probe and the fullscreen controller: `lib.dom`'s `addEventListener` takes an
 * `EventListenerOrEventListenerObject`, and only `any` stays assignable in
 * both directions so that passing a real `HTMLElement` still typechecks.
 */
export interface MapKitCalloutElement {
  appendChild: (child: any) => any
  contains?: (node: any) => boolean
  focus?: (options?: { preventScroll?: boolean }) => void
  getBoundingClientRect?: () => MapKitCalloutRect
  innerHTML?: string
  ownerDocument?: MapKitCalloutDocument | null
  removeChild?: (child: any) => any
  setAttribute: (name: string, value: string) => void
  style: MapKitCalloutStyle
}

/** The structural subset of a `Document` the controller uses. */
export interface MapKitCalloutDocument {
  activeElement?: unknown
  addEventListener: (type: string, listener: (event: any) => void, options?: any) => void
  createElement: (tagName: string) => any
  removeEventListener: (type: string, listener: (event: any) => void, options?: any) => void
}

/** The structural subset of a `KeyboardEvent` the Escape handler reads. */
export interface MapKitCalloutKeyboardEventLike {
  readonly key?: string
}

/** The structural subset of a click the outside-click handler reads. */
export interface MapKitCalloutClickEventLike {
  readonly target?: unknown
}

/**
 * The structural subset of a `mapkit.Map` the controller subscribes to. Only
 * the event surface is used -- projection is injected separately -- so any
 * emitter works, including a plain test double.
 */
export interface MapKitCalloutMapHandle {
  addEventListener: (type: string, listener: (event: any) => void, options?: any) => void
  removeEventListener: (type: string, listener: (event: any) => void, options?: any) => void
}

/** The structural subset of a `Window`; only used to resolve page scroll. */
export interface MapKitCalloutWindow {
  document?: MapKitCalloutDocument
  scrollX?: number
  scrollY?: number
}

/** What `render()` and `update()` are told about the callout they are drawing. */
export interface MapKitCalloutContext<TItem = unknown, TCoordinate = MapKitPoint> {
  /** Close this callout. The reason is reported as `'api'`. */
  readonly close: () => void
  readonly coordinate: TCoordinate
  readonly item: TItem
  readonly key: string
}

/**
 * Mount content into `host` and return the teardown for it.
 *
 * The returned function runs exactly once, when the callout closes or when a
 * re-open replaces the content -- so a framework mount, a subscription, or an
 * event listener created here always has a matching unmount.
 */
export type MapKitCalloutRenderer<TItem = unknown, TCoordinate = MapKitPoint> = (
  context: MapKitCalloutContext<TItem, TCoordinate>,
  host: MapKitCalloutElement,
) => (() => void) | void

/**
 * Apply new data to already-mounted content.
 *
 * Supplying this is how a consumer opts out of teardown on re-open: with it,
 * `open()` on an already-open key updates in place and the existing cleanup
 * stays live; without it, the content is torn down and rendered again.
 */
export type MapKitCalloutUpdater<TItem = unknown, TCoordinate = MapKitPoint> = (
  context: MapKitCalloutContext<TItem, TCoordinate>,
  host: MapKitCalloutElement,
) => void

export interface MapKitCalloutDescriptor<TItem = unknown, TCoordinate = MapKitPoint> {
  /** Accessible name for this callout; falls back to the controller option. */
  ariaLabel?: string
  /** Container-relative pixels added to the projected anchor, e.g. a pin's height. */
  anchorOffset?: MapKitCalloutPoint
  /** Where the callout points. Projected through `projectCoordinate`. */
  coordinate: TCoordinate
  /** Handed back to `render`, `update`, and every event. */
  item: TItem
  /** Stable identity. Pair it with a `MapKitAnnotationRegistry` key. */
  key: string
  /** Preferred side. Falls back to the controller option. */
  placement?: MapKitCalloutPlacement
  /** Per-callout renderer. Falls back to the controller option. */
  render?: MapKitCalloutRenderer<TItem, TCoordinate>
  /** Per-callout in-place update. Falls back to the controller option. */
  update?: MapKitCalloutUpdater<TItem, TCoordinate>
}

export interface MapKitCalloutControllerOptions<TItem = unknown, TCoordinate = MapKitPoint> {
  /** Default accessible name applied to every callout frame. */
  ariaLabel?: string
  /** Caret extent in pixels, and the caret's minimum distance from a corner. Default `10`. */
  caretSize?: number
  /** Close every callout when the map deselects an annotation. Default `true`. */
  closeOnDeselect?: boolean
  /** Close on Escape. Default `true`. */
  closeOnEscape?: boolean
  /** Close when a click lands on the container outside every callout. Default `true`. */
  closeOnMapClick?: boolean
  /** Close when the camera starts moving. Default `false` -- callouts follow instead. */
  closeOnPan?: boolean
  /**
   * The positioned element the overlay layer is appended to. It must establish
   * a containing block (`position: relative` or better) or the callouts will be
   * placed against the page instead of the map.
   */
  container: MapKitCalloutElement
  /**
   * Which coordinate space `projectCoordinate` returns. `'page'` matches
   * MapKit's `convertCoordinateToPointOnPage`; `'container'` skips the
   * container-origin subtraction. Default `'page'`.
   */
  coordinateSpace?: 'container' | 'page'
  /** Injectable document. Default: the container's `ownerDocument`, then `globalThis.document`. */
  document?: MapKitCalloutDocument
  /** Minimum distance every callout keeps from a container edge. Default `8`. */
  edgePadding?: number
  /** Flip to the opposite side when the preferred one is cramped. Default `true`. */
  flip?: boolean
  /** Move focus into the callout when it opens. Default `false`. */
  focusOnOpen?: boolean
  /** Injectable animation frames. Default: `globalThis`, with a `setTimeout` fallback. */
  frame?: MapKitFrameScheduler
  /** Map events that end a camera movement. Default `['region-change-end']`. */
  followEndEvents?: readonly string[]
  /** Map events that begin a camera movement. Default `['region-change-start']`. */
  followStartEvents?: readonly string[]
  /** Distance between the anchor and the callout's near edge. Default `12`. */
  gap?: number
  /** Hide, rather than close, a callout whose anchor leaves the container. Default `true`. */
  hideOffscreen?: boolean
  /**
   * Map an annotation from a `deselect` event to a callout key, so only that
   * callout closes. Without it a `deselect` closes every open callout.
   */
  keyForAnnotation?: (annotation: unknown) => string | null
  /** How many callouts may be open at once. Default `'single'`. */
  mode?: MapKitCalloutMode
  /** Map to follow. Omitted, the controller repositions only when asked to. */
  map?: MapKitCalloutMapHandle
  /** Preferred side for every callout. Default `'above'`. */
  placement?: MapKitCalloutPlacement
  /**
   * Project a map coordinate to a point. Injected so the core never imports
   * MapKit JS. Return `null` when the coordinate cannot be projected.
   *
   * With MapKit JS this is usually
   * `(c) => map.convertCoordinateToPointOnPage(new mapkit.Coordinate(c.lat, c.lng))`.
   */
  projectCoordinate: (coordinate: TCoordinate) => MapKitCalloutPoint | null
  /** Default content renderer, used by any descriptor without its own. */
  render?: MapKitCalloutRenderer<TItem, TCoordinate>
  /** Return focus to whatever had it before the callout opened. Default `true`. */
  restoreFocus?: boolean
  /** ARIA role for each callout frame. Default `'dialog'`. */
  role?: string
  /** Default in-place updater, used by any descriptor without its own. */
  update?: MapKitCalloutUpdater<TItem, TCoordinate>
  /** Injectable window; only used to resolve page scroll offsets. */
  window?: MapKitCalloutWindow
  /** Stacking order of the overlay layer. Default `12`. */
  zIndex?: number
}

const DEFAULT_CARET_SIZE = 10
const DEFAULT_EDGE_PADDING = 8
const DEFAULT_FOLLOW_END_EVENTS: readonly string[] = ['region-change-end']
const DEFAULT_FOLLOW_START_EVENTS: readonly string[] = ['region-change-start']
const DEFAULT_GAP = 12
const DEFAULT_PLACEMENT: MapKitCalloutPlacement = 'above'
const DEFAULT_ROLE = 'dialog'
const DEFAULT_Z_INDEX = 12
/** One region name is enough: the scheduler exists to coalesce, not to route. */
const FLUSH_REGION = 'callouts'

/** Marks the overlay layer. Style hook, and the "is this ours" test. */
export const MAPKIT_CALLOUT_LAYER_ATTRIBUTE = 'data-mapkit-callout-layer'
/** Set on each callout frame, valued with the callout's key. */
export const MAPKIT_CALLOUT_ATTRIBUTE = 'data-mapkit-callout'
/** Set on the caret element, so a consumer can style the pointer. */
export const MAPKIT_CALLOUT_CARET_ATTRIBUTE = 'data-mapkit-callout-caret'
/** Set on the element handed to `render()`. */
export const MAPKIT_CALLOUT_CONTENT_ATTRIBUTE = 'data-mapkit-callout-content'
/** Set on the frame and the caret, valued with the resolved placement. */
export const MAPKIT_CALLOUT_PLACEMENT_ATTRIBUTE = 'data-mapkit-callout-placement'

interface CalloutEntry<TItem, TCoordinate> {
  anchorOffset: MapKitCalloutPoint
  caret: MapKitCalloutElement
  cleanup: (() => void) | null
  coordinate: TCoordinate
  frame: MapKitCalloutElement
  host: MapKitCalloutElement
  item: TItem
  key: string
  /** Last applied layout, so an unchanged frame writes nothing. */
  layout: MapKitCalloutLayout | null
  placement: MapKitCalloutPlacement
  restoreFocusTo: unknown
  update: MapKitCalloutUpdater<TItem, TCoordinate> | undefined
}

function resolveDocument<TItem, TCoordinate>(
  options: MapKitCalloutControllerOptions<TItem, TCoordinate>,
): MapKitCalloutDocument {
  const resolved =
    options.document ??
    options.container.ownerDocument ??
    options.window?.document ??
    globalThis.document
  if (!resolved) throw new Error('A DOM document is required to render MapKit callouts')
  return resolved
}

function requireCalloutKey(key: string): void {
  if (!key.trim()) throw new Error('callout key is required')
}

/**
 * Anchored, framework-agnostic callouts over one map container.
 *
 * The controller is inert until `open()` is called: it creates its layer
 * lazily and detaches every document-level listener once the last callout
 * closes, so a consumer who never opens one pays for a constructor and
 * nothing else.
 *
 * Positioning is a read-then-write batch. One flush measures the container and
 * every open callout, then writes every transform, so N open callouts cost one
 * forced layout per frame rather than N.
 */
export class MapKitCalloutController<TItem = unknown, TCoordinate = MapKitPoint> {
  readonly #ariaLabel: string | undefined
  readonly #caretSize: number
  readonly #closeOnDeselect: boolean
  readonly #closeOnEscape: boolean
  readonly #closeOnMapClick: boolean
  readonly #closeOnPan: boolean
  readonly #container: MapKitCalloutElement
  readonly #coordinateSpace: 'container' | 'page'
  readonly #document: MapKitCalloutDocument
  readonly #edgePadding: number
  readonly #entries = new Map<string, CalloutEntry<TItem, TCoordinate>>()
  readonly #flip: boolean
  readonly #focusOnOpen: boolean
  readonly #followEndEvents: readonly string[]
  readonly #followStartEvents: readonly string[]
  readonly #gap: number
  readonly #hideOffscreen: boolean
  readonly #keyForAnnotation: ((annotation: unknown) => string | null) | undefined
  readonly #listeners = new Set<MapKitCalloutListener<TItem>>()
  readonly #map: MapKitCalloutMapHandle | undefined
  readonly #mode: MapKitCalloutMode
  readonly #placement: MapKitCalloutPlacement
  readonly #projectCoordinate: (coordinate: TCoordinate) => MapKitCalloutPoint | null
  readonly #render: MapKitCalloutRenderer<TItem, TCoordinate> | undefined
  readonly #restoreFocus: boolean
  readonly #role: string
  readonly #scheduler: ReturnType<typeof createMapKitRenderScheduler>
  readonly #update: MapKitCalloutUpdater<TItem, TCoordinate> | undefined
  readonly #window: MapKitCalloutWindow | undefined
  readonly #zIndex: number

  #destroyed = false
  #documentListenersAttached = false
  /** True between a follow-start and a follow-end event; drives the frame loop. */
  #following = false
  #layer: MapKitCalloutElement | null = null

  readonly #onDeselect = (event: { annotation?: unknown }): void => {
    if (this.#destroyed || this.#entries.size === 0) return
    if (!this.#keyForAnnotation) {
      this.closeAll('deselect')
      return
    }
    const key = this.#keyForAnnotation(event?.annotation)
    if (key !== null) this.close(key, 'deselect')
  }

  readonly #onDocumentClick = (event: MapKitCalloutClickEventLike): void => {
    if (this.#destroyed || this.#entries.size === 0) return
    const target = event?.target
    if (target === undefined || target === null) return

    let positioned = false
    for (const entry of this.#entries.values()) {
      // A click inside any open callout is the consumer's own content being
      // used; only a click on the map itself dismisses.
      if (entry.frame.contains?.(target)) return
      if (entry.layout !== null) positioned = true
    }
    // Nothing has been through a flush yet, so this is the very click that
    // opened the callout still bubbling up to the document. Dismissing on it
    // would make a pin that does not call `stopPropagation()` open and close
    // in the same gesture. The first frame arrives before any second click.
    if (!positioned) return
    if (!this.#container.contains?.(target)) return
    this.closeAll('map-click')
  }

  readonly #onKeyDown = (event: MapKitCalloutKeyboardEventLike): void => {
    if (this.#destroyed || this.#entries.size === 0) return
    if (event.key !== 'Escape' && event.key !== 'Esc') return
    this.closeAll('escape')
  }

  readonly #onFollowEnd = (): void => {
    if (this.#destroyed) return
    this.#following = false
    // One last reposition: the final camera position lands after the last
    // frame the follow loop saw.
    this.#scheduler.mark(FLUSH_REGION)
  }

  readonly #onFollowStart = (): void => {
    if (this.#destroyed || this.#entries.size === 0) return
    if (this.#closeOnPan) {
      this.closeAll('pan')
      return
    }
    this.#following = true
    this.#scheduler.mark(FLUSH_REGION)
  }

  constructor(options: MapKitCalloutControllerOptions<TItem, TCoordinate>) {
    this.#ariaLabel = options.ariaLabel
    this.#caretSize = Math.max(0, options.caretSize ?? DEFAULT_CARET_SIZE)
    this.#closeOnDeselect = options.closeOnDeselect ?? true
    this.#closeOnEscape = options.closeOnEscape ?? true
    this.#closeOnMapClick = options.closeOnMapClick ?? true
    this.#closeOnPan = options.closeOnPan ?? false
    this.#container = options.container
    this.#coordinateSpace = options.coordinateSpace ?? 'page'
    this.#document = resolveDocument(options)
    this.#edgePadding = Math.max(0, options.edgePadding ?? DEFAULT_EDGE_PADDING)
    this.#flip = options.flip ?? true
    this.#focusOnOpen = options.focusOnOpen ?? false
    this.#followEndEvents = options.followEndEvents ?? DEFAULT_FOLLOW_END_EVENTS
    this.#followStartEvents = options.followStartEvents ?? DEFAULT_FOLLOW_START_EVENTS
    this.#gap = Math.max(0, options.gap ?? DEFAULT_GAP)
    this.#hideOffscreen = options.hideOffscreen ?? true
    this.#keyForAnnotation = options.keyForAnnotation
    this.#map = options.map
    this.#mode = options.mode ?? 'single'
    this.#placement = options.placement ?? DEFAULT_PLACEMENT
    this.#projectCoordinate = options.projectCoordinate
    this.#render = options.render
    this.#restoreFocus = options.restoreFocus ?? true
    this.#role = options.role ?? DEFAULT_ROLE
    this.#update = options.update
    this.#window = options.window
    this.#zIndex = options.zIndex ?? DEFAULT_Z_INDEX

    const frame = options.frame ?? defaultMapKitFrameScheduler
    this.#scheduler = createMapKitRenderScheduler({
      cancelAnimationFrame: frame.cancelAnimationFrame,
      onFlush: () => this.#flush(),
      requestAnimationFrame: frame.requestAnimationFrame,
    })

    if (!this.#map) return
    for (const type of this.#followStartEvents) {
      this.#map.addEventListener(type, this.#onFollowStart)
    }
    for (const type of this.#followEndEvents) {
      this.#map.addEventListener(type, this.#onFollowEnd)
    }
    if (this.#closeOnDeselect) this.#map.addEventListener('deselect', this.#onDeselect)
  }

  get destroyed(): boolean {
    return this.#destroyed
  }

  /** Whether the camera is mid-movement and the frame loop is running. */
  get following(): boolean {
    return this.#following
  }

  get mode(): MapKitCalloutMode {
    return this.#mode
  }

  /** Keys of every open callout, in the order they opened. */
  get openKeys(): readonly string[] {
    return [...this.#entries.keys()]
  }

  get size(): number {
    return this.#entries.size
  }

  isOpen(key: string): boolean {
    return this.#entries.has(key)
  }

  /** The element `render()` was given for `key`, for a consumer that mounts into it later. */
  hostFor(key: string): MapKitCalloutElement | null {
    return this.#entries.get(key)?.host ?? null
  }

  /**
   * The item `key` is currently open with, or `null` when it is closed. Reading
   * it back from the controller rather than from the consumer's own list is
   * what lets a callout stay correct for an item that has since left the list.
   */
  itemFor(key: string): TItem | null {
    const entry = this.#entries.get(key)
    return entry ? entry.item : null
  }

  /** The last computed layout for `key`; `null` before the first flush. */
  layoutFor(key: string): MapKitCalloutLayout | null {
    return this.#entries.get(key)?.layout ?? null
  }

  subscribe(listener: MapKitCalloutListener<TItem>): () => void {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  /**
   * Open a callout, or update the open one with the same key.
   *
   * A re-open with an `update` hook keeps the mounted content and its cleanup
   * alive; without one the content is torn down and re-rendered. In `'single'`
   * mode every other open callout closes first, with reason `'replaced'`.
   */
  open(
    descriptor: MapKitCalloutDescriptor<TItem, TCoordinate>,
    reason: MapKitCalloutOpenReason = 'open',
  ): void {
    if (this.#destroyed) throw new Error('callout controller is destroyed')
    requireCalloutKey(descriptor.key)

    const existing = this.#entries.get(descriptor.key)
    if (existing) {
      this.#applyDescriptor(existing, descriptor)
      const update = descriptor.update ?? this.#update
      if (update) update(this.#context(existing), existing.host)
      else this.#renderInto(existing, descriptor)
      this.#scheduler.mark(FLUSH_REGION)
      this.#emit(existing, 'update', reason)
      return
    }

    if (this.#mode === 'single') {
      for (const key of [...this.#entries.keys()]) this.close(key, 'replaced')
    }

    const layer = this.#ensureLayer()
    const frame = this.#document.createElement('div') as MapKitCalloutElement
    const caret = this.#document.createElement('div') as MapKitCalloutElement
    const host = this.#document.createElement('div') as MapKitCalloutElement

    frame.setAttribute(MAPKIT_CALLOUT_ATTRIBUTE, descriptor.key)
    frame.setAttribute('role', this.#role)
    frame.setAttribute('tabindex', '-1')
    const label = descriptor.ariaLabel ?? this.#ariaLabel
    if (label !== undefined) frame.setAttribute('aria-label', label)
    frame.style.position = 'absolute'
    frame.style.left = '0'
    frame.style.top = '0'
    frame.style.pointerEvents = 'auto'
    // Hidden until the first flush has measured it, so a callout never paints
    // at the container's top-left corner before it is positioned.
    frame.style.visibility = 'hidden'

    caret.setAttribute(MAPKIT_CALLOUT_CARET_ATTRIBUTE, '')
    caret.style.position = 'absolute'
    caret.style.pointerEvents = 'none'
    host.setAttribute(MAPKIT_CALLOUT_CONTENT_ATTRIBUTE, '')

    frame.appendChild(caret)
    frame.appendChild(host)
    layer.appendChild(frame)

    const entry: CalloutEntry<TItem, TCoordinate> = {
      anchorOffset: descriptor.anchorOffset ?? { x: 0, y: 0 },
      caret,
      cleanup: null,
      coordinate: descriptor.coordinate,
      frame,
      host,
      item: descriptor.item,
      key: descriptor.key,
      layout: null,
      placement: descriptor.placement ?? this.#placement,
      restoreFocusTo: this.#focusOnOpen ? (this.#document.activeElement ?? null) : null,
      update: descriptor.update ?? this.#update,
    }
    this.#entries.set(descriptor.key, entry)
    this.#renderInto(entry, descriptor)
    this.#attachDocumentListeners()
    this.#scheduler.mark(FLUSH_REGION)
    if (this.#focusOnOpen) entry.frame.focus?.({ preventScroll: true })
    this.#emit(entry, 'open', reason)
  }

  /** Close an open callout. A no-op for unknown keys. */
  close(key: string, reason: MapKitCalloutCloseReason = 'api'): void {
    const entry = this.#entries.get(key)
    if (!entry) return
    this.#entries.delete(key)
    this.#teardown(entry)
    if (this.#entries.size === 0) this.#detachDocumentListeners()
    this.#emit(entry, 'close', reason)
  }

  /** Close every open callout, oldest first. */
  closeAll(reason: MapKitCalloutCloseReason = 'api'): void {
    for (const key of [...this.#entries.keys()]) this.close(key, reason)
  }

  /** Open when closed, close when open. Never updates an open callout. */
  toggle(descriptor: MapKitCalloutDescriptor<TItem, TCoordinate>): void {
    requireCalloutKey(descriptor.key)
    if (this.#entries.has(descriptor.key)) {
      this.close(descriptor.key, 'api')
      return
    }
    this.open(descriptor, 'toggle')
  }

  /** Ask for a reposition on the next animation frame. Coalesced with any pending one. */
  reposition(): void {
    if (this.#destroyed) return
    this.#scheduler.mark(FLUSH_REGION)
  }

  /** Reposition immediately instead of waiting for the frame. */
  repositionNow(): void {
    if (this.#destroyed) return
    this.#scheduler.mark(FLUSH_REGION)
    this.#scheduler.flushNow()
  }

  /**
   * Close every callout, detach every listener, remove the layer, and make the
   * controller inert. Idempotent. Each open callout emits one final `'close'`
   * event with reason `'destroy'` before the subscribers are dropped, so a
   * consumer's own state can settle.
   */
  destroy(): void {
    if (this.#destroyed) return
    this.closeAll('destroy')
    this.#destroyed = true
    this.#following = false
    this.#scheduler.destroy()
    this.#detachDocumentListeners()

    if (this.#map) {
      for (const type of this.#followStartEvents) {
        this.#map.removeEventListener(type, this.#onFollowStart)
      }
      for (const type of this.#followEndEvents) {
        this.#map.removeEventListener(type, this.#onFollowEnd)
      }
      if (this.#closeOnDeselect) this.#map.removeEventListener('deselect', this.#onDeselect)
    }

    const layer = this.#layer
    this.#layer = null
    if (layer) this.#container.removeChild?.(layer)
    this.#listeners.clear()
  }

  #ensureLayer(): MapKitCalloutElement {
    if (this.#layer) return this.#layer
    const layer = this.#document.createElement('div') as MapKitCalloutElement
    layer.setAttribute(MAPKIT_CALLOUT_LAYER_ATTRIBUTE, '')
    // Longhands rather than `inset` so the string needs no support check, the
    // same reason the fullscreen controller writes them out.
    layer.style.position = 'absolute'
    layer.style.left = '0'
    layer.style.top = '0'
    layer.style.width = '100%'
    layer.style.height = '100%'
    // The layer must never eat map gestures; each frame re-enables its own.
    layer.style.pointerEvents = 'none'
    layer.style.zIndex = String(this.#zIndex)
    this.#container.appendChild(layer)
    this.#layer = layer
    return layer
  }

  #applyDescriptor(
    entry: CalloutEntry<TItem, TCoordinate>,
    descriptor: MapKitCalloutDescriptor<TItem, TCoordinate>,
  ): void {
    entry.anchorOffset = descriptor.anchorOffset ?? entry.anchorOffset
    entry.coordinate = descriptor.coordinate
    entry.item = descriptor.item
    entry.placement = descriptor.placement ?? entry.placement
    entry.update = descriptor.update ?? entry.update
  }

  #renderInto(
    entry: CalloutEntry<TItem, TCoordinate>,
    descriptor: MapKitCalloutDescriptor<TItem, TCoordinate>,
  ): void {
    entry.cleanup?.()
    entry.cleanup = null
    const render = descriptor.render ?? this.#render
    if (!render) return
    entry.cleanup = render(this.#context(entry), entry.host) ?? null
  }

  #context(entry: CalloutEntry<TItem, TCoordinate>): MapKitCalloutContext<TItem, TCoordinate> {
    return {
      close: () => this.close(entry.key, 'api'),
      coordinate: entry.coordinate,
      item: entry.item,
      key: entry.key,
    }
  }

  #teardown(entry: CalloutEntry<TItem, TCoordinate>): void {
    entry.cleanup?.()
    entry.cleanup = null
    this.#layer?.removeChild?.(entry.frame)
    if (!this.#restoreFocus) return
    const previous = entry.restoreFocusTo as { focus?: (options?: unknown) => void } | null
    previous?.focus?.({ preventScroll: true })
  }

  /**
   * One read pass then one write pass.
   *
   * Every `getBoundingClientRect()` happens before the first style write, so a
   * flush costs one forced layout no matter how many callouts are open. The
   * loop re-arms itself while `#following` is true: marking from inside a flush
   * lands in the next frame rather than recursing, which is what turns a
   * camera movement into a single rAF loop shared by every callout.
   */
  #flush(): void {
    if (this.#destroyed) return

    const containerRect = this.#container.getBoundingClientRect?.() ?? {
      height: 0,
      left: 0,
      top: 0,
      width: 0,
    }
    const bounds: MapKitCalloutSize = {
      height: containerRect.height,
      width: containerRect.width,
    }
    const originX =
      this.#coordinateSpace === 'page'
        ? containerRect.left + (this.#window?.scrollX ?? globalThis.scrollX ?? 0)
        : 0
    const originY =
      this.#coordinateSpace === 'page'
        ? containerRect.top + (this.#window?.scrollY ?? globalThis.scrollY ?? 0)
        : 0

    const pending: Array<{
      entry: CalloutEntry<TItem, TCoordinate>
      layout: MapKitCalloutLayout | null
    }> = []

    for (const entry of this.#entries.values()) {
      const projected = this.#projectCoordinate(entry.coordinate)
      if (!projected) {
        pending.push({ entry, layout: null })
        continue
      }
      const size = entry.frame.getBoundingClientRect?.() ?? { height: 0, left: 0, top: 0, width: 0 }
      pending.push({
        entry,
        layout: layoutMapKitCallout({
          anchor: {
            x: projected.x - originX + entry.anchorOffset.x,
            y: projected.y - originY + entry.anchorOffset.y,
          },
          bounds,
          caretSize: this.#caretSize,
          edgePadding: this.#edgePadding,
          flip: this.#flip,
          gap: this.#gap,
          placement: entry.placement,
          size: { height: size.height, width: size.width },
        }),
      })
    }

    for (const { entry, layout } of pending) this.#write(entry, layout)

    if (this.#following) this.#scheduler.mark(FLUSH_REGION)
  }

  /** Apply one layout. Writes nothing when the geometry is unchanged. */
  #write(entry: CalloutEntry<TItem, TCoordinate>, layout: MapKitCalloutLayout | null): void {
    if (!layout) {
      entry.layout = null
      entry.frame.style.visibility = 'hidden'
      entry.frame.style.pointerEvents = 'none'
      return
    }

    const previous = entry.layout
    entry.layout = layout
    const hidden = this.#hideOffscreen && !layout.visible
    entry.frame.style.visibility = hidden ? 'hidden' : 'visible'
    entry.frame.style.pointerEvents = hidden ? 'none' : 'auto'
    if (
      previous !== null &&
      previous.x === layout.x &&
      previous.y === layout.y &&
      previous.placement === layout.placement &&
      previous.caret.x === layout.caret.x &&
      previous.caret.y === layout.caret.y
    ) {
      return
    }

    // A transform rather than `left`/`top`: a camera movement rewrites this
    // every frame, and only a transform stays off the layout path.
    entry.frame.style.transform = `translate(${layout.x}px, ${layout.y}px)`
    entry.frame.setAttribute(MAPKIT_CALLOUT_PLACEMENT_ATTRIBUTE, layout.placement)
    entry.caret.setAttribute(MAPKIT_CALLOUT_PLACEMENT_ATTRIBUTE, layout.placement)
    entry.caret.style.left = `${layout.caret.x}px`
    entry.caret.style.top = `${layout.caret.y}px`
  }

  /**
   * Attached only while at least one callout is open: a document-wide key and
   * click handler should not sit on the page for a controller nobody has
   * opened.
   */
  #attachDocumentListeners(): void {
    if (this.#documentListenersAttached) return
    if (!this.#closeOnEscape && !this.#closeOnMapClick) return
    this.#documentListenersAttached = true
    if (this.#closeOnEscape) this.#document.addEventListener('keydown', this.#onKeyDown)
    if (this.#closeOnMapClick) this.#document.addEventListener('click', this.#onDocumentClick)
  }

  #detachDocumentListeners(): void {
    if (!this.#documentListenersAttached) return
    this.#documentListenersAttached = false
    if (this.#closeOnEscape) this.#document.removeEventListener('keydown', this.#onKeyDown)
    if (this.#closeOnMapClick) this.#document.removeEventListener('click', this.#onDocumentClick)
  }

  #emit(
    entry: CalloutEntry<TItem, TCoordinate>,
    phase: MapKitCalloutEvent<TItem>['phase'],
    reason: MapKitCalloutCloseReason | MapKitCalloutOpenReason,
  ): void {
    const event: MapKitCalloutEvent<TItem> = {
      item: entry.item,
      key: entry.key,
      phase,
      reason,
    }
    for (const listener of [...this.#listeners]) listener(event)
  }
}

/** Create a {@link MapKitCalloutController} for one map container. */
export function createMapKitCalloutController<TItem = unknown, TCoordinate = MapKitPoint>(
  options: MapKitCalloutControllerOptions<TItem, TCoordinate>,
): MapKitCalloutController<TItem, TCoordinate> {
  return new MapKitCalloutController(options)
}
