import type { MapKitFrameScheduler } from './timers.js';
/** One anchor of a size curve: the pin size in CSS pixels at that zoom. */
export interface MapKitPinSizeStop {
    readonly sizePx: number;
    readonly zoom: number;
}
/** Pure zoom -> CSS-pixel size. Consumers may supply any function. */
export type MapKitPinSizeCurve = (zoom: number) => number;
/**
 * How a curve behaves between its anchors.
 *
 * `'linear'` is the default and the one to reach for: the anchor sizes are hit
 * exactly at the anchor zooms, and a pinch produces a continuously growing pin
 * instead of a pop at each integer zoom. `'step'` reproduces the classic
 * `if (zoom <= 5) return 5` ladder exactly, for a consumer who rasterises
 * artwork at a fixed set of sizes and wants the curve to agree with it.
 */
export type MapKitPinSizeInterpolation = 'linear' | 'step';
/**
 * The shipped curve: barely-there at ocean-basin zooms, full chart symbol from
 * z10 in. Below z5 and above z10 it is flat.
 */
export declare const defaultMapKitPinSizeStops: readonly MapKitPinSizeStop[];
/** Below this size a symbol has no room to read, so it draws as a dot. */
export declare const DEFAULT_MAPKIT_PIN_DOT_BELOW_PX = 12;
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
export declare function createMapKitPinSizeCurve(stops?: readonly MapKitPinSizeStop[], options?: {
    interpolation?: MapKitPinSizeInterpolation;
}): MapKitPinSizeCurve;
/** {@link createMapKitPinSizeCurve} over {@link defaultMapKitPinSizeStops}. */
export declare const defaultMapKitPinSizeCurve: MapKitPinSizeCurve;
/**
 * The lowest class rank that survives a given zoom. Non-increasing in zoom:
 * pulling out raises the bar, so the least distinctive classes drop first.
 */
export type MapKitPinRankFloor = (zoom: number) => number;
/** The shipped floor: everything from z7 in, the top two at z6, the top at z5. */
export declare function defaultMapKitPinRankFloor(zoom: number): number;
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
export declare function latchedStepIndex(boundaries: readonly number[], value: number, current: number | null, hysteresis?: number): number;
/** A pin draws as its full symbol, or as a plain dot when there is no room. */
export type MapKitPinMode = 'dot' | 'symbol';
/**
 * Dot/symbol mode for a rendered size, latched so a size parked on the
 * threshold cannot flip back and forth.
 *
 * A `dotBelowPx` of `0` (or anything non-positive) means the class never
 * collapses -- that is how a launch pin or a selected target stays a symbol at
 * every zoom.
 */
export declare function latchedPinMode(sizePx: number, dotBelowPx: number, current: MapKitPinMode | null, hysteresisPx?: number): MapKitPinMode;
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
export declare function cullProbeZoom(zoom: number, visible: boolean | null, hysteresis: number): number;
export interface MapKitZoomForSpanOptions {
    /** `map.region.span.longitudeDelta`, in degrees. */
    readonly longitudeDelta: number;
    /** Web-mercator tile edge. Default `256`. */
    readonly tileSizePx?: number;
    /** Rendered width of the map element in CSS pixels. */
    readonly widthPx: number;
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
export declare function mapKitZoomForSpan(options: MapKitZoomForSpanOptions): number | null;
/** Published on the container: the base curve's size as a `px` length. */
export declare const MAPKIT_PIN_SIZE_PROPERTY = "--mapkit-pin-size";
/** Published on the container: size / `referenceSizePx`, unitless. */
export declare const MAPKIT_PIN_SCALE_PROPERTY = "--mapkit-pin-scale";
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
    readonly dotBelowPx?: number;
    /** Hard floor: the class is culled below this zoom whatever its rank. */
    readonly minZoom?: number;
    /** Higher survives further out. Compared against {@link MapKitPinRankFloor}. */
    readonly rank: number;
    /**
     * Curve for this class alone. Publishes `--mapkit-pin-size-<class>` and
     * `--mapkit-pin-scale-<class>` alongside the base properties, so the class id
     * must be a valid CSS identifier.
     */
    readonly sizeCurve?: MapKitPinSizeCurve;
}
/** Deadbands, in the units of the thing each one latches. */
export interface MapKitPinScalingHysteresis {
    /** Around `dotBelowPx`, in CSS pixels. Default `1.5`. */
    readonly dotPx?: number;
    /** Around the rank floor and `minZoom`, in zoom levels. Default `0.25`. */
    readonly rankZoom?: number;
    /** Around the `sizeStep` boundaries, in zoom levels. Default `0.15`. */
    readonly stepZoom?: number;
}
/** What a pin should look like right now. */
export interface MapKitPinPresentation {
    readonly classId: string;
    readonly mode: MapKitPinMode;
    /** Exempt from culling and from dot mode. */
    readonly selected: boolean;
    /** Rendered size in CSS pixels, from this pin's class curve. */
    readonly sizePx: number;
    readonly visible: boolean;
}
/**
 * - `pins`: the tracked set changed.
 * - `selection`: a pin was selected or deselected.
 * - `paint`: deferred repaints were released by `flushDeferred()`.
 * - `refresh`: the consumer forced a recompute.
 * - `gesture`: a frame of the gesture poll loop.
 * - `sample`: a one-off zoom reading.
 */
export type MapKitPinScalingReason = 'gesture' | 'paint' | 'pins' | 'refresh' | 'sample' | 'selection';
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
    readonly changed: ReadonlySet<string>;
    /** Structural changes withheld because `shouldPaint` refused the key. */
    readonly deferred: number;
    readonly reason: MapKitPinScalingReason;
    /** Base-curve size / `referenceSizePx`; the published `--mapkit-pin-scale`. */
    readonly scale: number;
    /** Base-curve size in CSS pixels; the published `--mapkit-pin-size`. */
    readonly sizePx: number;
    /** Latched index into `stepZooms`, for consumers rasterising at fixed sizes. */
    readonly sizeStep: number;
    readonly zoom: number;
}
export type MapKitPinScalingListener = (event: MapKitPinScalingChangeEvent) => void;
/**
 * The structural subset of the element carrying the published properties. A
 * real `HTMLElement` satisfies it, and so does a plain test double.
 */
export interface MapKitPinScalingStyleTarget {
    style: {
        removeProperty: (name: string) => unknown;
        setProperty: (name: string, value: string) => void;
    };
}
/**
 * Live annotations addressed by key. {@link MapKitAnnotationRegistry} satisfies
 * it, which is how the two compose without either one owning the other.
 */
export interface MapKitPinAnnotationSource<TAnnotation> {
    get: (key: string) => TAnnotation | undefined;
}
/** One tracked pin: its key and the class whose presentation it follows. */
export interface MapKitPinDescriptor {
    readonly classId: string;
    readonly key: string;
}
/** What one `reconcile()` did to the tracked set. */
export interface MapKitPinScalingReconcileResult {
    added: number;
    removed: number;
    /** Key present before and after, in the same class. */
    unchanged: number;
    /** Key present before and after, moved to a different class. */
    updated: number;
}
export interface MapKitPinScalingOptions<TAnnotation = unknown> {
    /** Live annotations by key; a `MapKitAnnotationRegistry` fits directly. */
    annotations?: MapKitPinAnnotationSource<TAnnotation>;
    cancelAnimationFrame?: MapKitFrameScheduler['cancelAnimationFrame'];
    /** Per-class presentation, keyed by the `classId` a pin is tracked under. */
    classes?: Readonly<Record<string, MapKitPinClassConfig>>;
    /** Element the custom properties are published on. Usually the map wrapper. */
    container?: MapKitPinScalingStyleTarget;
    /**
     * Used for a `classId` that was never declared. The default is never culled:
     * silently hiding data because a class id was misspelled is the worse failure.
     */
    defaultClass?: MapKitPinClassConfig;
    /** Dot threshold for classes that do not set their own. Default `12`. */
    dotBelowPx?: number;
    hysteresis?: MapKitPinScalingHysteresis;
    onChange?: MapKitPinScalingListener;
    rankFloor?: MapKitPinRankFloor;
    /**
     * Current zoom, or `null` while it cannot be read. Polled once per frame
     * during a gesture; without it the controller must be driven by `sample(zoom)`
     * and the gesture loop stays idle.
     */
    readZoom?: () => number | null;
    /**
     * The size the consumer's markup is authored at, which `--mapkit-pin-scale`
     * is relative to. Defaults to the base curve's size at the top `stepZooms`
     * entry, so authored-at-full-size markup scales down and never up.
     */
    referenceSizePx?: number;
    requestAnimationFrame?: MapKitFrameScheduler['requestAnimationFrame'];
    /** Applied when a pin is culled or restored. Default: writes `.visible`. */
    setVisible?: (annotation: TAnnotation, visible: boolean) => void;
    /**
     * Whether a changed key is worth repainting right now -- normally a viewport
     * test. A refused key is counted in `deferred` and released by
     * `flushDeferred()`, so a class flip repaints what the user can see and defers
     * the rest. Culling still applies immediately; only the repaint waits.
     */
    shouldPaint?: (key: string) => boolean;
    sizeCurve?: MapKitPinSizeCurve;
    /** Boundaries of the latched `sizeStep`. Default: the shipped stop zooms. */
    stepZooms?: readonly number[];
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
export declare class MapKitPinScalingController<TAnnotation = unknown> {
    #private;
    constructor(options?: MapKitPinScalingOptions<TAnnotation>);
    get destroyed(): boolean;
    /** Structural changes withheld by `shouldPaint`, waiting for `flushDeferred()`. */
    get deferredCount(): number;
    /** Whether a gesture poll is running. */
    get gesturing(): boolean;
    /** Base-curve size / `referenceSizePx`. */
    get scale(): number;
    /** Base-curve size in CSS pixels. */
    get sizePx(): number;
    /** Latched index into `stepZooms`; `-1` before the first reading. */
    get sizeStep(): number;
    /** Tracked pin count. */
    get size(): number;
    /** The last zoom actually applied, or `null` before the first reading. */
    get zoom(): number | null;
    /** What `key` should look like right now, or `undefined` if untracked. */
    presentationFor(key: string): MapKitPinPresentation | undefined;
    /** Track one pin. Re-tracking a key under a different class reclassifies it. */
    track(key: string, classId: string): void;
    /** Stop tracking one pin. A no-op for unknown keys; leaves the annotation be. */
    untrack(key: string): void;
    /**
     * Sync the tracked set to exactly `pins`, the way the annotation registry
     * syncs the annotation set. Call it with the same cadence as
     * `registry.reconcile()`; it is the only O(pins) call in the controller.
     */
    reconcile(pins: Iterable<MapKitPinDescriptor>): MapKitPinScalingReconcileResult;
    /** Exempt `key` from culling and from dot mode until it is deselected. */
    select(key: string): void;
    /** Drop the exemption, returning `key` to its class presentation. */
    deselect(key: string): void;
    /** Replace the whole selection in one pass. */
    setSelection(keys: Iterable<string>): void;
    isSelected(key: string): boolean;
    /**
     * Record a zoom reading and schedule a frame. With no argument the zoom comes
     * from `readZoom`. Many calls before the frame runs collapse into one update.
     */
    sample(zoom?: number): void;
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
    beginGesture(): void;
    /** Stop following, and take one final reading of where the camera landed. */
    endGesture(): void;
    /** Recompute on the next frame even though the zoom has not moved. */
    refresh(): void;
    /**
     * Re-test the keys `shouldPaint` refused and emit the ones that now pass.
     * Call it after a pan, where pins enter the viewport without the zoom moving.
     */
    flushDeferred(): void;
    /** Run the pending update now instead of waiting for the frame. */
    flushNow(): void;
    /** Drop the pending frame and any pending cause, without updating. */
    cancel(): void;
    /**
     * Stop the gesture loop, remove the published properties, restore the pins
     * this controller culled, and make the controller inert. Idempotent.
     *
     * Only culled pins are touched -- the controller hid them, so it un-hides
     * them -- and nothing else about the annotations is changed: their lifecycle
     * belongs to the registry, not here.
     */
    destroy(): void;
}
/** Create a {@link MapKitPinScalingController}. */
export declare function createMapKitPinScalingController<TAnnotation = unknown>(options?: MapKitPinScalingOptions<TAnnotation>): MapKitPinScalingController<TAnnotation>;
//# sourceMappingURL=scaling.d.ts.map