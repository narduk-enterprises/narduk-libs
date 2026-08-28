import type { MapKitTimerScheduler } from './timers.js';
import type { MapKitPoint } from '../types.js';
/** A 2D point in CSS pixels. */
export interface MapKitProbePoint {
    x: number;
    y: number;
}
export type MapKitProbePointerType = 'mouse' | 'pen' | 'touch' | 'unknown';
/** Hover readouts follow the pointer; a pin is sticky until dismissed. */
export type MapKitProbeMode = 'hover' | 'pinned';
/**
 * - `begin`: hover started, or a pin was placed.
 * - `move`: throttled hover sample, or a throttled pin-drag sample.
 * - `end`: hover ended, or a pin drag was released.
 * - `cancel`: the gesture became a pan/pinch, or a pin could not be placed.
 * - `dismiss`: the pin was removed.
 */
export type MapKitProbePhase = 'begin' | 'move' | 'end' | 'cancel' | 'dismiss';
/** What produced the event. `pan` marks a gesture reclassified as a map pan. */
export type MapKitProbeSource = 'hover' | 'click' | 'tap' | 'long-press' | 'drag' | 'pan' | 'programmatic';
/** One normalized pointer reading, in three coordinate spaces. */
export interface MapKitProbePointerSample {
    /** Viewport-relative (`clientX`/`clientY`). */
    readonly client: MapKitProbePoint;
    /** Document-relative (`pageX`/`pageY`, falling back to client). */
    readonly page: MapKitProbePoint;
    /** Element-relative; the origin is the probe element's top-left corner. */
    readonly point: MapKitProbePoint;
    readonly pointerId: number;
    readonly pointerType: MapKitProbePointerType;
}
/** The single event shape a probe consumer renders from. */
export interface MapKitProbeEvent<TCoordinate = MapKitPoint> {
    /** `null` when the point was refused, or when nothing is being read. */
    readonly coordinate: TCoordinate | null;
    readonly mode: MapKitProbeMode;
    readonly phase: MapKitProbePhase;
    /** Element-relative point; the same value as `pointer.point`. */
    readonly point: MapKitProbePoint;
    readonly pointer: MapKitProbePointerSample;
    readonly source: MapKitProbeSource;
}
export type MapKitProbeListener<TCoordinate = MapKitPoint> = (event: MapKitProbeEvent<TCoordinate>) => void;
/**
 * The structural subset of a `PointerEvent` the recognizer reads.
 *
 * Declared structurally so the state machine can be exercised in Node with
 * plain objects — no jsdom, no MapKit JS, no pointer hardware.
 */
export interface MapKitProbePointerEventLike {
    readonly button?: number;
    readonly buttons?: number;
    readonly clientX: number;
    readonly clientY: number;
    readonly isPrimary?: boolean;
    readonly pageX?: number;
    readonly pageY?: number;
    readonly pointerId?: number;
    readonly pointerType?: string;
    readonly target?: unknown;
}
/**
 * The structural subset of an `HTMLElement` the probe attaches to. A real
 * `HTMLElement` satisfies it, and so does a plain test double.
 *
 * The listener parameter is `any` deliberately: `lib.dom`'s `addEventListener`
 * takes `EventListenerOrEventListenerObject`, and only `any` stays assignable
 * in both directions so that passing a real element still typechecks.
 */
export interface MapKitProbeElement {
    addEventListener: (type: string, listener: (event: any) => void, options?: any) => void;
    getBoundingClientRect?: () => {
        left: number;
        top: number;
    };
    releasePointerCapture?: (pointerId: number) => void;
    removeEventListener: (type: string, listener: (event: any) => void, options?: any) => void;
    setPointerCapture?: (pointerId: number) => void;
}
export interface MapKitPointerProbeOptions<TCoordinate = MapKitPoint> {
    /**
     * Convert a pointer sample to a map coordinate. Injected by the consumer, so
     * the core never imports MapKit JS. Return `null` to refuse the point (off
     * the map, over chrome, over land); a refused point never places a pin.
     *
     * With MapKit JS this is usually
     * `(sample) => map.convertPointOnPageToCoordinate(new DOMPoint(sample.page.x, sample.page.y))`.
     */
    coordinateForPoint: (sample: MapKitProbePointerSample) => TCoordinate | null;
    element: MapKitProbeElement;
    /** Start attached but inert when `false`. Default `true`. */
    enabled?: boolean;
    /** Pointer types that produce hover readouts. Default `['mouse', 'pen']`. */
    hoverPointerTypes?: readonly MapKitProbePointerType[];
    /** Minimum milliseconds between hover and pin-drag samples. Default `90`. */
    hoverThrottleMs?: number;
    /**
     * Recognize a pointerdown as the start of a pin drag, typically by testing
     * whether the event target is inside the app's pin element. Pin markup is
     * app-owned, so the core cannot hit-test it.
     */
    isPinHandle?: (target: unknown) => boolean;
    /** Hold duration that places a pin. Default `500`. */
    longPressDurationMs?: number;
    /** Pointer types eligible for long-press. Default `['touch', 'pen']`. */
    longPressPointerTypes?: readonly MapKitProbePointerType[];
    /** Movement past this radius reclassifies a press as a pan. Default `8`. */
    moveSlopPx?: number;
    onEvent: MapKitProbeListener<TCoordinate>;
    /** Suppress hover readouts while a pin is placed. Default `true`. */
    suppressHoverWhilePinned?: boolean;
    /** Longest press still treated as a tap/click. Default `500`. */
    tapMaxDurationMs?: number;
    /** Injectable clock/timers. Default: `globalThis` timers and `Date.now()`. */
    timer?: MapKitTimerScheduler;
}
/** The placed pin, in both screen and map space. */
export interface MapKitProbePin<TCoordinate = MapKitPoint> {
    readonly coordinate: TCoordinate;
    readonly point: MapKitProbePoint;
}
/**
 * Unified pointer plumbing for map probing.
 *
 * One recognizer covers desktop hover (throttled), click-to-pin, touch
 * tap-to-pin, long-press-to-pin, pin-drag repositioning, and dismissal, and
 * separates every one of those from a map pan by movement slop and press
 * duration. It knows nothing about MapKit, about the DOM beyond
 * `addEventListener`, or about what a readout looks like.
 *
 * The element should set `touch-action: none` so the browser does not consume
 * the gesture as a scroll before the recognizer sees it.
 *
 * @example
 * ```ts
 * const probe = attachMapKitPointerProbe({
 *   element: mapElement,
 *   coordinateForPoint: (sample) =>
 *     map.convertPointOnPageToCoordinate(new DOMPoint(sample.page.x, sample.page.y)),
 *   isPinHandle: (target) => target instanceof Element && target.closest('.probe-pin') !== null,
 *   onEvent: (event) => {
 *     if (event.phase === 'dismiss') return clearReadout()
 *     if (event.coordinate) renderReadout(event.mode, event.coordinate)
 *   },
 * })
 * ```
 */
export declare class MapKitPointerProbe<TCoordinate = MapKitPoint> {
    #private;
    constructor(options: MapKitPointerProbeOptions<TCoordinate>);
    get destroyed(): boolean;
    get enabled(): boolean;
    get hovering(): boolean;
    get mode(): MapKitProbeMode;
    get pin(): MapKitProbePin<TCoordinate> | null;
    subscribe(listener: MapKitProbeListener<TCoordinate>): () => void;
    /** Turn probing on or off without detaching. Disabling ends hover and gestures. */
    setEnabled(enabled: boolean): void;
    /** Place a pin at an element-relative point, as a tap would. */
    pinAtPoint(point: MapKitProbePoint, source?: MapKitProbeSource): void;
    /**
     * Start a pin drag from the app's own pin element, for consumers that prefer
     * wiring the pin's `pointerdown` over supplying `isPinHandle`.
     */
    beginPinDrag(event: MapKitProbePointerEventLike): void;
    /** Remove the pin and return to hover mode. No-op when nothing is pinned. */
    dismiss(): void;
    /** Detach every listener and cancel pending timers. */
    destroy(): void;
}
/** Attach a {@link MapKitPointerProbe} to an element. */
export declare function attachMapKitPointerProbe<TCoordinate = MapKitPoint>(options: MapKitPointerProbeOptions<TCoordinate>): MapKitPointerProbe<TCoordinate>;
//# sourceMappingURL=probe.d.ts.map