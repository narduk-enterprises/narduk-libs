import type { MapKitFrameScheduler } from './timers.js';
import type { MapKitPoint } from '../types.js';
/** A 2D point in CSS pixels. */
export interface MapKitCalloutPoint {
    x: number;
    y: number;
}
export interface MapKitCalloutSize {
    height: number;
    width: number;
}
/** The subset of a `DOMRect` the controller reads. */
export interface MapKitCalloutRect extends MapKitCalloutSize {
    left: number;
    top: number;
}
/** Which side of the anchor the callout sits on. */
export type MapKitCalloutPlacement = 'above' | 'below' | 'left' | 'right';
/** `'single'` closes the open callout when another opens; `'multi'` does not. */
export type MapKitCalloutMode = 'multi' | 'single';
/** Whether an open came from `open()` or from `toggle()`. */
export type MapKitCalloutOpenReason = 'open' | 'toggle';
/**
 * - `api`: `close()`, `closeAll()`, or `toggle()` on an open key.
 * - `deselect`: the map deselected the annotation the callout belongs to.
 * - `destroy`: `destroy()` tore an open callout down.
 * - `escape`: the user pressed Escape.
 * - `map-click`: a click landed on the map outside every open callout.
 * - `pan`: the camera started moving and `closeOnPan` is on.
 * - `replaced`: `'single'` mode, and another callout took its place.
 */
export type MapKitCalloutCloseReason = 'api' | 'deselect' | 'destroy' | 'escape' | 'map-click' | 'pan' | 'replaced';
export interface MapKitCalloutEvent<TItem = unknown> {
    readonly item: TItem;
    readonly key: string;
    /** `'update'` is a re-open of an already-open key. */
    readonly phase: 'close' | 'open' | 'update';
    readonly reason: MapKitCalloutCloseReason | MapKitCalloutOpenReason;
}
export type MapKitCalloutListener<TItem = unknown> = (event: MapKitCalloutEvent<TItem>) => void;
/** Where the callout ended up, and what it took to get it there. */
export interface MapKitCalloutLayout {
    /** Caret centre, relative to the callout box's own top-left corner. */
    readonly caret: MapKitCalloutPoint;
    /** The box was pushed back inside the container's bounds. */
    readonly clamped: boolean;
    /** The preferred placement had no room and the opposite side was used. */
    readonly flipped: boolean;
    readonly placement: MapKitCalloutPlacement;
    /** The box slid along the cross axis to keep away from an edge. */
    readonly shifted: boolean;
    /** `false` when the anchor projects outside the container; the box is hidden. */
    readonly visible: boolean;
    /** Container-relative left edge of the callout box. */
    readonly x: number;
    /** Container-relative top edge of the callout box. */
    readonly y: number;
}
export interface MapKitCalloutLayoutInput {
    /** Container-relative point the caret points at. */
    anchor: MapKitCalloutPoint;
    /** The container's own size, in CSS pixels. */
    bounds: MapKitCalloutSize;
    /** Caret extent; also the minimum distance the caret keeps from a corner. */
    caretSize: number;
    /** Minimum distance the box keeps from every container edge. */
    edgePadding: number;
    /** Try the opposite side when the preferred one has less room. */
    flip: boolean;
    /** Distance between the anchor and the near edge of the box. */
    gap: number;
    placement: MapKitCalloutPlacement;
    /** The measured size of the callout box. */
    size: MapKitCalloutSize;
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
export declare function layoutMapKitCallout(input: MapKitCalloutLayoutInput): MapKitCalloutLayout;
/**
 * The structural subset of the inline style objects the controller writes.
 *
 * Every property is a plain `string`, so a real `CSSStyleDeclaration`
 * satisfies it and so does `{ ... }` in a Node test.
 */
export interface MapKitCalloutStyle {
    height: string;
    left: string;
    pointerEvents: string;
    position: string;
    top: string;
    transform: string;
    visibility: string;
    width: string;
    zIndex: string;
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
    appendChild: (child: any) => any;
    contains?: (node: any) => boolean;
    focus?: (options?: {
        preventScroll?: boolean;
    }) => void;
    getBoundingClientRect?: () => MapKitCalloutRect;
    innerHTML?: string;
    ownerDocument?: MapKitCalloutDocument | null;
    removeChild?: (child: any) => any;
    setAttribute: (name: string, value: string) => void;
    style: MapKitCalloutStyle;
}
/** The structural subset of a `Document` the controller uses. */
export interface MapKitCalloutDocument {
    activeElement?: unknown;
    addEventListener: (type: string, listener: (event: any) => void, options?: any) => void;
    createElement: (tagName: string) => any;
    removeEventListener: (type: string, listener: (event: any) => void, options?: any) => void;
}
/** The structural subset of a `KeyboardEvent` the Escape handler reads. */
export interface MapKitCalloutKeyboardEventLike {
    readonly key?: string;
}
/** The structural subset of a click the outside-click handler reads. */
export interface MapKitCalloutClickEventLike {
    readonly target?: unknown;
}
/**
 * The structural subset of a `mapkit.Map` the controller subscribes to. Only
 * the event surface is used -- projection is injected separately -- so any
 * emitter works, including a plain test double.
 */
export interface MapKitCalloutMapHandle {
    addEventListener: (type: string, listener: (event: any) => void, options?: any) => void;
    removeEventListener: (type: string, listener: (event: any) => void, options?: any) => void;
}
/** The structural subset of a `Window`; only used to resolve page scroll. */
export interface MapKitCalloutWindow {
    document?: MapKitCalloutDocument;
    scrollX?: number;
    scrollY?: number;
}
/** What `render()` and `update()` are told about the callout they are drawing. */
export interface MapKitCalloutContext<TItem = unknown, TCoordinate = MapKitPoint> {
    /** Close this callout. The reason is reported as `'api'`. */
    readonly close: () => void;
    readonly coordinate: TCoordinate;
    readonly item: TItem;
    readonly key: string;
}
/**
 * Mount content into `host` and return the teardown for it.
 *
 * The returned function runs exactly once, when the callout closes or when a
 * re-open replaces the content -- so a framework mount, a subscription, or an
 * event listener created here always has a matching unmount.
 */
export type MapKitCalloutRenderer<TItem = unknown, TCoordinate = MapKitPoint> = (context: MapKitCalloutContext<TItem, TCoordinate>, host: MapKitCalloutElement) => (() => void) | void;
/**
 * Apply new data to already-mounted content.
 *
 * Supplying this is how a consumer opts out of teardown on re-open: with it,
 * `open()` on an already-open key updates in place and the existing cleanup
 * stays live; without it, the content is torn down and rendered again.
 */
export type MapKitCalloutUpdater<TItem = unknown, TCoordinate = MapKitPoint> = (context: MapKitCalloutContext<TItem, TCoordinate>, host: MapKitCalloutElement) => void;
export interface MapKitCalloutDescriptor<TItem = unknown, TCoordinate = MapKitPoint> {
    /** Accessible name for this callout; falls back to the controller option. */
    ariaLabel?: string;
    /** Container-relative pixels added to the projected anchor, e.g. a pin's height. */
    anchorOffset?: MapKitCalloutPoint;
    /** Where the callout points. Projected through `projectCoordinate`. */
    coordinate: TCoordinate;
    /** Handed back to `render`, `update`, and every event. */
    item: TItem;
    /** Stable identity. Pair it with a `MapKitAnnotationRegistry` key. */
    key: string;
    /** Preferred side. Falls back to the controller option. */
    placement?: MapKitCalloutPlacement;
    /** Per-callout renderer. Falls back to the controller option. */
    render?: MapKitCalloutRenderer<TItem, TCoordinate>;
    /** Per-callout in-place update. Falls back to the controller option. */
    update?: MapKitCalloutUpdater<TItem, TCoordinate>;
}
export interface MapKitCalloutControllerOptions<TItem = unknown, TCoordinate = MapKitPoint> {
    /** Default accessible name applied to every callout frame. */
    ariaLabel?: string;
    /** Caret extent in pixels, and the caret's minimum distance from a corner. Default `10`. */
    caretSize?: number;
    /** Close every callout when the map deselects an annotation. Default `true`. */
    closeOnDeselect?: boolean;
    /** Close on Escape. Default `true`. */
    closeOnEscape?: boolean;
    /** Close when a click lands on the container outside every callout. Default `true`. */
    closeOnMapClick?: boolean;
    /** Close when the camera starts moving. Default `false` -- callouts follow instead. */
    closeOnPan?: boolean;
    /**
     * The positioned element the overlay layer is appended to. It must establish
     * a containing block (`position: relative` or better) or the callouts will be
     * placed against the page instead of the map.
     */
    container: MapKitCalloutElement;
    /**
     * Which coordinate space `projectCoordinate` returns. `'page'` matches
     * MapKit's `convertCoordinateToPointOnPage`; `'container'` skips the
     * container-origin subtraction. Default `'page'`.
     */
    coordinateSpace?: 'container' | 'page';
    /** Injectable document. Default: the container's `ownerDocument`, then `globalThis.document`. */
    document?: MapKitCalloutDocument;
    /** Minimum distance every callout keeps from a container edge. Default `8`. */
    edgePadding?: number;
    /** Flip to the opposite side when the preferred one is cramped. Default `true`. */
    flip?: boolean;
    /** Move focus into the callout when it opens. Default `false`. */
    focusOnOpen?: boolean;
    /** Injectable animation frames. Default: `globalThis`, with a `setTimeout` fallback. */
    frame?: MapKitFrameScheduler;
    /** Map events that end a camera movement. Default `['region-change-end']`. */
    followEndEvents?: readonly string[];
    /** Map events that begin a camera movement. Default `['region-change-start']`. */
    followStartEvents?: readonly string[];
    /** Distance between the anchor and the callout's near edge. Default `12`. */
    gap?: number;
    /** Hide, rather than close, a callout whose anchor leaves the container. Default `true`. */
    hideOffscreen?: boolean;
    /**
     * Map an annotation from a `deselect` event to a callout key, so only that
     * callout closes. Without it a `deselect` closes every open callout.
     */
    keyForAnnotation?: (annotation: unknown) => string | null;
    /** How many callouts may be open at once. Default `'single'`. */
    mode?: MapKitCalloutMode;
    /** Map to follow. Omitted, the controller repositions only when asked to. */
    map?: MapKitCalloutMapHandle;
    /** Preferred side for every callout. Default `'above'`. */
    placement?: MapKitCalloutPlacement;
    /**
     * Project a map coordinate to a point. Injected so the core never imports
     * MapKit JS. Return `null` when the coordinate cannot be projected.
     *
     * With MapKit JS this is usually
     * `(c) => map.convertCoordinateToPointOnPage(new mapkit.Coordinate(c.lat, c.lng))`.
     */
    projectCoordinate: (coordinate: TCoordinate) => MapKitCalloutPoint | null;
    /** Default content renderer, used by any descriptor without its own. */
    render?: MapKitCalloutRenderer<TItem, TCoordinate>;
    /** Return focus to whatever had it before the callout opened. Default `true`. */
    restoreFocus?: boolean;
    /** ARIA role for each callout frame. Default `'dialog'`. */
    role?: string;
    /** Default in-place updater, used by any descriptor without its own. */
    update?: MapKitCalloutUpdater<TItem, TCoordinate>;
    /** Injectable window; only used to resolve page scroll offsets. */
    window?: MapKitCalloutWindow;
    /** Stacking order of the overlay layer. Default `12`. */
    zIndex?: number;
}
/** Marks the overlay layer. Style hook, and the "is this ours" test. */
export declare const MAPKIT_CALLOUT_LAYER_ATTRIBUTE = "data-mapkit-callout-layer";
/** Set on each callout frame, valued with the callout's key. */
export declare const MAPKIT_CALLOUT_ATTRIBUTE = "data-mapkit-callout";
/** Set on the caret element, so a consumer can style the pointer. */
export declare const MAPKIT_CALLOUT_CARET_ATTRIBUTE = "data-mapkit-callout-caret";
/** Set on the element handed to `render()`. */
export declare const MAPKIT_CALLOUT_CONTENT_ATTRIBUTE = "data-mapkit-callout-content";
/** Set on the frame and the caret, valued with the resolved placement. */
export declare const MAPKIT_CALLOUT_PLACEMENT_ATTRIBUTE = "data-mapkit-callout-placement";
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
export declare class MapKitCalloutController<TItem = unknown, TCoordinate = MapKitPoint> {
    #private;
    constructor(options: MapKitCalloutControllerOptions<TItem, TCoordinate>);
    get destroyed(): boolean;
    /** Whether the camera is mid-movement and the frame loop is running. */
    get following(): boolean;
    get mode(): MapKitCalloutMode;
    /** Keys of every open callout, in the order they opened. */
    get openKeys(): readonly string[];
    get size(): number;
    isOpen(key: string): boolean;
    /** The element `render()` was given for `key`, for a consumer that mounts into it later. */
    hostFor(key: string): MapKitCalloutElement | null;
    /**
     * The item `key` is currently open with, or `null` when it is closed. Reading
     * it back from the controller rather than from the consumer's own list is
     * what lets a callout stay correct for an item that has since left the list.
     */
    itemFor(key: string): TItem | null;
    /** The last computed layout for `key`; `null` before the first flush. */
    layoutFor(key: string): MapKitCalloutLayout | null;
    subscribe(listener: MapKitCalloutListener<TItem>): () => void;
    /**
     * Open a callout, or update the open one with the same key.
     *
     * A re-open with an `update` hook keeps the mounted content and its cleanup
     * alive; without one the content is torn down and re-rendered. In `'single'`
     * mode every other open callout closes first, with reason `'replaced'`.
     */
    open(descriptor: MapKitCalloutDescriptor<TItem, TCoordinate>, reason?: MapKitCalloutOpenReason): void;
    /** Close an open callout. A no-op for unknown keys. */
    close(key: string, reason?: MapKitCalloutCloseReason): void;
    /** Close every open callout, oldest first. */
    closeAll(reason?: MapKitCalloutCloseReason): void;
    /** Open when closed, close when open. Never updates an open callout. */
    toggle(descriptor: MapKitCalloutDescriptor<TItem, TCoordinate>): void;
    /** Ask for a reposition on the next animation frame. Coalesced with any pending one. */
    reposition(): void;
    /** Reposition immediately instead of waiting for the frame. */
    repositionNow(): void;
    /**
     * Close every callout, detach every listener, remove the layer, and make the
     * controller inert. Idempotent. Each open callout emits one final `'close'`
     * event with reason `'destroy'` before the subscribers are dropped, so a
     * consumer's own state can settle.
     */
    destroy(): void;
}
/** Create a {@link MapKitCalloutController} for one map container. */
export declare function createMapKitCalloutController<TItem = unknown, TCoordinate = MapKitPoint>(options: MapKitCalloutControllerOptions<TItem, TCoordinate>): MapKitCalloutController<TItem, TCoordinate>;
//# sourceMappingURL=callouts.d.ts.map