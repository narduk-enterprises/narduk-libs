import type { MapKitPinGeometry } from '../nuxt/runtime/pin-geometry.js';
import type { LatLng } from '../geometry/helpers.js';
import type { MapKitFrameScheduler } from './timers.js';
/** The minimum a moving marker carries. Everything else is the app's. */
export interface MapKitMovingMarker {
    id: string;
    lat: number;
    lng: number;
}
interface MovingAnnotationLike {
    anchorOffset: DOMPoint;
    coordinate: unknown;
    size: {
        height: number;
        width: number;
    } | null;
}
/** The MapKit map members the layer uses. */
export interface MapKitMovingMapLike {
    addAnnotations: (annotations: never[]) => unknown;
    addEventListener?: (type: string, listener: () => void) => void;
    removeAnnotations: (annotations: never[]) => unknown;
    removeEventListener?: (type: string, listener: () => void) => void;
    setCenterAnimated?: (coordinate: never, animated?: boolean) => unknown;
}
/** The MapKit namespace members the layer uses. */
export interface MapKitMovingNamespaceLike {
    Annotation: new (coordinate: never, factory: () => HTMLElement, options: Record<string, unknown>) => MovingAnnotationLike;
    Coordinate: new (latitude: number, longitude: number) => unknown;
}
/** What `createElement` returns: the glyph, and how to tear it down. */
export interface MapKitMovingGlyph {
    cleanup?: () => void;
    element: HTMLElement;
}
export type MapKitMovingSelectVia = 'keyboard' | 'pointer';
export interface MapKitMovingMarkerLayerOptions<T extends MapKitMovingMarker> {
    /** Draws a marker's glyph. The layer owns the host around it. */
    createElement: (marker: T, tier: string) => HTMLElement | MapKitMovingGlyph;
    /** MapKit's annotation `displayPriority`; MapKit hides lower ones first when crowded. Default 1000. */
    displayPriority?: number;
    /** Injected so a plain-TS test can run against any document. */
    document?: Document;
    frames?: MapKitFrameScheduler;
    /** How long a glide takes, in ms. Default `MAPKIT_GLIDE_MS` (13 s, most of a 15 s poll). */
    glideMs?: number;
    /**
     * Box and anchor of the host. Default: a 48 x 48 box centred on the coordinate.
     * A function of the tier lets the dot tier be smaller than the symbol.
     */
    geometry?: MapKitPinGeometry | ((tier: string) => MapKitPinGeometry);
    /** Report the heading as `--mapkit-heading` / `data-mapkit-heading`. Default `true`. */
    heading?: boolean;
    /** Whole-tab hidden state. Default: `document.hidden`. */
    hidden?: () => boolean;
    /** Grow the host to at least this many CSS px square (`true` is 44). Default off. */
    hitArea?: boolean | number;
    /** Accessible name of the host. Without it the host is decorative. */
    label?: (marker: T) => string;
    /** Route lines per marker, so it glides along its route. Absent or empty: straight. */
    lines?: (marker: T) => ReadonlyArray<readonly LatLng[]>;
    map: MapKitMovingMapLike;
    mapkit: MapKitMovingNamespaceLike;
    /** A jump longer than this is a new place and snaps. Default 1500 m. */
    maxGlideMetres?: number;
    /** A move shorter than this does not change the heading. Default 15 m. */
    minHeadingMoveMetres?: number;
    now?: () => number;
    /** `follow` ended because the user moved the map, or the followed marker went away. */
    onFollowEnd?: (id: string) => void;
    /** Called when a labelled host is activated by pointer or keyboard. */
    onSelect?: (id: string | null, via: MapKitMovingSelectVia) => void;
    reducedMotion?: () => boolean;
    /**
     * A string that changes when the glyph must be redrawn. Without it the glyph
     * is drawn once and left alone, so a poll that returns new objects for the
     * same markers does not rebuild any DOM.
     */
    renderKey?: (marker: T) => string;
}
export declare class MapKitMovingMarkerLayer<T extends MapKitMovingMarker> {
    #private;
    constructor(options: MapKitMovingMarkerLayerOptions<T>);
    get size(): number;
    /** How many markers are mid-glide. */
    get gliding(): number;
    get tier(): string;
    get followedId(): string | null;
    /** The position drawn for a marker now (mid-glide), or `undefined` for an unknown id. */
    positionOf(id: string): LatLng | undefined;
    /** The host element for a marker, once MapKit has rendered it. */
    hostFor(id: string): HTMLElement | undefined;
    /** Draw every marker in `tier`; a marker added later is drawn in it too. */
    setTier(tier: string): void;
    /** Mark one marker selected (`aria-pressed`, `data-mapkit-selected`). */
    setSelected(id: string | null): void;
    /**
     * Keep the camera centred on one marker as it glides, until the user scrolls
     * or zooms (or the marker goes away). `null` stops following. Returns whether
     * the id is a known marker.
     */
    follow(id: string | null): boolean;
    /** Make the map show exactly `markers`. */
    set(markers: readonly T[]): void;
    destroy(): void;
}
export declare function createMapKitMovingMarkerLayer<T extends MapKitMovingMarker>(options: MapKitMovingMarkerLayerOptions<T>): MapKitMovingMarkerLayer<T>;
export {};
//# sourceMappingURL=moving-markers.d.ts.map